// patch-dsh.mjs — make @deepseek-ai/dsh-subprocess-local load on Android.
//
// 0.1.x statically imports node-pty (native addon, unavailable on Android). This
// rewrites the built lib/index.js to lazy-load it, so the subprocess seam mounts
// and only the interactive PTY fails at first use.
//
// 0.2.1-rc.2 already loads node-pty through createLazyRequire(), so there is
// nothing left to rewrite there. Decide by capability, not by version number: a
// build that already lazy-loads needs no patch, and reporting "not needed" with
// exit 0 is the correct outcome — a deploy must not die on it.
//
// Handles both the 0.1.0-rc.6 and the 0.1.5 call sites (the latter lives inside
// `async spawnTerminal(spec)`). Idempotent: re-running is a no-op.
// Usage: node patch-dsh.mjs <path to dsh-subprocess-local/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh.mjs <path-to-subprocess-local-lib-index.js>')
  process.exit(2)
}
const src = readFileSync(target, 'utf8')

const STATIC_IMPORT = 'import * as nodePty from "node-pty";'
const LAZY_MARKERS = [
  'createLazyRequire("node-pty"',
  "createLazyRequire('node-pty'",
  'requireNodePty',
  'loadNodePty',
]

if (!src.includes(STATIC_IMPORT) && LAZY_MARKERS.some((marker) => src.includes(marker))) {
  console.log('[skip] 上游已自带懒加载，这个补丁不需要: ' + target)
  process.exit(0)
}
if (src.includes('loadNodePty')) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

let patched = src
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

patched = patched.replace(STATIC_IMPORT, lazy)
for (const [from, to] of callSites) {
  if (!patched.includes(from)) continue
  patched = patched.split(from).join(to)
  calls++
}

if (!patched.includes('loadNodePty') || calls === 0) {
  console.error(
    '既没有懒加载可跳过，锚点也没命中（static import=' + patched.includes(STATIC_IMPORT)
    + ', call sites=' + calls + '）—— 需要人工核对该版本: ' + target,
  )
  process.exit(1)
}
writeFileSync(target, patched)
console.log('patched (' + calls + ' call site(s)): ' + target)
