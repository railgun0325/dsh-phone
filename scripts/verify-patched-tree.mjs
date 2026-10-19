// Read-only verification: strict patch validators must need no writes.
// Usage: node verify-patched-tree.mjs [DSH_HOME] [DSH_INSTALL]
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { installation } from './dsh-compat.mjs'
const home = resolve(process.argv[2] ?? join(process.env.HOME ?? '/data/data/com.termux/files/home', '.dsh'))
const live = process.argv[3] ?? process.env.DSH_INSTALL ?? '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh'
let failures = 0
async function gate(name, fn) {
  try { await fn(); console.log(`ok ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
}
const tree = installation(live)
console.log(`tree=${tree.root} dsh=${tree.version}`)
for (const [script, target] of tree.jobs) await gate(script, () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), target], {
    env: { ...process.env, DSH_PATCH_CHECK: '1' }, encoding: 'utf8',
  })
  if (run.error || run.status !== 0) throw new Error(run.stderr || run.error?.message || run.stdout)
})
await gate('home writable', () => {
  accessSync(dirname(home), constants.W_OK)
  const probe = mkdtempSync(join(dirname(home), '.dsh-write-'))
  rmSync(probe, { recursive: true })
})
await gate('Android plugin registers against installed tools API', async () => {
  const profileRequire = createRequire(join(home, 'profiles/web/package.json'))
  const pluginPath = profileRequire.resolve('dsh-android-control')
  const plugin = await import(pathToFileURL(pluginPath).href)
  const tools = new Map()
  plugin.apply({ tools: { register(tool) {
    if (tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`)
    tools.set(tool.name, tool)
  } } })
  for (const name of ['android_shell', 'android_screenshot', 'android_tap', 'android_ui_dump']) {
    if (!tools.has(name)) throw new Error(`missing tool ${name}`)
  }
  // No device command: exercise the real defineTool argument validator.
  let rejected = false
  try { await tools.get('android_shell').execute({}, { signal: AbortSignal.timeout(1000) }) }
  catch { rejected = true }
  if (!rejected) throw new Error('invalid shell arguments were accepted')
  console.log(`registered ${tools.size} tools; no device actions executed`)
})
await gate('profile preserves required Android rows', () => {
  const profile = readFileSync(join(home, 'profiles/web/cordis.patch.yml'), 'utf8')
  if (!profile.includes('dsh-android-control')) throw new Error('Android plugin missing from web profile')
})
console.log(`${failures ? 'TREE_FAIL' : 'TREE_OK'} gates_failed=${failures}; live turns and device capabilities require separate runtime verification`)
process.exitCode = failures ? 1 : 0
