// Android forbids hardlinks for app data. Publish a durable sibling copy with
// renameat2(RENAME_NOREPLACE): preserve both atomic visibility and EEXIST, and
// leave the caller's staged source intact. Never fall back to overwriting rename.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { replaceOnce, savePatches } from './patch-utils.mjs'
const base = process.argv[2]
if (!base) throw new Error('usage: node patch-dsh-link.mjs <node_modules/@deepseek-ai>')
const specs = [
  ['dsh-session-persistence-jsonl', [
    ['await internals.fs.link(staged, currentPath);', 'await androidPublishExclusive(staged, currentPath);'],
    ['await link(tmp, finalPath);', 'await androidPublishExclusive(tmp, finalPath);'],
  ]],
  ['dsh-attachment-local', [
    ['await link(source, target);', 'await androidPublishExclusive(source, target);'],
    ['await link(staged.path, target);', 'await androidPublishExclusive(staged.path, target);'],
  ]],
]
const helper = String.raw`
// dsh-phone: atomic exclusive publication; requires bionic renameat2 and python3.
import { copyFile as androidCopyFile, constants as androidFsConstants, open as androidOpen, rm as androidRm, link as androidLink } from "node:fs/promises";
import { execFile as androidExecFile } from "node:child_process";
import { randomUUID as androidPublishId } from "node:crypto";
async function androidPublishExclusive(source, target) {
	if (process.platform !== "android") return androidLink(source, target);
	const temporary = target + ".dsh-phone-" + androidPublishId();
	let copied = false;
	try {
		await androidCopyFile(source, temporary, androidFsConstants.COPYFILE_EXCL);
		copied = true;
		// Immutable attachment sources are mode 0400; copying preserves that mode.
		// fsync needs only a readable descriptor on Linux/Android.
		const handle = await androidOpen(temporary, "r");
		try { await handle.sync(); } finally { await handle.close(); }
		const code = "import ctypes,errno,os,sys\nlibc=ctypes.CDLL(None,use_errno=True)\nf=getattr(libc,'renameat2',None)\nif f is None: print('ENOSYS'); sys.exit(1)\nf.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]\nf.restype=ctypes.c_int\nr=f(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)\nif r != 0: print(errno.errorcode.get(ctypes.get_errno(),'EIO')); sys.exit(1)\n";
		await new Promise((resolve, reject) => {
			androidExecFile("python3", ["-c", code, temporary, target], { maxBuffer: 4096 }, (error, stdout, stderr) => {
				if (!error) return resolve();
				const reason = stdout.trim();
				if (/^E[A-Z0-9]+$/.test(reason)) error.code = reason;
				error.message = "Android exclusive publication failed (" + error.code + "): " + stderr;
				reject(error);
			});
		});
	} finally { if (copied) await androidRm(temporary, { force: true }); }
}
`.replaceAll('\\t', '\t')
const changes = []
for (const [pkg, edits] of specs) {
  const file = join(base, pkg, 'lib/index.js')
  let src = readFileSync(file, 'utf8')
  const pristine = edits.every(([from]) => src.includes(from))
  const patched = src.includes(helper) && edits.every(([from, to]) => !src.includes(from) && src.includes(to))
  if (patched) { console.log(`verified atomic exclusive publication: ${file}`); continue }
  if (!pristine || src.includes('androidPublishExclusive') || src.includes('androidAlias(')) throw new Error(`unknown or unsafe prior storage patch: ${file}; reinstall pristine package`)
  for (const [from, to] of edits) src = replaceOnce(src, from, to, `${pkg} publication`)
  changes.push([file, helper + src])
}
savePatches(changes)
