// patch-dsh.mjs — make @deepseek-ai/dsh-subprocess-local load on Android.
// The package statically imports node-pty (native addon, unavailable on
// Android). This rewrites the built lib/index.js to lazy-load it, so the
// subprocess seam mounts and only the interactive PTY fails at first use.
// Handles both the 0.1.0-rc.6 and the 0.1.5 call sites (the latter lives in
// `async spawnTerminal(spec)`). Idempotent: re-running is a no-op.
// Usage: node patch-dsh.mjs <path to dsh-subprocess-local/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh.mjs <path-to-subprocess-local-lib-index.js>')
  process.exit(2)
}
let src = readFileSync(target, 'utf8')
if (src.includes('loadNodePty')) {
  console.log('already patched — nothing to do')
  process.exit(0)
}
const lazy = [
  'let nodePty;',
  'async function loadNodePty() {',
  '\tif (nodePty !== void 0) return nodePty;',
  '\tnodePty = await import("node-pty");',
  '\treturn nodePty;',
  '}',
].join('\n')

let calls = 0
const callSites = [
  // 0.1.0-rc.6
  [
    'new LocalTerminalHandle(nodePty.spawn(file, [...spec.argv.slice(1)], options), inspector, spec.graceMs)',
    'new LocalTerminalHandle((await loadNodePty()).spawn(file, [...spec.argv.slice(1)], options), inspector, spec.graceMs)',
  ],
  // 0.1.5 — inside async spawnTerminal(spec)
  [
    'terminal = nodePty.spawn(scope?.command ?? file, scope?.args ?? [...spec.argv.slice(1)], options);',
    'terminal = (await loadNodePty()).spawn(scope?.command ?? file, scope?.args ?? [...spec.argv.slice(1)], options);',
  ],
]

src = src.replace('import * as nodePty from "node-pty";', lazy)
for (const [from, to] of callSites) {
  if (!src.includes(from)) continue
  src = src.split(from).join(to)
  calls++
}

if (!src.includes('loadNodePty') || calls === 0) {
  console.error('patch anchors not found (lazy import=' + src.includes('loadNodePty') + ', call sites=' + calls + ') — is this the right file/build?')
  process.exit(1)
}
writeFileSync(target, src)
console.log('patched (' + calls + ' call site(s)): ' + target)
