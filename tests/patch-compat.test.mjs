import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, posix } from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const scope = process.env.DSH_PATCH_SCOPE
const run = (script, arg) => spawnSync(process.execPath, [join(root, 'scripts', script), arg], { encoding: 'utf8' })
const originals = file => readFileSync(existsSync(file + '.dsh-phone-original') ? file + '.dsh-phone-original' : file, 'utf8')
const patches = [
  ['patch-dsh.mjs', 'dsh-subprocess-local'],
  ['patch-dsh-link.mjs', null],
  ['patch-dsh-attachment-fsync.mjs', 'dsh-attachment-local'],
  ['patch-dsh-flock-android.mjs', 'node-addon-system', 'flock.js'],
  ['patch-dsh-client-modules.mjs', 'dsh-client-modules'],
  ['patch-dsh-web-auth.mjs', 'dsh-client-connection'],
]

test('unknown files fail visibly without changing original bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-patch-unknown-'))
  try {
    const file = join(dir, 'index.js')
    for (const [script, pkg] of patches) {
      if (!pkg) continue
      writeFileSync(file, 'export const unknownBuild = true;\n')
      const r = run(script, file)
      assert.notEqual(r.status, 0, script)
      assert.equal(readFileSync(file, 'utf8'), 'export const unknownBuild = true;\n')
      assert.equal(existsSync(file + '.dsh-phone-original'), false)
    }
    assert.notEqual(run('patch-dsh-link.mjs', dir).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('syntax failure never replaces original or creates an original backup', async () => {
  const { savePatches } = await import('../scripts/patch-utils.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-patch-syntax-'))
  const file = join(dir, 'index.js')
  try {
    writeFileSync(file, 'export const valid = true;\n')
    assert.throws(() => savePatches([[file, 'export const = ;']]), /syntax check failed/)
    assert.equal(readFileSync(file, 'utf8'), 'export const valid = true;\n')
    assert.equal(existsSync(file + '.dsh-phone-original'), false)
    const second = join(dir, 'second.js')
    writeFileSync(second, 'export const second = true;\n')
    assert.throws(() => savePatches([[file, 'export const valid = false;'], [second, 'export const = ;']]), /syntax check failed/)
    assert.equal(readFileSync(file, 'utf8'), 'export const valid = true;\n', 'validate every candidate before replacing any original')
    process.env.DSH_PATCH_CHECK = '1'
    try { assert.throws(() => savePatches([[file, 'export const valid = false;']]), /unapplied patch/) }
    finally { delete process.env.DSH_PATCH_CHECK }
    assert.equal(readFileSync(file, 'utf8'), 'export const valid = true;\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('actual npm package patches, runtime contracts and idempotence', { skip: !scope && 'set DSH_PATCH_SCOPE to unpacked @deepseek-ai packages' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-patch-npm-'))
  try {
    for (const [, pkg, leaf = 'index.js'] of [...patches, ['', 'dsh-session-persistence-jsonl']]) {
      if (!pkg) continue
      const folder = join(dir, pkg, 'lib')
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, leaf), originals(join(scope, pkg, 'lib', leaf)))
    }
    for (const [script, pkg, leaf = 'index.js'] of patches) {
      const target = pkg ? join(dir, pkg, 'lib', leaf) : dir
      const first = run(script, target)
      assert.equal(first.status, 0, script + ': ' + first.stderr)
      const files = pkg ? [target] : ['dsh-session-persistence-jsonl', 'dsh-attachment-local'].map(p => join(dir, p, 'lib/index.js'))
      // Storage session target is mandatory as well.
      for (const file of files) assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0)
      const before = files.map(file => readFileSync(file, 'utf8'))
      const again = run(script, target)
      assert.equal(again.status, 0, script + ': ' + again.stderr)
      assert.deepEqual(files.map(file => readFileSync(file, 'utf8')), before, script + ' idempotence')
    }

    const web = readFileSync(join(dir, 'dsh-client-connection/lib/index.js'), 'utf8')
    const localFn = web.slice(web.indexOf('function androidLocalBrowser('), web.indexOf('\n}\n', web.indexOf('function androidLocalBrowser(')) + 2)
    let guardCalls = 0
    const context = vm.createContext({ URL,
      requestAuthority: headers => headers.host,
      header$1: (headers, name) => headers[name],
      isTrustedApiRequest: (request, trusted) => { guardCalls++; assert.equal(trusted.length, 0); return request.headers['sec-fetch-site'] !== 'cross-site' },
    })
    vm.runInContext(localFn + '\nthis.local = androidLocalBrowser', context)
    const request = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers: { host: '127.0.0.1:3080', ...headers } })
    assert.equal(context.local(request('127.0.0.1')), true)
    assert.equal(context.local(request('::1', { host: '[::1]:3080', origin: 'http://[::1]:3080' })), true)
    assert.equal(context.local(request('::ffff:127.0.0.1')), true)
    assert.equal(context.local(request('192.168.1.25')), false, 'LAN peer cannot spoof Host')
    assert.equal(context.local(request('127.0.0.1', { host: 'evil.test' })), false)
    assert.equal(context.local(request('127.0.0.1', { origin: 'http://evil.test' })), false)
    assert.equal(context.local(request('127.0.0.1', { origin: 'https://127.0.0.1:3080' })), false)
    assert.equal(context.local(request('127.0.0.1', { 'sec-fetch-site': 'cross-site' })), false)
    assert.equal(context.local({ headers: { host: '127.0.0.1:3080' } }), false)
    assert.ok(guardCalls >= 5, 'upstream Origin/Fetch guard stays in the exemption path')

    const attachment = readFileSync(join(dir, 'dsh-attachment-local/lib/index.js'), 'utf8')
    const syncStart = attachment.indexOf('async function syncDirectory(path) {')
    const syncFunction = attachment.slice(syncStart, attachment.indexOf('\n}', syncStart) + 2)
    const fsyncContext = vm.createContext({
      process: { platform: 'android', env: { HOME: '/data/data/com.termux/files/home' } },
      resolve: posix.resolve, parse: posix.parse, constants: { O_RDONLY: 0 },
      open: async () => { throw Object.assign(new Error('blocked ancestor'), { code: 'EACCES' }) },
    })
    vm.runInContext(syncFunction + '\nthis.sync = syncDirectory', fsyncContext)
    await fsyncContext.sync('/data/data')
    await assert.rejects(fsyncContext.sync('/data/data/com.termux/files/home/attachments'), { code: 'EACCES' })
    fsyncContext.process.platform = 'linux'
    await assert.rejects(fsyncContext.sync('/data/data'), { code: 'EACCES' })
    fsyncContext.process.platform = 'android'
    let closed = 0
    fsyncContext.open = async () => ({ sync: async () => { throw Object.assign(new Error('unsupported'), { code: 'EINVAL' }) }, close: async () => { closed++ } })
    await fsyncContext.sync('/')
    assert.equal(closed, 1)
    await assert.rejects(fsyncContext.sync('/data/data/com.termux/files/home/attachments'), { code: 'EINVAL' })
    assert.equal(closed, 2, 'directory handle always closed')

    if (process.platform !== 'linux') { t.diagnostic('Real flock / renameat2 runtime contracts require Linux/Android; run this suite with Linux Node.'); return }
    const publication = attachment.slice(0, attachment.indexOf('\nimport { dirname'))
    const pubModule = await import('data:text/javascript;base64,' + Buffer.from(publication.replace('process.platform !== "android"', 'false') + '\nexport {androidPublishExclusive}').toString('base64'))
    if (process.env.DSH_REQUIRE_NONROOT === '1') assert.notEqual(process.getuid(), 0, 'readonly publication must run as a nonroot uid')
    const readonlySource = join(dir, 'readonly-source'), readonlyTarget = join(dir, 'readonly-alias')
    writeFileSync(readonlySource, 'immutable attachment')
    chmodSync(readonlySource, 0o400)
    await pubModule.androidPublishExclusive(readonlySource, readonlyTarget)
    assert.equal(readFileSync(readonlyTarget, 'utf8'), 'immutable attachment')
    assert.equal(statSync(readonlyTarget).mode & 0o777, 0o400, 'immutable alias preserves mode 0400')
    assert.equal(readFileSync(readonlySource, 'utf8'), 'immutable attachment', 'readonly original retained')
    const source = join(dir, 'source'), target = join(dir, 'target')
    writeFileSync(source, 'original immutable bytes')
    await pubModule.androidPublishExclusive(source, target)
    assert.equal(readFileSync(target, 'utf8'), 'original immutable bytes')
    writeFileSync(source, 'replacement bytes')
    await assert.rejects(pubModule.androidPublishExclusive(source, target), { code: 'EEXIST' })
    assert.equal(readFileSync(target, 'utf8'), 'original immutable bytes')
    assert.equal(readFileSync(source, 'utf8'), 'replacement bytes', 'staged source retained')
    const destinations = await Promise.allSettled(Array.from({ length: 8 }, () => pubModule.androidPublishExclusive(source, join(dir, 'race'))))
    assert.equal(destinations.filter(r => r.status === 'fulfilled').length, 1)
    assert.ok(destinations.filter(r => r.status === 'rejected').every(r => r.reason.code === 'EEXIST'))

    const lockSource = readFileSync(join(dir, 'node-addon-system/lib/flock.js'), 'utf8')
    const lockHelper = lockSource.slice(0, lockSource.indexOf('/** Lazy POSIX flock entry'))
    const lock = await import('data:text/javascript;base64,' + Buffer.from(lockHelper + '\nexport {androidTryLockExclusive}').toString('base64'))
    const { open } = await import('node:fs/promises')
    const a = await open(join(dir, 'lease'), 'w'), b = await open(join(dir, 'lease'), 'w')
    try {
      await lock.androidTryLockExclusive(a.fd)
      await assert.rejects(lock.androidTryLockExclusive(b.fd), { code: 'EAGAIN' })
      await a.close()
      await lock.androidTryLockExclusive(b.fd)
    } finally { await a.close(); await b.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
