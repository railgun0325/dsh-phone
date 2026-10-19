// Device gate: exercise the installed helpers, no API key and no root actions.
import { mkdtemp, writeFile, readFile, open, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { installation } from './dsh-compat.mjs'
if (process.platform !== 'android') throw new Error('Run this device gate with Android Termux Node; host tests do not prove device compatibility')
const tree = installation(process.argv[2])
const dir = await mkdtemp(join(tmpdir(), 'dsh-phone-runtime-'))
try {
  const source = await readFile(join(tree.component('dsh-attachment-local'), 'lib/index.js'), 'utf8')
  const start = source.indexOf('// dsh-phone: atomic exclusive publication;')
  const end = source.indexOf('\n}\n', start) + 3
  if (start < 0 || end <= start) throw new Error('Installed atomic publication helper missing')
  const module = await import('data:text/javascript;base64,' + Buffer.from(source.slice(start, end) + '\nexport { androidPublishExclusive };').toString('base64'))
  const src = join(dir, 'staged'), dest = join(dir, 'published')
  await writeFile(src, 'device-runtime-proof')
  await module.androidPublishExclusive(src, dest)
  assert.equal(await readFile(dest, 'utf8'), 'device-runtime-proof')
  await writeFile(src, 'replacement')
  await assert.rejects(module.androidPublishExclusive(src, dest), { code: 'EEXIST' })
  assert.equal(await readFile(dest, 'utf8'), 'device-runtime-proof')
  assert.equal(await readFile(src, 'utf8'), 'replacement')
  const race = await Promise.allSettled(Array.from({ length: 4 }, () => module.androidPublishExclusive(src, join(dir, 'race'))))
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1)
  assert.ok(race.filter(r => r.status === 'rejected').every(r => r.reason.code === 'EEXIST'))
  assert.ok((await readdir(dir)).every(name => !name.includes('.dsh-phone-')))
  console.log('ok bionic atomic exclusive publish, EEXIST, source retained, four-writer race')
  const { tryLockExclusive } = await import(pathToFileURL(join(tree.component('node-addon-system'), 'lib/flock.js')).href)
  const a = await open(join(dir, 'lease'), 'w'), b = await open(join(dir, 'lease'), 'w')
  try {
    await tryLockExclusive(a.fd)
    await assert.rejects(tryLockExclusive(b.fd), { code: 'EAGAIN' })
    await a.close()
    await tryLockExclusive(b.fd)
  } finally { await a.close(); await b.close() }
  console.log('ok real descriptor flock exclusion and release')
  const sharp = tree.require('sharp')
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer()
  assert.equal((await sharp(png).metadata()).width, 2)
  console.log('ok Sharp encode/decode; RUNTIME_OK (live API turn and Android tools still require phone acceptance)')
} finally { await rm(dir, { recursive: true, force: true }) }
