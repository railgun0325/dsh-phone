// patch-dsh.mjs — make @deepseek-ai/dsh-subprocess-local load on Android.
// The package statically imports node-pty (native addon, unavailable on
// Android). This rewrites the built lib/index.js to lazy-load it, so the
// subprocess seam mounts and only the interactive PTY fails at first use.
// Idempotent: re-running is a no-op once the lazy loader is present.
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
src = src.replace('import * as nodePty from "node-pty";', lazy)
src = src.replace(
  'new LocalTerminalHandle(nodePty.spawn(file, [...spec.argv.slice(1)], options), inspector, spec.graceMs)',
  'new LocalTerminalHandle((await loadNodePty()).spawn(file, [...spec.argv.slice(1)], options), inspector, spec.graceMs)',
)
if (!src.includes('loadNodePty')) {
  console.error('patch anchors not found — is this the right file/build?')
  process.exit(1)
}
writeFileSync(target, src)
console.log('patched: ' + target)
