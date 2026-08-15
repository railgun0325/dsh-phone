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

// ---- plugin v2: termux-api hardware helpers ------------------------------

/** Media output directory (plugin runs as the com.termux uid). */
const MEDIA_DIR = (process.env.HOME || '/data/data/com.termux/files/home') + '/dsh-shots'

/** Run one command as the plain Termux uid — termux-api tools must not go through su. */
function termux(cmd, timeout, signal) {
  return run(cmd, { root: false, timeout, signal })
}

/** Clamp an integer argument to [min,max]; fall back to dflt when absent/not finite. */
function clampInt(value, min, max, dflt) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : dflt
  return Math.min(Math.max(n, min), max)
}

/** Best-effort JSON parse of a stdout blob. */
function tryJson(text) {
  try { return JSON.parse(String(text).trim()) } catch { return undefined }
}

/** Keep the tail of a possibly long stdout blob (JSONL from termux-sensor). */
function tailText(text, maxChars) {
  const s = String(text)
  return s.length > maxChars ? '(truncated — last ' + maxChars + ' chars)\n' + s.slice(-maxChars) : s
}

/** Recursively strip undefined properties so every tool return is lossless JSON.
 *  DSH 0.1.0-rc.6 rejects tool output containing undefined values with
 *  "value is not lossless JSON". */
function cleanJson(value) {
  if (Array.isArray(value)) return value.map(cleanJson)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      const v = value[key]
      if (v === undefined) continue
      out[key] = cleanJson(v)
    }
    return out
  }
  return value
}

export function apply(ctx) {
  /** Register a tool, wrapping execute so its return value is always lossless JSON. */
  function register(tool) {
    if (typeof tool.execute === 'function') {
      const inner = tool.execute
      tool.execute = async (args, exec) => cleanJson(await inner(args, exec))
    }
    ctx.tools.register(tool)
  }
  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  register(defineTool({
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

  // ---- plugin v2: phone hardware toolset (termux-api unified channel) ----

  register(defineTool({
    name: 'android_status',
    description:
      'Snapshot the phone hardware state: battery (percentage/charging/temperature), current screen brightness and mode, '
      + 'volume levels, screen on-off + lock state, and a short network summary (default route, cellular type, 2s internet probe). '
      + 'Battery and volume read through Termux:API as the Termux uid; brightness and screen state read through the root/Shizuku channel.',
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 45000,
    async execute(args, exec) {
      const [battery, volume, brightness, screen, network] = await Promise.all([
        termux('termux-battery-status', 15000, exec.signal),
        termux('termux-volume', 15000, exec.signal),
        run('/system/bin/settings get system screen_brightness; echo MODE=$(/system/bin/settings get system screen_brightness_mode)', { timeout: 10000, signal: exec.signal }),
        run("dumpsys power 2>/dev/null | grep -m1 -o 'mWakefulness=[A-Za-z]*'; dumpsys window 2>/dev/null | grep -m1 -o 'mDreamingLockscreen=[a-z]*'", { timeout: 15000, signal: exec.signal }),
        termux('ip route 2>/dev/null | head -3; echo CELL=$(getprop gsm.network.type); (ping -c 1 -W 2 223.5.5.5 >/dev/null 2>&1 && echo internet=online) || echo internet=offline', 15000, exec.signal),
      ])
      let brightValue
      let brightMode
      for (const line of brightness.stdout.split(/\r?\n/)) {
        const t = line.trim()
        if (brightValue === undefined && /^\d+$/.test(t)) brightValue = Number(t)
        const mm = t.match(/^MODE=(\d+)$/)
        if (mm) brightMode = Number(mm[1])
      }
      const wake = screen.stdout.match(/mWakefulness=(\w+)/)
      const lock = screen.stdout.match(/mDreamingLockscreen=(\w+)/)
      const routes = []
      let cellular
      let internet
      for (const line of network.stdout.split(/\r?\n/)) {
        const t = line.trim()
        const cell = t.match(/^CELL=(.*)$/)
        const net = t.match(/^internet=(.*)$/)
        if (cell) cellular = cell[1]
        if (net) internet = net[1]
        if (t && !cell && !net) routes.push(t)
      }
      return {
        ok: true,
        battery: tryJson(battery.stdout) ?? { raw: battery.stdout.trim(), error: battery.stderr.trim() || undefined },
        brightness: brightValue !== undefined ? { value: brightValue, mode: brightMode ?? null } : { error: (brightness.stderr || brightness.stdout || 'unavailable').trim() },
        volume: tryJson(volume.stdout) ?? { raw: volume.stdout.trim(), error: volume.stderr.trim() || undefined },
        screen: { wakefulness: wake ? wake[1] : null, dreamingLockscreen: lock ? lock[1] : null, error: screen.stderr.trim() || undefined },
        network: { routes, cellular: cellular ?? null, internet: internet ?? 'unknown', error: network.stderr.trim() || undefined },
      }
    },
  }))

  register(defineTool({
    name: 'android_sensor_list',
    description:
      'List all sensors available on this phone via termux-sensor -l (Termux:API, Termux uid). '
      + 'Returns the JSON sensor-name array from Termux:API; names are accepted by android_sensor_read (partial names work too). '
      + 'No dangerous permission required.',
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      const res = await termux('termux-sensor -l', 15000, exec.signal)
      const parsed = tryJson(res.stdout)
      if (res.ok && parsed !== undefined && Array.isArray(parsed.sensors)) {
        return { ok: true, count: parsed.sensors.length, sensors: parsed.sensors }
      }
      const lines = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      return res.ok && lines.length
        ? { ok: true, count: lines.length, sensors: lines.slice(0, 200) }
        : { ok: false, error: (res.stderr || res.stdout || 'termux-sensor -l failed').trim().slice(-1000) }
    },
  }))

  register(defineTool({
    name: 'android_sensor_read',
    description:
      'Sample one sensor for a short window through Termux:API (Termux uid). Default window 2 seconds, hard cap 10 seconds; '
      + 'optionally set the sample count (default 1, max 20; the inter-sample delay is split from the window). '
      + 'Returns the JSON sample sequence tail-truncated to the last 8000 characters. The screen does not need to be on.',
    parameters: {
      sensor: { type: 'string', required: true, description: 'Exact sensor name from android_sensor_list.' },
      seconds: { type: 'integer', description: 'Sampling window in seconds (default 2, max 10).' },
      count: { type: 'integer', description: 'Number of samples (default 1, max 20).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      const sec = clampInt(args.seconds, 1, 10, 2)
      const count = clampInt(args.count, 1, 20, 1)
      const delay = Math.max(100, Math.floor((sec * 1000) / count))
      const cmd = 'termux-sensor -s ' + shq(args.sensor) + ' -n ' + count + ' -d ' + delay
      const res = await termux(cmd, sec * 1000 + 15000, exec.signal)
      return res.ok
        ? { ok: true, sensor: args.sensor, seconds: sec, count, delayMs: delay, data: tailText(res.stdout, 8000) }
        : { ok: false, sensor: args.sensor, error: (res.stderr || res.stdout).trim().slice(-1500) || 'termux-sensor failed' }
    },
  }))

  register(defineTool({
    name: 'android_camera_photo',
    description:
      'Take one photo with the rear camera via termux-camera-photo -c 0 and save it to ~/dsh-shots/photo-<timestamp>.jpg '
      + '(Termux:API, Termux uid). Returns the absolute path — read it back with the file/image tool to view it. '
      + 'Requirements and limits: com.termux.api needs the CAMERA permission; the screen must be on and unlocked (the camera activity '
      + 'may need foreground); some devices only expose the low-resolution Legacy Camera API. The current DeepSeek text model cannot see '
      + 'images — photos are for the user or a vision-capable model. Retries once on failure.',
    parameters: {
      filename: { type: 'string', description: 'Output JPG name (default photo-<timestamp>.jpg).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 90000,
    async execute(args, exec) {
      const name = args.filename ?? 'photo-' + Date.now() + '.jpg'
      const path = MEDIA_DIR + '/' + name
      const mkdir = 'mkdir -p ' + shq(MEDIA_DIR)
      let res = await termux(mkdir + ' && termux-camera-photo -c 0 ' + shq(path), 30000, exec.signal)
      if (!res.ok) {
        res = await termux(mkdir + ' && termux-camera-photo -c 0 ' + shq(path), 30000, exec.signal)
      }
      return res.ok
        ? { ok: true, path }
        : { ok: false, error: (res.stderr + '\n' + res.stdout).trim().slice(-1500) || 'camera photo failed' }
    },
  }))

  register(defineTool({
    name: 'android_mic_record',
    description:
      'Record microphone audio to ~/dsh-shots/rec-<timestamp>.m4a via termux-microphone-record (Termux:API, Termux uid). '
      + 'Default 5 seconds, hard cap 60 seconds. Returns the absolute path for user playback or archival. '
      + 'Limits: com.termux.api needs RECORD_AUDIO; screen-off / background recording may produce silence on some ROMs; '
      + 'the text model cannot listen to audio — no transcription is performed.',
    parameters: {
      seconds: { type: 'integer', description: 'Recording length in seconds (default 5, max 60).' },
      filename: { type: 'string', description: 'Output file name (default rec-<timestamp>.m4a).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 90000,
    async execute(args, exec) {
      const sec = clampInt(args.seconds, 1, 60, 5)
      const name = args.filename ?? 'rec-' + Date.now() + '.m4a'
      const path = MEDIA_DIR + '/' + name
      const base = 'mkdir -p ' + shq(MEDIA_DIR) + ' && termux-microphone-record -f ' + shq(path) + ' -l ' + sec
      let cmd = 'mkdir -p ' + shq(MEDIA_DIR) + ' && termux-microphone-record -e aac -f ' + shq(path) + ' -l ' + sec
      let res = await termux(cmd, sec * 1000 + 20000, exec.signal)
      if (!res.ok) {
        // Very old Termux:API builds may not know the AAC encoder flag; fall back to the default encoder.
        res = await termux(base, sec * 1000 + 20000, exec.signal)
      }
      return res.ok
        ? { ok: true, path, seconds: sec }
        : { ok: false, error: (res.stderr + '\n' + res.stdout).trim().slice(-1500) || 'microphone record failed' }
    },
  }))

  register(defineTool({
    name: 'android_speak',
    description:
      'Speak text aloud through the system TTS engine via termux-tts-speak (Termux:API, Termux uid). '
      + 'Chinese works when a Chinese TTS engine is selected in Android settings. Useful to notify a person near the phone. '
      + 'No dangerous permission required.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to speak.' },
      language: { type: 'string', description: 'Optional TTS language tag (e.g. zh-CN, en-US).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      const lang = args.language !== undefined ? ' -l ' + shq(args.language) : ''
      const res = await termux('termux-tts-speak' + lang + ' ' + shq(String(args.text ?? '')), 25000, exec.signal)
      return { ok: res.ok, error: res.ok ? undefined : (res.stderr + res.stdout).trim().slice(-1000) }
    },
  }))

  register(defineTool({
    name: 'android_play_media',
    description:
      'Control media playback on the phone via termux-media-player (Termux:API, Termux uid). '
      + 'play starts an audio/video file from an absolute path (e.g. a recording made by android_mic_record); stop stops playback; '
      + 'info reports current playback status.',
    parameters: {
      action: { type: 'string', required: true, enum: ['play', 'stop', 'info'], description: 'Playback action.' },
      path: { type: 'string', description: 'Absolute path of the media file (required for action=play).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 30000,
    async execute(args, exec) {
      if (args.action === 'play') {
        if (args.path === undefined) return { ok: false, error: 'path is required for action=play' }
        const res = await termux('termux-media-player play ' + shq(args.path), 20000, exec.signal)
        return { ok: res.ok, action: 'play', path: args.path, output: res.stdout.trim().slice(-1000), error: res.ok ? undefined : res.stderr.trim().slice(-1000) }
      }
      const res = await termux('termux-media-player ' + args.action, 20000, exec.signal)
      const info = res.stdout.trim()
      return { ok: res.ok, action: args.action, info: info ? info.slice(-2000) : undefined, error: res.ok ? undefined : res.stderr.trim().slice(-1000) }
    },
  }))

  register(defineTool({
    name: 'android_volume',
    description:
      'Read or set Android volume levels via termux-volume (Termux:API, Termux uid). No args reads every stream; stream only reads that '
      + 'stream (filtered client-side — termux-volume has no single-stream read mode); stream + level sets it. Valid streams: call, system, '
      + 'ring, music, alarm, notification. Level is an integer accepted by Termux; the valid range is device-dependent — read max_volume first '
      + '(Xiaomi 13 Pro music max is 150, call max 11). Values above max are clamped by Termux:API.',
    parameters: {
      stream: { type: 'string', enum: ['call', 'system', 'ring', 'music', 'alarm', 'notification'], description: 'Audio stream (optional; omit to read all).' },
      level: { type: 'integer', description: 'Volume level to set (requires stream).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      if (args.level !== undefined && args.stream === undefined) return { ok: false, error: 'stream is required when setting a level' }
      const pick = (volumes) => {
        if (args.stream === undefined) return volumes
        if (Array.isArray(volumes)) {
          const hit = volumes.find(v => v !== null && typeof v === 'object' && v.stream === args.stream)
          return hit ?? volumes
        }
        if (volumes !== null && typeof volumes === 'object' && volumes[args.stream] !== undefined) return volumes[args.stream]
        return volumes
      }
      if (args.stream !== undefined && args.level !== undefined) {
        const setRes = await termux('termux-volume ' + args.stream + ' ' + args.level, 15000, exec.signal)
        if (!setRes.ok) return { ok: false, stream: args.stream, level: args.level, error: (setRes.stderr + setRes.stdout).trim().slice(-1000) || 'termux-volume set failed' }
        const readRes = await termux('termux-volume', 15000, exec.signal)
        const volumes = tryJson(readRes.stdout) ?? readRes.stdout.trim()
        return { ok: true, stream: args.stream, level: args.level, volumes: pick(volumes) }
      }
      const res = await termux('termux-volume', 15000, exec.signal)
      const volumes = tryJson(res.stdout) ?? res.stdout.trim()
      return res.ok
        ? { ok: true, stream: args.stream ?? null, level: args.level ?? null, volumes: pick(volumes) }
        : { ok: false, error: (res.stderr + res.stdout).trim().slice(-1000) || 'termux-volume failed' }
    },
  }))

  register(defineTool({
    name: 'android_location',
    description:
      'Get the device location via termux-location (Termux:API, Termux uid). First tries the cached last-known fix (instant), then a single GPS fix with '
      + 'network fallback. Budget: up to 45s GPS + 20s network (termux-location has no -u flag). Returns latitude/longitude, accuracy and provider, or a '
      + 'diagnostic error when no fix is available. Known limitation: on Android 14+ Termux:API single-update requests can be killed before a cold fix '
      + 'arrives (termux-api issue 776) — cached last-known usually works, otherwise the phone needs location enabled and a quick GPS lock '
      + '(near a window/outdoors). com.termux.api needs ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION.',
    parameters: {
      provider: { type: 'string', enum: ['gps', 'network'], description: 'Preferred provider (default gps with automatic network fallback).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 120000,
    async execute(args, exec) {
      const pref = args.provider ?? 'gps'
      const alt = pref === 'gps' ? 'network' : 'gps'
      const validFix = (res) => {
        const info = tryJson(res.stdout)
        return res.ok && info !== undefined && info.latitude !== undefined && info.longitude !== undefined ? info : undefined
      }
      const toResult = (res, provider, source) => {
        const info = validFix(res)
        if (info === undefined) return undefined
        return { ok: true, provider, source, latitude: info.latitude, longitude: info.longitude, accuracy: info.accuracy ?? null, bearing: info.bearing ?? null, speed: info.speed ?? null, raw: info }
      }
      // 1. cached last-known fix (instant; works even when the single-update path cannot complete)
      for (const p of [pref, alt]) {
        const last = await termux('termux-location -p ' + shq(p) + ' -r last', 10000, exec.signal)
        const hit = toResult(last, p, 'last-known')
        if (hit) return hit
      }
      // 2. single update: preferred provider, then fallback
      let res = await termux('termux-location -p ' + shq(pref) + ' -r once', 45000, exec.signal)
      let provider = pref
      let hit = toResult(res, provider, 'single')
      if (hit === undefined) {
        res = await termux('termux-location -p ' + alt + ' -r once', 20000, exec.signal)
        provider = alt
        hit = toResult(res, provider, 'single')
      }
      if (hit) return hit
      // 3. report actionable diagnostics instead of a bare timeout
      let locationMode = null
      const modeRes = await run('/system/bin/settings get secure location_mode', { timeout: 10000, signal: exec.signal })
      const modeMatch = modeRes.stdout.match(/^\s*(\d+)\s*$/)
      if (modeMatch) locationMode = Number(modeMatch[1])
      return {
        ok: false,
        provider,
        locationMode,
        error: (res.stderr + ' ' + res.stdout).trim().slice(-1500) || 'location unavailable: no cached fix and single-update did not return a fix',
        hint: locationMode === 0
          ? 'system location is OFF — enable location (location_mode 3) and retry; cold GPS fix works best near a window/outdoors'
          : 'system location is ON but no fix arrived (Android 14+ Termux:API single-update can be killed before a cold fix; try near a window/outdoors or after Maps has cached a location)',
      }
    },
  }))

  register(defineTool({
    name: 'android_brightness',
    description:
      'Read or set the system screen brightness. Read returns the current value and brightness mode; write forces manual mode '
      + '(screen_brightness_mode=0) and then sets the value. Executes through the root channel (su on rooted devices; Shizuku bridge = shell uid '
      + 'on unrooted devices — the bridge shell holds WRITE_SETTINGS on DSH Phone deployments). Value range is device dependent; 0-255 works on the '
      + 'supported test devices. 0 is minimum brightness, not screen-off.',
    parameters: {
      level: { type: 'integer', description: 'Brightness to set, typically 0-255. Omit to read the current value.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      if (args.level === undefined) {
        const res = await run('/system/bin/settings get system screen_brightness; echo MODE=$(/system/bin/settings get system screen_brightness_mode)', { timeout: 10000, signal: exec.signal })
        const lines = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        let value
        let mode
        for (const line of lines) {
          if (value === undefined && /^\d+$/.test(line)) value = Number(line)
          const mm = line.match(/^MODE=(\d+)$/)
          if (mm) mode = Number(mm[1])
        }
        return res.ok
          ? { ok: true, brightness: value ?? null, mode: mode ?? null }
          : { ok: false, error: (res.stderr || 'settings get failed').trim() }
      }
      const level = Math.round(args.level)
      if (!Number.isFinite(level) || level < 0 || level > 255) return { ok: false, error: 'level must be an integer between 0 and 255' }
      const res = await run('/system/bin/settings put system screen_brightness_mode 0 && /system/bin/settings put system screen_brightness ' + level, { timeout: 10000, signal: exec.signal })
      return { ok: res.ok, brightness: level, error: res.ok ? undefined : (res.stderr || res.stdout).trim().slice(-1000) }
    },
  }))

  register(defineTool({
    name: 'android_wakelock',
    description:
      'Acquire or release a CPU wakelock through the Termux app service (am startservice com.termux.service_wake_lock / _unlock on '
      + 'com.termux/.app.TermuxService, run as the Termux uid). Termux v0.118+ holds the wakelock in its own TermuxService with the WAKE_LOCK '
      + 'permission declared by the Termux app — current Termux builds no longer ship the old termux-wake-lock script. Acquire before long-running '
      + 'background work (downloads, sensor sampling, file processing); release afterwards.',
    parameters: {
      action: { type: 'string', enum: ['acquire', 'release'], description: 'acquire (default) or release the wakelock.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 15000,
    async execute(args, exec) {
      const release = args.action === 'release'
      const intent = release ? 'com.termux.service_wake_unlock' : 'com.termux.service_wake_lock'
      const res = await termux('am startservice --user 0 -a ' + intent + ' com.termux/com.termux.app.TermuxService', 10000, exec.signal)
      const noise = (res.stderr + res.stdout).trim().slice(-1000)
      return { ok: res.ok, held: !release, note: noise || undefined, error: res.ok ? undefined : (noise || 'Termux wake service call failed') }
    },
  }))

  register(defineTool({
    name: 'android_screen_off',
    description:
      'Turn the screen off by pressing the power key through the root/Shizuku input channel. Only presses POWER while the screen is awake, '
      + 'so it never accidentally wakes a sleeping phone. Works on both rooted and Shizuku devices.',
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      const state = await run("dumpsys power 2>/dev/null | grep -m1 -o 'mWakefulness=[A-Za-z]*'", { timeout: 10000, signal: exec.signal })
      if (state.stdout.includes('Awake')) {
        const res = await run('input keyevent KEYCODE_POWER', { timeout: 10000, signal: exec.signal })
        return { ok: res.ok, pressed: true, error: res.ok ? undefined : res.stderr.trim() }
      }
      return { ok: true, pressed: false, note: 'screen already off/dozing' }
    },
  }))

  register(defineTool({
    name: 'android_vibrate',
    description:
      'Vibrate the phone for a short duration via termux-vibrate (Termux:API, Termux uid). Default 1000ms, max 5000ms. '
      + 'Useful as a physical attention signal. com.termux.api holds the VIBRATE permission.',
    parameters: {
      durationMs: { type: 'integer', description: 'Vibration duration in milliseconds (default 1000, max 5000).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 15000,
    async execute(args, exec) {
      const dur = clampInt(args.durationMs, 1, 5000, 1000)
      const res = await termux('termux-vibrate -d ' + dur, 10000, exec.signal)
      return { ok: res.ok, durationMs: dur, error: res.ok ? undefined : res.stderr.trim() }
    },
  }))

  register(defineTool({
    name: 'android_notify',
    description:
      'Post an Android notification via termux-notification (Termux:API, Termux uid). Requires POST_NOTIFICATIONS on com.termux.api (Android 13+). '
      + 'Optional buttonText/buttonAction reserve a notification action button — WARNING: buttonAction is executed by Termux as a shell command when '
      + 'the user taps it, so keep it to a simple, safe command. A stable id replaces a previous notification with the same id.',
    parameters: {
      title: { type: 'string', required: true, description: 'Notification title.' },
      content: { type: 'string', description: 'Notification body text.' },
      buttonText: { type: 'string', description: 'Optional action button label (requires buttonAction).' },
      buttonAction: { type: 'string', description: 'Shell command the action button runs in Termux when tapped.' },
      id: { type: 'string', description: 'Optional stable notification id (replaces same-id notifications).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 20000,
    async execute(args, exec) {
      if ((args.buttonText === undefined) !== (args.buttonAction === undefined)) {
        return { ok: false, error: 'buttonText and buttonAction must be provided together' }
      }
      let cmd = 'termux-notification --title ' + shq(args.title ?? '')
      if (args.content !== undefined) cmd += ' --content ' + shq(args.content)
      if (args.id !== undefined) cmd += ' --id ' + shq(args.id)
      if (args.buttonText !== undefined) cmd += ' --button1 ' + shq(args.buttonText) + ' --button1-action ' + shq(args.buttonAction)
      const res = await termux(cmd, 15000, exec.signal)
      return { ok: res.ok, error: res.ok ? undefined : (res.stderr + res.stdout).trim().slice(-1000) || 'notification failed' }
    },
  }))

  register(defineTool({
    name: 'android_confirm_dialog',
    description:
      'Show a confirm dialog on the phone screen via termux-dialog confirm (Termux:API, Termux uid) and wait for the person to tap yes/no. '
      + 'A manual-approval guard: use it before high-risk, irreversible or payment-like actions. Blocks until answered or the timeout expires. '
      + 'The screen must be on and unlocked for the person to answer.',
    parameters: {
      title: { type: 'string', description: 'Dialog title (default: Confirm).' },
      hint: { type: 'string', description: 'Hint text shown under the title.' },
      timeoutMs: { type: 'integer', description: 'How long to wait in ms (default 120000, max 300000).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 300000,
    async execute(args, exec) {
      const timeout = clampInt(args.timeoutMs, 10000, 300000, 120000)
      let cmd = 'termux-dialog confirm'
      if (args.title !== undefined) cmd += ' -t ' + shq(args.title)
      if (args.hint !== undefined) cmd += ' -i ' + shq(args.hint)
      const res = await termux(cmd, timeout + 10000, exec.signal)
      const parsed = tryJson(res.stdout)
      if (res.ok && parsed !== undefined) {
        if (parsed.code === -1) {
          return { ok: false, answered: false, dismissed: true, answer: parsed.text ?? 'dismissed', error: undefined }
        }
        const answer = typeof parsed.text === 'string' ? parsed.text : JSON.stringify(parsed)
        return { ok: true, answered: true, answer, code: parsed.code }
      }
      return { ok: false, answered: false, error: (res.stderr + ' ' + res.stdout).trim().slice(-1000) || 'dialog dismissed or failed' }
    },
  }))
}
