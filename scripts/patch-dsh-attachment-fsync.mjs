// patch-dsh-attachment-fsync.mjs — let the attachment store save on Android.
//
// Two Android-only failures live in `dsh-attachment-local`'s durability walk.
// `ensureDurableDirectory` fsyncs *every* ancestor directory between the target and
// a caller-vouched boundary; for the DSH_HOME proof the boundary is the filesystem
// root (`ensureDurableHome` -> `ensureDurableDirectory(home, parse(home).root)`), so
// the walk reaches `/data/data` and `/` on this phone:
//
//   1. `open('/data/data', O_RDONLY)` -> EACCES. Android's app sandbox forbids
//      opening that directory for every app uid (root excepted).
//   2. `fsync()` on the `/` directory handle -> EINVAL. This kernel/filesystem
//      rejects directory fsync at the root.
//
// Either one aborts the whole save, and the session controller surfaces it as
// `session/agent-busy: prompt rejected` with a reason that never mentions the
// attachment — i.e. attaching an image or a file just fails, and the message points
// at the wrong subsystem. Both are best-effort crash-durability extras for ancestor
// *entries*: the directories exist either way, so skipping the unsupported level
// keeps the write correct.
//
// The staged-file fsync (the second `handle.sync()` in the file) is left alone — it
// works here and it is the one that actually matters for the object's bytes.
//
// Idempotent. Usage: node patch-dsh-attachment-fsync.mjs <path to dsh-attachment-local/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh-attachment-fsync.mjs <path-to-dsh-attachment-local-lib-index.js>')
  process.exit(2)
}
let src = readFileSync(target, 'utf8')

if (src.includes('reject fsync on a directory fd')) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

const T = '\t'
const guard = [
  T + 'if (process.platform === "win32") return;',
  T + '/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */',
].join('\n')

const tolerantBody = [
  T + 'let handle;',
  T + 'try {',
  T + T + 'handle = await open(path, constants.O_RDONLY);',
  T + '} catch (error) {',
  T + T + '/* Android app sandboxes forbid opening ancestor directories such as',
  T + T + '   /data/data (EACCES/EPERM) — expected, not a durability failure: those',
  T + T + '   entries exist and only this extra fsync is skipped. */',
  T + T + 'if (error && (error.code === "EACCES" || error.code === "EPERM")) return;',
  T + T + 'throw error;',
  T + '}',
  T + 'try {',
  T + T + 'await handle.sync();',
  T + '} catch (error) {',
  T + T + '/* Some Android kernels reject fsync on a directory fd with EINVAL (the',
  T + T + '   filesystem root here does). Ancestor-entry durability is best-effort. */',
  T + T + 'if (error && (error.code === "EINVAL" || error.code === "ENOTSUP" || error.code === "EOPNOTSUPP" || error.code === "ENOSYS")) return;',
  T + T + 'throw error;',
  T + '} finally {',
  T + T + 'await handle.close();',
  T + '}',
].join('\n')

// Pristine shape (one edit covers both failures).
const pristine = [
  guard,
  T + 'const handle = await open(path, constants.O_RDONLY);',
  T + 'try {',
  T + T + 'await handle.sync();',
  T + '} finally {',
  T + T + 'await handle.close();',
  T + '}',
].join('\n')

// Shape left by the first revision of this patcher (open tolerated, fsync not).
const intermediate = [
  T + T + 'if (error && (error.code === "EACCES" || error.code === "EPERM")) return;',
  T + T + 'throw error;',
  T + '}',
  T + 'try {',
  T + T + 'await handle.sync();',
  T + '} finally {',
  T + T + 'await handle.close();',
  T + '}',
].join('\n')

const tolerantTail = tolerantBody.split('\n').slice(tolerantBody.split('\n').findIndex((l) => l === T + 'try {')).join('\n')

let changed = false
if (src.includes(pristine)) {
  src = src.replace(pristine, guard + '\n' + tolerantBody)
  changed = true
} else if (src.includes(intermediate)) {
  const head = intermediate.slice(0, intermediate.indexOf(T + 'try {'))
  src = src.replace(intermediate, head + tolerantTail.slice(tolerantTail.indexOf(T + 'try {')))
  changed = true
}

if (!changed) {
  console.error('syncDirectory anchor not found — is this the right file/build?')
  process.exit(1)
}
writeFileSync(target, src)
console.log('patched: ' + target)
