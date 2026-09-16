// patch-dsh-flock-android.mjs — unblock session writes on Android.
//
// 0.1.5's session store takes an exclusive POSIX flock before it materialises a
// session log (`@deepseek-ai/node-addon-system/flock`). That module refuses any
// platform other than linux/darwin:
//
//   if (platform !== 'linux' && platform !== 'darwin') throw ERR_FLOCK_UNSUPPORTED_PLATFORM
//
// and Android reports `process.platform === 'android'`, so the rejection surfaces
// inside the session-write path: the store creates `session.lock`, never writes
// `session.jsonl.zstd`, and every turn hangs in silence — the web UI sits on
// "正在加载模型…" with no model request at all (measured on the 13 Pro,
// 0.1.5-rc.2, 2026-09-16). There is no prebuilt addon for android-arm64 (bionic
// is neither glibc nor musl), so treat the lock as uncontended instead: it only
// arbitrates writers inside one Harness home, which is a single DSH process here.
//
// Idempotent. Usage: node patch-dsh-flock-android.mjs <path to @deepseek-ai/node-addon-system/lib/flock.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh-flock-android.mjs <path-to-node-addon-system-lib-flock.js>')
  process.exit(2)
}
let src = readFileSync(target, 'utf8')
if (src.includes("platform === 'android'")) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

const anchor = [
  'export async function tryLockExclusive(fd) {',
  '    const errno = await new Promise((resolve) => {',
].join('\n')

const replacement = [
  'export async function tryLockExclusive(fd) {',
  '    // Android: no prebuilt flock addon exists (bionic is neither glibc nor musl)',
  '    // and loadBinding() would reject, leaving the session log unwritten and every',
  '    // turn hanging. The lock only arbitrates writers within one Harness home — a',
  '    // single DSH process on this device — so report it as uncontended.',
  "    if (process.platform === 'android')",
  '        return;',
  '    const errno = await new Promise((resolve) => {',
].join('\n')

if (!src.includes(anchor)) {
  console.error('patch anchor not found — is this the right file/build?')
  process.exit(1)
}
writeFileSync(target, src.replace(anchor, replacement))
console.log('patched: ' + target)
