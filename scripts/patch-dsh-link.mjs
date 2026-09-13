// patch-dsh-link.mjs — Android SELinux denies hardlink(2) to app uids, so the
// link()-based atomic publish in the DSH stores fails with EACCES and "send
// message" dies. Rewrite those publish paths to rename()/copy+rename().
//
// Handles both the 0.1.0-rc.6 shape and the 0.1.5 shape (the call sites moved and
// there are two of them now: staging publish + immutable alias). Idempotent.
// Usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2]
if (!base) {
  console.error('usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai dir>')
  process.exit(2)
}

/** Each target lists [anchor, replacement] edits; all hits are replaced. */
const targets = [
  {
    file: join(base, 'dsh-session-persistence-jsonl/lib/index.js'),
    edits: [
      ['import { link, mkdir, mkdtemp', 'import { rename, mkdir, mkdtemp'],
      ['import { link, lstat, mkdir, mkdtemp', 'import { rename, lstat, mkdir, mkdtemp'],
      ['await link(tmp, finalPath);', 'await rename(tmp, finalPath);'],
      // rename consumes the temp file; the follow-up rm() already uses force:true.
    ],
  },
  {
    file: join(base, 'dsh-attachment-local/lib/index.js'),
    edits: [
      ['import { chmod, link, mkdir', 'import { chmod, copyFile, link, mkdir'],
      [
        'await link(temporary, target);',
        'await rename(temporary, target);',
      ],
      // 0.1.5 staging publish: rename() consumes staged.path, so the trailing
      // unlink must tolerate ENOENT (it used to be a no-op after a hardlink).
      ['await link(staged.path, target);', 'await rename(staged.path, target);'],
      ['\t\tawait unlink(staged.path);', '\t\tawait unlink(staged.path).catch(() => {});'],
      // 0.1.5 immutable alias: hard-linking a *second* name onto an existing
      // object cannot be a rename (that would move the original away), so copy
      // to a sibling temp name and rename it into place — still atomic.
      ['await link(source, target);', 'await androidAlias(source, target);'],
    ],
  },
]

const aliasHelper = [
  '',
  '/** Android: hardlink(2) is denied for app uids (SELinux) — publish an alias by',
  ' * copying to a same-directory temp name and renaming it into place. */',
  'async function androidAlias(source, target) {',
  '\tconst tmp = `${target}.aliastmp-${process.pid}-${Date.now()}`;',
  '\tawait copyFile(source, tmp);',
  '\tawait rename(tmp, target);',
  '}',
].join('\n')

for (const t of targets) {
  let src
  try { src = readFileSync(t.file, 'utf8') } catch { console.error('skip (missing): ' + t.file); continue }
  let changed = 0
  for (const [from, to] of t.edits) {
    if (!src.includes(from)) continue
    src = src.split(from).join(to)
    changed++
  }
  if (changed === 0) {
    console.log('already patched (no anchors left): ' + t.file)
    continue
  }
  // Inject the alias helper once, right after the fs/promises import line.
  if (src.includes('androidAlias(source, target)') && !src.includes('async function androidAlias(')) {
    src = src.replace(/(import \{[^}]*\} from "node:fs\/promises";)/, '$1\n' + aliasHelper)
  }
  writeFileSync(t.file, src)
  console.log(`patched (${changed} edit group(s)): ` + t.file)
}
