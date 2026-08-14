/**
 * DSH plugin: give the agent hands on the Android system.
 * Rooted-device toolset over Magisk su: shell, tap/swipe/text/key events,
 * screenshot, UI-automator dump, app control, package ops, termux-api clipboard.
 * @module dsh-android-control
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'android-control'
export const inject = ['tools']

const execFileP = promisify(execFile)
// Root cannot write into the app data dir on MIUI; /data/local/tmp is root-writable and app-readable.
const SHOTS_DIR = '/data/local/tmp/dsh-shots'

/** Render any canonical JSON value as model-facing text. */
const renderJson = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

/** Magisk su candidates, in lookup order. */
const SU_CANDIDATES = ['/system/bin/su', '/system/xbin/su', '/sbin/su', 'su']
let suBin = undefined
let suChecked = false

/** Resolve a working su binary once; undefined when the device is not rooted. */
function resolveSu() {
  if (suChecked) return suBin
  suChecked = true
  for (const candidate of SU_CANDIDATES) {
    try {
      const stdout = execFileSync(candidate, ['-c', 'id'], { encoding: 'utf8', timeout: 8000 })
      if (String(stdout).includes('uid=0')) {
        suBin = candidate
        return suBin
      }
    } catch { /* try next */ }
  }
  return undefined
}

/** Shizuku bridge: local HTTP endpoint served by the DSH Phone app's daemon UserService.
 *  The token is written to ~/.dsh-bridge-token during one-tap deployment. */
const BRIDGE_PORT = 36527
let bridgeConfig = undefined
let bridgeChecked = false

function bridgeTarget() {
  if (bridgeChecked) return bridgeConfig
  bridgeChecked = true
  const candidates = [
    process.env.HOME ? process.env.HOME + '/.dsh-bridge-token' : null,
    '/data/data/com.termux/files/home/.dsh-bridge-token',
  ]
  let token = undefined
  for (const p of candidates) {
    if (!p) continue
    try { token = readFileSync(p, 'utf8').trim() } catch { token = '' }
    if (token) break
  }
  if (!token) return undefined
  bridgeConfig = { url: 'http://127.0.0.1:' + BRIDGE_PORT + '/exec', token }
  return bridgeConfig
}

/** Run one command through the Shizuku bridge (unrooted devices). */
async function runViaBridge(cmd, timeoutMs, signal) {
  const bridge = bridgeTarget()
  if (!bridge) {
    return { ok: false, code: -1, stdout: '', stderr: 'root requested but no su and no Shizuku bridge (missing ~/.dsh-bridge-token)', root: false }
  }
  try {
    const res = await fetch(bridge.url, {
      method: 'POST',
      headers: {
        'x-dsh-token': bridge.token,
        'x-dsh-cmd': cmd,
        'x-dsh-timeout-ms': String(timeoutMs),
      },
      signal,
    })
    const body = await res.json().catch(() => ({}))
    return {
      ok: body.exitCode === 0,
      code: typeof body.exitCode === 'number' ? body.exitCode : -1,
      stdout: String(body.stdout ?? ''),
      stderr: String(body.stderr ?? ''),
      root: false,
      bridge: true,
    }
  } catch (err) {
    return { ok: false, code: -1, stdout: '', stderr: 'bridge call failed: ' + (err && err.message ? err.message : err), root: false, bridge: true }
  }
}

/** Run one command on the device. root=true routes through su (or the Shizuku bridge
 *  when the device is not rooted); never throws. */
async function run(cmd, options) {
  const opts = options ?? {}
  const root = opts.root !== false
  const timeout = opts.timeout ?? 120000
  const signal = opts.signal
  const su = root ? resolveSu() : undefined
  if (root && su === undefined) {
    return runViaBridge(cmd, timeout, signal)
  }
  const file = root ? su : 'sh'
  try {
    const { stdout, stderr } = await execFileP(file, ['-c', cmd], { timeout, signal, maxBuffer: 16 * 1024 * 1024 })
    return { ok: true, code: 0, stdout: String(stdout), stderr: String(stderr), root: root }
  } catch (err) {
    return {
      ok: false,
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message ?? err),
      root: root,
    }
  }
}

/** Shell-quote one argument inside a root-shell command. */
function shq(value) {
  return "'" + String(value).split("'").join("'\\''") + "'"
}

/** Escape text for Android input text (spaces become %s). */
function inputTextEscaped(text) {
  return String(text).split("'").join("'\\''").replace(/ /g, '%s')
}

const KEYCODE_NAMES = {
  home: 3, back: 4, menu: 82, recents: 187, app_switch: 187, power: 26,
  wakeup: 224, sleep: 223, vol_up: 24, vol_down: 25, enter: 66, backspace: 67,
  tab: 61, esc: 111, delete: 112, search: 84, camera: 27, call: 5, endcall: 6,
  media_play: 126, media_pause: 127, media_next: 87, media_prev: 88,
}

/** Map a named or numeric key to an input keyevent argument. */
function keyeventArg(key) {
  if (typeof key === 'number') return String(key)
  const k = String(key).trim().toLowerCase()
  if (/^\d+$/.test(k)) return k
  const mapped = KEYCODE_NAMES[k]
  if (mapped !== undefined) return String(mapped)
  const camel = k.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return 'KEYCODE_' + camel
}

/** Resolve the device's physical size as [w, h] for gesture math. */
async function screenSize() {
  const res = await run('wm size', { timeout: 10000 })
  const m = res.stdout.match(/(\d+)x(\d+)/)
  if (m) return [Number(m[1]), Number(m[2])]
  return [1080, 2400]
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'android_shell',
    description:
      'Run one shell command on the Android device. On rooted devices this goes through Magisk su; '
      + 'on unrooted devices it goes through the DSH Phone Shizuku bridge (adb-shell level). '
      + 'This is the general escape hatch for anything the dedicated android_* tools do not cover: '
      + 'file ops, settings, pm/am/dumpsys calls, appops, service control, etc. '
      + 'Returns exit code, stdout and stderr. Defaults to root=true; use root=false for plain termux commands.',
    parameters: {
      command: { type: 'string', required: true, description: 'The shell command to execute.' },
      root: { type: 'boolean', description: 'Run through Magisk su. Default true.' },
      timeoutMs: { type: 'integer', description: 'Timeout in milliseconds (default 120000, max 300000).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const timeout = Math.min(Math.max(args.timeoutMs ?? 120000, 1000), 300000)
      const res = await run(args.command, { root: args.root !== false, timeout, signal: exec.signal })
      return { ok: res.ok, code: res.code, stdout: res.stdout.slice(-20000), stderr: res.stderr.slice(-4000), truncated: res.stdout.length > 20000 }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_screenshot',
    description:
      'Capture the current screen to a PNG under the DSH home directory (dsh-shots/). '
      + 'Returns the absolute path, which the file read tool can then read as an image. '
      + 'Pass an optional filename; default is screen-<timestamp>.png.',
    parameters: {
      filename: { type: 'string', description: 'Output PNG name (default screen-<timestamp>.png).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      const name = args.filename ?? 'screen-' + Date.now() + '.png'
      const path = SHOTS_DIR + '/' + name
      // 755 dir + 644 file so the PNG stays readable by Termux even when the
      // Shizuku bridge (shell uid) creates it under /data/local/tmp.
      const mkdir = 'mkdir -p ' + shq(SHOTS_DIR) + ' && chmod 755 ' + shq(SHOTS_DIR)
      // Some MIUI builds fail to link screencap against libunwindstack symbols
      // (Xzs_*); retrying with these preloads fixes the linker error.
      const preload = 'env LD_PRELOAD=/system/lib64/liblzma.so:/system/lib64/libz.so '
      const try1 = mkdir + ' && screencap -p ' + shq(path) + ' && chmod 644 ' + shq(path)
      let res = await run(try1, { timeout: 25000, signal: exec.signal })
      if (!res.ok) {
        const try2 = mkdir + ' && ' + preload + 'screencap -p ' + shq(path) + ' && chmod 644 ' + shq(path)
        res = await run(try2, { timeout: 25000, signal: exec.signal })
      }
      return res.ok ? { ok: true, path } : { ok: false, error: res.stderr.trim() || 'screencap failed' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_tap',
    description:
      'Tap the screen at absolute pixel coordinates (x, y). Coordinates match the physical '
      + 'resolution returned by android_shell wm size. Use android_screenshot or android_ui_dump '
      + 'to locate targets first.',
    parameters: {
      x: { type: 'integer', required: true, description: 'X pixel coordinate.' },
      y: { type: 'integer', required: true, description: 'Y pixel coordinate.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 15000,
    async execute(args, exec) {
      const res = await run('input tap ' + args.x + ' ' + args.y, { timeout: 10000, signal: exec.signal })
      return { ok: res.ok, x: args.x, y: args.y, error: res.ok ? undefined : res.stderr.trim() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_swipe',
    description:
      'Swipe from (x1,y1) to (x2,y2) with an optional duration in ms (default 300). '
      + 'Slow swipes (600-1000ms) scroll; fast ones (100-200ms) fling.',
    parameters: {
      x1: { type: 'integer', required: true, description: 'Start X pixel coordinate.' },
      y1: { type: 'integer', required: true, description: 'Start Y pixel coordinate.' },
      x2: { type: 'integer', required: true, description: 'End X pixel coordinate.' },
      y2: { type: 'integer', required: true, description: 'End Y pixel coordinate.' },
      durationMs: { type: 'integer', description: 'Swipe duration in milliseconds (default 300).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 15000,
    async execute(args, exec) {
      const dur = args.durationMs ?? 300
      const res = await run('input swipe ' + args.x1 + ' ' + args.y1 + ' ' + args.x2 + ' ' + args.y2 + ' ' + dur, { timeout: 10000, signal: exec.signal })
      return { ok: res.ok, error: res.ok ? undefined : res.stderr.trim() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_text',
    description:
      'Type text into the currently focused field via Android input injection. '
      + 'Spaces and quotes are handled automatically. Best used right after tapping a text field.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to type.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 15000,
    async execute(args, exec) {
      const res = await run('input text ' + shq(inputTextEscaped(args.text)), { timeout: 10000, signal: exec.signal })
      return { ok: res.ok, error: res.ok ? undefined : res.stderr.trim() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_keyevent',
    description:
      'Send a key event: named keys (home, back, recents, power, wakeup, enter, backspace, tab, '
      + 'vol_up, vol_down, media_play, ...) or a numeric Android keycode. Useful for navigating '
      + 'outside any app (back to launcher, lock/wake screen).',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name or numeric keycode.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 15000,
    async execute(args, exec) {
      const res = await run('input keyevent ' + keyeventArg(args.key), { timeout: 10000, signal: exec.signal })
      return { ok: res.ok, key: args.key, error: res.ok ? undefined : res.stderr.trim() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_open_app',
    description:
      'Launch an app by its Android package name (e.g. com.android.settings, com.tencent.mm). '
      + 'Use android_list_packages or android_current_app to discover package names.',
    parameters: {
      package: { type: 'string', required: true, description: 'Android package name to launch.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      const res = await run('monkey -p ' + args.package + ' -c android.intent.category.LAUNCHER 1', { timeout: 20000, signal: exec.signal })
      return { ok: res.ok, package: args.package, error: res.ok ? undefined : (res.stderr + res.stdout).trim().slice(-2000) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_current_app',
    description:
      'Report the app currently in the foreground (package and activity), from dumpsys. '
      + 'Use before UI automation to confirm which app is on screen.',
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      const res = await run(
        'dumpsys activity activities 2>/dev/null | grep -iE \'topResumedActivity|mResumedActivity\' | head -5; dumpsys window 2>/dev/null | grep -iE \'mCurrentFocus|mFocusedApp\' | head -5',
        { timeout: 15000, signal: exec.signal },
      )
      return { ok: true, focus: res.stdout.trim().slice(0, 4000) || '(empty)', error: res.stderr.trim().slice(0, 500) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_ui_dump',
    description:
      'Dump the current screen hierarchy via uiautomator as XML (truncated to maxChars, default 12000). '
      + 'Use it to find element bounds, text and resource-ids before tapping or typing.',
    parameters: {
      maxChars: { type: 'integer', description: 'Truncate XML to this many characters (default 12000).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 90000,
    async execute(args, exec) {
      const path = '/data/local/tmp/ui-dump-' + Date.now() + '.xml'
      const res = await run('uiautomator dump ' + shq(path) + ' >/dev/null 2>&1 && cat ' + shq(path) + ' && rm -f ' + shq(path), { timeout: 80000, signal: exec.signal })
      const xml = res.stdout
      const max = typeof args.maxChars === 'number' ? args.maxChars : 12000
      return res.ok
        ? { ok: true, length: xml.length, truncated: xml.length > max, xml: xml.slice(0, max) }
        : { ok: false, error: res.stderr.trim() || 'uiautomator dump failed' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_install_apk',
    description:
      'Install (or upgrade) an APK file already on the device by absolute path, via pm install. '
      + 'The APK must first be placed on the device (e.g. downloaded by the agent or pushed by the user).',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the APK on the device.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 300000,
    async execute(args, exec) {
      const res = await run('pm install -r -g ' + shq(args.path), { timeout: 280000, signal: exec.signal })
      return { ok: res.ok, path: args.path, output: (res.stdout + res.stderr).trim().slice(-4000) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_list_packages',
    description:
      'List installed Android packages (pm list packages), optionally filtered by a substring. '
      + 'Useful for discovering package names before android_open_app.',
    parameters: {
      filter: { type: 'string', description: 'Substring filter for package names.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      const grep = args.filter ? ' | grep ' + shq(args.filter) : ''
      const res = await run('pm list packages' + grep, { timeout: 20000, signal: exec.signal })
      const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean)
      return { ok: res.ok, count: lines.length, packages: lines.slice(0, 500) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_wake_unlock',
    description:
      'Wake the screen and swipe up to dismiss the lock screen (no PIN). '
      + 'If a PIN/password lockscreen is set, the swipe only reaches the PIN entry; the agent '
      + 'can then type the PIN with android_tap/android_text if the user supplies it.',
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      const size = await screenSize()
      const w = size[0]
      const h = size[1]
      const cmd = 'input keyevent KEYCODE_WAKEUP; sleep 0.4; input swipe ' + Math.round(w / 2) + ' ' + Math.round(h * 0.85) + ' ' + Math.round(w / 2) + ' ' + Math.round(h * 0.25) + ' 200'
      const res = await run(cmd, { timeout: 15000, signal: exec.signal })
      return { ok: res.ok, error: res.ok ? undefined : res.stderr.trim() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_clipboard',
    description:
      'Read or write the system clipboard through termux-api. '
      + 'action=get returns current clipboard text; action=set stores the given text. '
      + 'Requires the Termux:API app (installed with the deployment).',
    parameters: {
      action: { type: 'string', required: true, enum: ['get', 'set'], description: 'Clipboard action.' },
      text: { type: 'string', description: 'Text to set when action=set.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      if (args.action === 'set') {
        if (args.text === undefined) return { ok: false, error: 'text is required for action=set' }
        const res = await run('termux-clipboard-set ' + shq(args.text), { root: false, timeout: 15000, signal: exec.signal })
        return { ok: res.ok, error: res.ok ? undefined : res.stderr.trim() }
      }
      const res = await run('termux-clipboard-get', { root: false, timeout: 15000, signal: exec.signal })
      return res.ok ? { ok: true, text: res.stdout } : { ok: false, error: res.stderr.trim() || 'clipboard get failed' }
    },
  }))
}
