// patch-dsh-link.mjs — Android SELinux denies hardlink(2) to app uids, so the
// link()-based publish paths in the DSH stores fail with EACCES and "send
// message" dies (or, worse, the module fails to load at all). Rewrite those
// publish paths to rename()/copyFile() while keeping every other `link` binding
// intact — 0.1.5 also uses `link` as a shorthand property in `defaultFileSystem`.
//
// Handles the 0.1.0-rc.6 shape and the 0.1.5 shape (extra call sites, longer
// import list). Idempotent.
// Usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2]
if (!base) {
  console.error('usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai dir>')
  process.exit(2)
}

/** Each target lists [anchor, replacement] edits; every hit is replaced. */
const targets = [
  {
    file: join(base, 'dsh-session-persistence-jsonl/lib/index.js'),
    edits: [
      // 0.1.5: keep `link` (defaultFileSystem uses it as a shorthand property) and
      // add `copyFile`/`rename` for the publish rewrites below. `constants` may or
      // may not already be imported by this build — decide that per file below.
      // `constants` is already taken by node:zlib in this file, so alias the
      // fs/promises one instead of colliding with it.
      //
      // `rename` MUST be in this list. The first revision of this patcher added the
      // rewrites but not the binding, so every atomic publish threw
      // `ReferenceError: rename is not defined` inside a promise nobody awaited.
      // The symptom was not a visible error but a turn that never started:
      // session.lock existed, session.jsonl.zstd never appeared, the process sat
      // idle in processTimers, and no model connection was ever opened.
      [
        'import { link, lstat, mkdir, mkdtemp',
        'import { constants as fsConstants, copyFile, link, lstat, mkdir, mkdtemp, rename',
      ],
      // Repair the revision-1 shape already on disk (import list patched, `rename`
      // still missing). Keep the left side in sync with what this build ships.
      [
        'import { constants as fsConstants, copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate }',
        'import { constants as fsConstants, copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate }',
      ],
      // 0.1.5 `publishCurrentExclusive`: a hardlink here is denied on Android, and a
      // rename would consume the staged file the caller still owns — copy with
      // COPYFILE_EXCL, which preserves the same exclusive-create (EEXIST) contract.
      [
        'await internals.fs.link(staged, currentPath);',
        'await copyFile(staged, currentPath, fsConstants.COPYFILE_EXCL);',
      ],
      // The atomic publish itself. rename() consumes the temp file; the follow-up
      // rm(tmp, { force: true }) tolerates ENOENT.
      ['await link(tmp, finalPath);', 'await rename(tmp, finalPath);'],
      // 0.1.0-rc.6 shape: shorter import list, no defaultFileSystem shorthand.
      ['import { link, mkdir, mkdtemp', 'import { rename, mkdir, mkdtemp'],
    ],
  },
  {
    file: join(base, 'dsh-attachment-local/lib/index.js'),
    edits: [
      ['import { chmod, link, mkdir', 'import { chmod, copyFile, link, mkdir'],
      ['await link(temporary, target);', 'await rename(temporary, target);'],
      // 0.1.5 staging publish: rename() consumes staged.path, so the trailing
      // unlink must tolerate ENOENT (it used to be a no-op after a hardlink).
      ['await link(staged.path, target);', 'await rename(staged.path, target);'],
      ['\t\tawait unlink(staged.path);', '\t\tawait unlink(staged.path).catch(() => {});'],
      // 0.1.5 immutable alias: hard-linking a *second* name onto an existing object
      // cannot be a rename (that would move the original away), so copy to a
      // sibling temp name and rename it into place — still atomic.
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

let found = 0
let touched = 0
for (const t of targets) {
  let src
  try { src = readFileSync(t.file, 'utf8') } catch { console.error('skip (missing): ' + t.file); continue }
  found++
  let changed = 0
  for (const [from, to] of t.edits) {
    if (!src.includes(from)) continue
    src = src.split(from).join(to)
    changed++
  }
  if (changed === 0) {
    console.log('already patched (no anchors left): ' + t.file)
    touched++
    continue
  }
  // Inject the alias helper once, right after the fs/promises import line.
  if (src.includes('androidAlias(source, target)') && !src.includes('async function androidAlias(')) {
    src = src.replace(/(import \{[^}]*\} from "node:fs\/promises";)/, '$1\n' + aliasHelper)
  }
  writeFileSync(t.file, src)
  touched++
  console.log(`patched (${changed} edit group(s)): ` + t.file)
}

// A deploy against the wrong directory layout used to print "skip (missing)" for
// every target and still exit 0, so the caller reported success with every gate
// still open. Assert that at least one real target was found and handled.
if (found === 0) {
  console.error('no patch target found under ' + base + ' — wrong layout or wrong install root')
  process.exit(1)
}
console.log(`targets found: ${found}, handled: ${touched}`)
