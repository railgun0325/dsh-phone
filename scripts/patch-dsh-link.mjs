// patch-dsh-link.mjs — replace link()-based atomic publish with rename() in the
// compiled DSH session/attachment stores. Android SELinux denies hardlink(2) to
// app uids, so session materialization fails with EACCES ("send message" fails)
// otherwise. Idempotent: re-running is a no-op once patched.
// Usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2]
if (!base) {
  console.error('usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai dir>')
  process.exit(2)
}

const targets = [
  {
    file: join(base, 'dsh-session-persistence-jsonl/lib/index.js'),
    importFrom: 'import { link, mkdir, mkdtemp',
    importTo: 'import { rename, mkdir, mkdtemp',
    callFrom: 'await link(tmp, finalPath);',
    callTo: 'await rename(tmp, finalPath);',
  },
  {
    file: join(base, 'dsh-attachment-local/lib/index.js'),
    importFrom: 'import { chmod, link, mkdir',
    importTo: 'import { chmod, rename, mkdir',
    callFrom: 'await link(temporary, target);',
    callTo: 'await rename(temporary, target);',
  },
]

for (const t of targets) {
  let src
  try { src = readFileSync(t.file, 'utf8') } catch { console.error('skip (missing): ' + t.file); continue }
  if (src.includes(t.callTo) && src.includes(t.importTo)) {
    console.log('already patched: ' + t.file)
    continue
  }
  let changed = 0
  if (src.includes(t.importFrom)) { src = src.replace(t.importFrom, t.importTo); changed++ }
  if (src.includes(t.callFrom)) { src = src.replace(t.callFrom, t.callTo); changed++ }
  if (changed !== 2) {
    console.error('patch anchors not found in ' + t.file + ' (' + changed + '/2) — is this the right DSH build?')
    process.exitCode = 1
    continue
  }
  writeFileSync(t.file, src)
  console.log('patched: ' + t.file)
}
