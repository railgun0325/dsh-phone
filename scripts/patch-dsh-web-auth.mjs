// Restrict the on-device cookie exemption to an actual loopback socket and a
// loopback Host, with the upstream Origin / Fetch Metadata guard still enforced.
import { readFileSync } from 'node:fs'
import { replaceOnce, savePatches } from './patch-utils.mjs'
const target = process.argv[2]
if (!target) throw new Error('usage: node patch-dsh-web-auth.mjs <client-connection/lib/index.js>')
let src = readFileSync(target, 'utf8')
const helper = `
// dsh-phone: socket peer, authority, Origin and Fetch Metadata must all agree.
function androidLocalBrowser(request) {
	const peer = request.socket?.remoteAddress;
	if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") return false;
	const authority = requestAuthority(request.headers);
	if (authority === void 0 || !/^(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?$/.test(authority)) return false;
	if (!isTrustedApiRequest(request, [])) return false;
	const origin = header$1(request.headers, "origin");
	if (origin !== void 0) {
		try { if (new URL(origin).origin !== new URL("http://" + authority).origin) return false; }
		catch { return false; }
	}
	return true;
}
`
const edits = [
  ['\tauthorizeIndex(req, res) {\n\t\t/* v8 ignore next -- node:http always supplies url on server requests. */', '\tauthorizeIndex(req, res) {\n\t\tif (androidLocalBrowser(req)) return true;\n\t\t/* v8 ignore next -- node:http always supplies url on server requests. */'],
  ['\trequestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;', '\trequestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\tif (androidLocalBrowser(request)) return void 0;\n\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;'],
]
if (src.includes(helper) && edits.every(([from, to]) => !src.includes(from) && src.includes(to))) console.log('verified socket-bound loopback browser authentication')
else {
  if (src.includes('loopbackAuthority') || src.includes('androidLocalBrowser')) throw new Error('unsafe or partial old browser auth patch; reinstall pristine client-connection')
  for (const [from, to] of edits) src = replaceOnce(src, from, to, 'browser authentication')
  savePatches([[target, helper + src]])
}
