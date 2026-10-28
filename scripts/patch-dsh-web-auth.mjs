// patch-dsh-web-auth.mjs — let the on-device shell actually use the DSH Web UI.
//
// 0.1.5 and later gate both the index and every /api call behind browser
// authentication: a per-process, randomly generated launch token (not
// configurable, only reachable from the startup banner
// `dsh web: http://127.0.0.1:3080/?token=…`) which mints a signed cookie. The
// Android shell (WebActivity) opens the plain loopback origin, has no cookie and
// no URL bar to paste a token into, so the app would show the index but every RPC
// would answer 401. Before 0.1.5 loopback was unauthenticated anyway, so this
// patch restores exactly that — for loopback authorities only. Requests arriving
// over the LAN still need the token or its cookie.
//
// Two build shapes are handled:
//   * 0.2.1-rc.2 — one choke point, `isAuthenticated()`. `authorizeIndex()`,
//     `Connection.admit()` (and thus `requestRejection`) and the connect path all
//     call it, so a single edit covers index, API calls and socket upgrades.
//   * 0.1.x — the two separate hooks (`authorizeIndex`, `requestRejection`) and
//     the older `requestAuthority(headers)` helper.
//
// Idempotent. Usage: node patch-dsh-web-auth.mjs <path to dsh-client-connection/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh-web-auth.mjs <path-to-dsh-client-connection-lib-index.js>')
  process.exit(2)
}
let src = readFileSync(target, 'utf8')
let changed = 0

const LOOPBACK_COMMENT = [
  '\t\t// Android: the on-device shell (WebActivity) opens the plain loopback origin',
  '\t\t// and cannot present the per-process launch token. Loopback was unauthenticated',
  '\t\t// before 0.1.5 — keep that for loopback authorities only, so the token still',
  '\t\t// guards anything reachable from the LAN.',
].join('\n')

const LOOPBACK_TEST = '/^(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?$/'

// --- 1. 0.2.1: authenticate() is the single choke point ----------------------
const authAnchor = [
  '\tisAuthenticated(request, secure = false) {',
  '\t\treturn this.authenticate(request, secure)?.version === COOKIE_PAYLOAD_VERSION;',
  '\t}',
].join('\n')
if (src.includes(authAnchor)) {
  src = src.replace(authAnchor, [
    '\tisAuthenticated(request, secure = false) {',
    LOOPBACK_COMMENT,
    '\t\tconst loopbackAuthority = requestAudience(request.headers, secure);',
    '\t\tif (loopbackAuthority !== void 0 && ' + LOOPBACK_TEST + '.test(loopbackAuthority)) return true;',
    '\t\treturn this.authenticate(request, secure)?.version === COOKIE_PAYLOAD_VERSION;',
    '\t}',
  ].join('\n'))
  changed++
}

// --- 2. 0.1.x: index requests -----------------------------------------------
const indexAnchor = [
  '\tauthorizeIndex(req, res) {',
  '\t\t/* v8 ignore next -- node:http always supplies url on server requests. */',
  '\t\tconst url = new URL(req.url ?? "/", "http://dsh.invalid");',
].join('\n')
if (src.includes(indexAnchor)) {
  src = src.replace(indexAnchor, [
    '\tauthorizeIndex(req, res) {',
    LOOPBACK_COMMENT,
    '\t\tconst loopbackAuthority = requestAuthority(req.headers);',
    '\t\tif (loopbackAuthority !== void 0 && ' + LOOPBACK_TEST + '.test(loopbackAuthority)) return true;',
    '\t\t/* v8 ignore next -- node:http always supplies url on server requests. */',
    '\t\tconst url = new URL(req.url ?? "/", "http://dsh.invalid");',
  ].join('\n'))
  changed++
}

// --- 3. 0.1.x: /api requests -------------------------------------------------
const apiAnchor = [
  '\trequestRejection(request) {',
  '\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;',
  '\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;',
].join('\n')
if (src.includes(apiAnchor)) {
  src = src.replace(apiAnchor, [
    '\trequestRejection(request) {',
    '\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;',
    LOOPBACK_COMMENT,
    '\t\tconst loopbackAuthority = requestAuthority(request.headers);',
    '\t\tif (loopbackAuthority !== void 0 && ' + LOOPBACK_TEST + '.test(loopbackAuthority)) return void 0;',
    '\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;',
  ].join('\n'))
  changed++
}

if (changed === 0) {
  if (src.includes('loopbackAuthority')) console.log('already patched — nothing to do')
  else { console.error('patch anchors not found — is this the right file/build?'); process.exit(1) }
  process.exit(0)
}
writeFileSync(target, src)
console.log(`patched (${changed} edit group(s)): ` + target)
