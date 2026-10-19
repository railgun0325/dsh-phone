import { readFileSync } from 'node:fs'
import { replaceOnce, savePatches } from './patch-utils.mjs'
const target = process.argv[2]
if (!target) throw new Error('usage: node patch-dsh-attachment-fsync.mjs <attachment-local/lib/index.js>')
let src = readFileSync(target, 'utf8')
const from = `async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
	/* v8 ignore stop */
}`
const to = `async function syncDirectory(path) {
	// dsh-phone: only Android's inaccessible HOME ancestors are best-effort.
	if (process.platform === "win32") return;
	const home = resolve(process.env.HOME ?? ".");
	const level = resolve(path);
	const ancestor = level === parse(home).root || home.startsWith(level + "/");
	let handle;
	try { handle = await open(path, constants.O_RDONLY); }
	catch (error) {
		if (process.platform === "android" && ancestor && (error?.code === "EACCES" || error?.code === "EPERM")) return;
		throw error;
	}
	try { await handle.sync(); }
	catch (error) {
		if (process.platform === "android" && ancestor && ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(error?.code)) return;
		throw error;
	} finally { await handle.close(); }
}`
if (src.includes(to) && !src.includes(from)) console.log('verified Android-only ancestor directory fsync policy')
else savePatches([[target, replaceOnce(src, from, to, 'attachment directory fsync')]])
