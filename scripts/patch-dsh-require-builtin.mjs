// patch-dsh-require-builtin.mjs — let `dsh` boot on Android at all.
//
// 0.2.1-rc.2's `dsh-app-boot` reaches Node internals through
// `node-addon-require-builtin`, a Node-API addon published with prebuilds for
// darwin-*/linux-{gnu,musl} only. Android is bionic: no prebuild matches, the
// addon throws from its own module body, and the profile-resolution worker dies:
//
//   dsh: fatal uncaught exception: Error: dsh: host preparation failed:
//   No usable native binding found for node-addon-require-builtin-android-arm64 (auto)
//
// The shell then waits for 127.0.0.1:3080 forever ("等待 dsh 服务超时").
//
// The two host consumers (`@deepseek-ai/cordis-plugin-loader`, `@deepseek-ai/dsh-hmr`)
// and the worker's `internalModules()` ask only for `internal/...` module ids, which
// plain `require()` resolves when the process runs with `--expose-internals` — that
// is the first attempt both consumers already make. Make the addon degrade to that
// require instead of throwing at load: keep the native binding whenever it loads
// (desktop, glibc/musl hosts unchanged), fall back on Android.
//
// Idempotent. Usage: node patch-dsh-require-builtin.mjs <path to node-addon-require-builtin/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh-require-builtin.mjs <path-to-node-addon-require-builtin-lib-index.js>')
  process.exit(2)
}
let src = readFileSync(target, 'utf8')

if (src.includes('expose-internals fallback')) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

const initAnchor = [
  "const { createEntryApi } = require('node-addon-native-custom-loader');",
  "const api = createEntryApi(node_path_1.default.resolve(__dirname, '..'));",
].join('\n')

const initReplacement = [
  "const node_module_1 = require('node:module');",
  '// Android/bionic: no prebuild exists for this platform. Keep the native binding when',
  '// it loads; otherwise fall back to the plain require below (marker:',
  '// "expose-internals fallback"). The consumers only ask for internal/... ids,',
  '// which resolve directly under --expose-internals.',
  'let api;',
  'try {',
  "    api = createEntryApi(node_path_1.default.resolve(__dirname, '..'));",
  '}',
  'catch (_error) {',
  '    api = void 0;',
  '}',
  "const fallbackRequire = node_module_1.createRequire(__filename);",
].join('\n')

const isAllowedAnchor = [
  'function isAllowedInternalId(moduleId) {',
  '    return api.isAllowedInternalId(moduleId);',
  '}',
].join('\n')

const isAllowedReplacement = [
  'function isAllowedInternalId(moduleId) {',
  '    if (api !== void 0)',
  '        return api.isAllowedInternalId(moduleId);',
  "    return typeof moduleId === 'string' && /^(?:node:)?internal\\//.test(moduleId);",
  '}',
].join('\n')

const bindingInfoAnchor = [
  'function getBindingInfo() {',
  '    return api.getBindingInfo();',
  '}',
].join('\n')

const bindingInfoReplacement = [
  'function getBindingInfo() {',
  '    if (api !== void 0)',
  '        return api.getBindingInfo();',
  "    return { backend: 'expose-internals', package: void 0 };",
  '}',
].join('\n')

const requireAnchor = [
  'function requireBuiltin(moduleId) {',
  '    return api.requireBuiltin(moduleId);',
  '}',
].join('\n')

const requireReplacement = [
  'function requireBuiltin(moduleId) {',
  '    if (api !== void 0)',
  '        return api.requireBuiltin(moduleId);',
  '    // expose-internals fallback',
  '    try {',
  '        return fallbackRequire(moduleId);',
  '    }',
  '    catch (error) {',
  '        throw new Error("require-builtin: 没有可用的原生模块（Android/bionic 无预编译产物），'
  + 'require(" + moduleId + ") 失败 —— dsh 需要用 --expose-internals 启动", { cause: error });',
  '    }',
  '}',
].join('\n')

for (const [anchor, replacement, label] of [
  [initAnchor, initReplacement, 'entry-api init'],
  [requireAnchor, requireReplacement, 'requireBuiltin'],
  [isAllowedAnchor, isAllowedReplacement, 'isAllowedInternalId'],
  [bindingInfoAnchor, bindingInfoReplacement, 'getBindingInfo'],
]) {
  if (!src.includes(anchor)) {
    console.error(`anchor not found (${label}) — is this the right build of node-addon-require-builtin?`)
    process.exit(1)
  }
  src = src.replace(anchor, replacement)
}

writeFileSync(target, src)
console.log('patched (native binding kept when available, --expose-internals fallback otherwise): ' + target)
