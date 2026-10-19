// Upstream 0.2.0 uses dsh-lazy-require already. Validate its binding AND use;
// older supported builds need the explicit asynchronous import below.
import { readFileSync } from 'node:fs'
import { replaceOnce, savePatches } from './patch-utils.mjs'
const target = process.argv[2]
if (!target) throw new Error('usage: node patch-dsh.mjs <subprocess-local/lib/index.js>')
let src = readFileSync(target, 'utf8')
const staticImport = 'import * as nodePty from "node-pty";'
if (src.includes('const requireNodePty = createLazyRequire("node-pty", import.meta.url);')) {
  if (!src.includes('import { createLazyRequire } from "@deepseek-ai/dsh-lazy-require";') ||
      !src.includes('terminal = requireNodePty().spawn(') || src.includes(staticImport)) {
    throw new Error('partial or unknown upstream node-pty lazy binding')
  }
  console.log('verified upstream lazy node-pty (0.2.0); interactive PTY still requires an Android native backend')
} else {
  const lazy = 'let nodePty;\nasync function loadNodePty() {\n\treturn nodePty ??= await import("node-pty");\n}'
  const anchors = [
    ['new LocalTerminalHandle(nodePty.spawn(file, [...spec.argv.slice(1)], options), inspector, spec.graceMs)', 'new LocalTerminalHandle((await loadNodePty()).spawn(file, [...spec.argv.slice(1)], options), inspector, spec.graceMs)'],
    ['terminal = nodePty.spawn(scope?.command ?? file, scope?.args ?? [...spec.argv.slice(1)], options);', 'terminal = (await loadNodePty()).spawn(scope?.command ?? file, scope?.args ?? [...spec.argv.slice(1)], options);'],
  ]
  if (src.includes(lazy) && !src.includes(staticImport) && anchors.some(([, to]) => src.includes(to)) && !src.includes('nodePty.spawn(')) {
    console.log('verified existing Android node-pty lazy patch')
  } else {
    src = replaceOnce(src, staticImport, lazy, 'node-pty import')
    let calls = 0
    for (const [from, to] of anchors) if (src.includes(from)) { src = replaceOnce(src, from, to, 'node-pty spawn'); calls++ }
    if (calls !== 1 || src.includes('nodePty.spawn(')) throw new Error('unknown/partial node-pty call sites; refusing to write')
    savePatches([[target, src]])
  }
}
