// verify-patched-tree.mjs — assert every Android gate's patch is actually present in
// an installed DSH tree, plus the config traps that are not code.
//
// Why this exists: the patches here are applied by three different entry points
// (app one-tap deploy, scripts/upgrade-to-015.sh, hand patching) and each of them can
// silently skip a step — the failures never look like patch failures on the device:
//
//   * a patcher that throws inside a promise nobody awaits => "the turn never starts"
//   * a patcher whose anchor moved                            => deploy continues, gate open
//   * a settings default (`inputModalities`)                  => "model does not support images"
//
// Behaviour checks live in verify-turn.mjs (does a real turn run) and the repo-side
// preflight (does the patcher even parse). This file answers the third question: is
// the tree the device is running actually patched? Run it after every deploy/upgrade.
//
// usage: node verify-patched-tree.mjs [DSH_HOME]      (default ~/.dsh)
//        exit 0 = every gate closed, 1 = at least one FAIL
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const home = process.argv[2] ?? join(process.env.HOME ?? '/data/data/com.termux/files/home', '.dsh')
const liveDsh = process.env.DSH_INSTALL ?? '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh'

/** Resolve the dependency scope the same way setup-root.sh does (npm layout vs symlinked tree). */
function resolveScope(dshDir) {
  if (!existsSync(dshDir)) return undefined
  // realpath, not resolve: the live install is usually a SYMLINK into a hand-built
  // tree, and resolve() would keep the link path (which has no sibling packages).
  const real = realpathSync(dshDir)
  const nested = join(real, 'node_modules', '@deepseek-ai')
  if (existsSync(nested)) return nested
  return dirname(real)
}
const scope = resolveScope(liveDsh)
if (scope === undefined) {
  console.error(`FAIL cannot find a DSH install at ${liveDsh}`)
  process.exit(1)
}

let failures = 0
let warnings = 0
function gate(id, description, file, marker, kind = 'string') {
  const path = join(scope, file)
  if (!existsSync(path)) {
    console.log(`FAIL ${id}  ${description}\n       missing file: ${path}`)
    failures++
    return
  }
  const src = readFileSync(path, 'utf8')
  const ok = kind === 'regex' ? marker.test(src) : src.includes(marker)
  if (ok) console.log(`ok   ${id}  ${description}`)
  else {
    console.log(`FAIL ${id}  ${description}\n       ${path} is missing marker: ${String(marker)}`)
    failures++
  }
}

console.log(`tree: ${scope}\n`)

// --- g0: the Termux home must actually be writable by the uid running DSH -----
// 2026-09-17: `~` had been left owned by shell:shell (uid 2000) with mode 775 — the
// Termux uid is then "other" and every create inside it fails with EACCES, which the
// UI shows as "cannot create .../11: EACCES ... mkdir". Nothing to do with root or
// SELinux: it is ordinary Unix permissions on the home directory.
{
  const homeDir = dirname(home)
  const probe = join(homeDir, '.dsh-write-probe')
  let problem
  try {
    const st = statSync(homeDir)
    if (st.uid !== process.getuid()) problem = `owned by uid ${st.uid}, but DSH runs as uid ${process.getuid()}`
    else if ((st.mode & 0o200) === 0) problem = `mode ${(st.mode & 0o7777).toString(8)} has no owner write bit`
    else {
      mkdirSync(probe)
      rmdirSync(probe)
    }
  } catch (error) {
    problem = problem ?? `${error.code}: ${error.message}`
  }
  if (problem === undefined) console.log(`ok   g0 home-writable  ${homeDir} is writable by uid ${process.getuid()}`)
  else {
    console.log(`FAIL g0 home-writable  ${homeDir}: ${problem}`)
    console.log(`       fix: chown ${process.getuid()}:${process.getgid()} ${homeDir} && chmod 700 ${homeDir}`)
    failures++
  }
}

// --- code gates --------------------------------------------------------------
gate('g1 flock', 'native flock addon degrades on android', 'node-addon-system/lib/flock.js', "platform === 'android'")
gate(
  'g2 session-publish',
  'atomic publish uses rename and imports it (revision 1 shipped it unimported)',
  'dsh-session-persistence-jsonl/lib/index.js',
  /import \{[^}]*\brealpath, rename, rm\b[^}]*\} from "node:fs\/promises"/,
  'regex',
)
gate(
  'g3 attachment-fsync',
  'ancestor-directory fsync tolerates Android EACCES/EINVAL',
  'dsh-attachment-local/lib/index.js',
  'reject fsync on a directory fd',
)
gate('g4 client-modules', 'client bundle composer debounced', 'dsh-client-modules/lib/index.js', 'debounce the burst')
gate('g5 web-auth', 'loopback UI does not need the launch token', 'dsh-client-connection/lib/index.js', 'loopbackAuthority')
gate('g6 node-pty', 'node-pty loaded lazily', 'dsh-subprocess-local/lib/index.js', 'loadNodePty')

// --- config gates ------------------------------------------------------------
const presetDir = join(home, '.agent-presets')
if (existsSync(presetDir)) {
  let missing = 0
  let total = 0
  for (const name of readdirSync(presetDir)) {
    const file = join(presetDir, name, 'agent.cordis.yml')
    if (!existsSync(file) || !statSync(file).isFile()) continue
    total++
    const src = readFileSync(file, 'utf8')
    const personaIdx = src.search(/^-\s+id:\s*persona\s*$/m)
    if (personaIdx < 0) continue
    const block = src.slice(personaIdx, personaIdx + 600)
    if (!/^\s*prefix:/m.test(block)) {
      console.log(`FAIL g7 preset ${name}  persona row uses "prefix:" (0.1.5 requires it)`)
      missing++
      failures++
    }
  }
  if (missing === 0) console.log(`ok   g7 presets  ${total} user preset(s) use the 0.1.5 persona key`)
} else {
  console.log('skip g7 presets  no ~/.agent-presets directory')
}

const settingsPath = join(home, 'settings.yaml')
if (existsSync(settingsPath)) {
  const settings = readFileSync(settingsPath, 'utf8')
  const catalog = settings.match(/llm-deepseek:[\s\S]*?models:\n([\s\S]*?)(?=\n\S|$)/)
  if (catalog === null) console.log('ok   g8 model catalog  no llm-deepseek.models override')
  else {
    const entries = catalog[1].split(/\n(?=\s*-\s+id:)/).filter((e) => /-\s+id:/.test(e))
    const lacking = entries.filter((e) => !/inputModalities/.test(e)).map((e) => (e.match(/id:\s*(\S+)/) ?? [])[1])
    if (lacking.length === 0) console.log(`ok   g8 model catalog  ${entries.length} entry(ies) declare inputModalities`)
    else {
      console.log(`WARN g8 model catalog  ${lacking.join(', ')} declare no inputModalities`)
      console.log('       the schema defaults them to ["text"]: images are refused with')
      console.log('       MODEL_DOES_NOT_SUPPORT_IMAGES even when the model accepts them.')
      console.log('       add `inputModalities: [text, image]` to each entry that really takes images.')
      warnings++
    }
  }
}

console.log(`\n${failures === 0 ? 'TREE_OK' : 'TREE_FAIL'} gates_failed=${failures} warnings=${warnings}`)
process.exit(failures === 0 ? 0 : 1)
