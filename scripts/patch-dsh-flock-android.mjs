// Android lacks an official node-addon-system binary. util-linux flock can
// lock an inherited descriptor: Linux flock locks the open file description,
// which remains alive in Node after the child exits, until Node closes fd.
import { readFileSync } from 'node:fs'
import { replaceOnce, savePatches } from './patch-utils.mjs'
const target = process.argv[2]
if (!target) throw new Error('usage: node patch-dsh-flock-android.mjs <node-addon-system/lib/flock.js>')
let src = readFileSync(target, 'utf8')
const helper = `
// dsh-phone: preserve real kernel flock ownership on Android.
import { spawn as androidSpawnFlock } from 'node:child_process';
function androidTryLockExclusive(fd) {
    return new Promise((resolve, reject) => {
        const child = androidSpawnFlock('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'], {
            stdio: ['ignore', 'ignore', 'pipe', fd],
        });
        let detail = '';
        child.stderr.on('data', chunk => { detail = (detail + chunk).slice(-4096); });
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (code === 0) return resolve();
            const error = new Error(code === 75 ? 'EAGAIN: flock is already held' : 'Android flock failed: ' + (detail || signal || code));
            error.code = code === 75 ? 'EAGAIN' : 'ERR_ANDROID_FLOCK';
            error.syscall = 'flock';
            reject(error);
        });
    });
}
`
const from = 'export async function tryLockExclusive(fd) {\n    const errno = await new Promise((resolve) => {'
const to = 'export async function tryLockExclusive(fd) {\n    if (process.platform === "android") return androidTryLockExclusive(fd);\n    const errno = await new Promise((resolve) => {'
if (src.includes(helper) && src.includes(to) && !src.includes(from)) console.log('verified Android inherited-descriptor flock')
else {
  if (src.includes('androidTryLockExclusive') || /if \(process.platform === ['"]android['"]\)\s*return;/.test(src)) throw new Error('unsafe or partial previous flock patch; reinstall pristine node-addon-system')
  src = replaceOnce(src, from, to, 'flock')
  savePatches([[target, helper + src]])
}
