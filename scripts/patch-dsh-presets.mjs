// patch-dsh-presets.mjs — convert 0.1.0-era user Agent presets to the 0.1.5 row
// shape. The persona row's prompt key was renamed `text` -> `prefix`, and 0.1.5's
// @deepseek-ai/dsh-persona schema REQUIRES `prefix` (a preset that still says
// `text` fails to mount, which makes every session using it refuse to start).
//
// Only the `persona` entry's own key is touched; other `text:` keys in the file
// belong to different plugins. Idempotent.
// Usage: node patch-dsh-presets.mjs <presets-dir>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2]
if (!base) {
  console.error('usage: node patch-dsh-presets.mjs <presets-dir>')
  process.exit(2)
}

let changed = 0
let scanned = 0
for (const name of readdirSync(base)) {
  const file = join(base, name, 'agent.cordis.yml')
  try { if (!statSync(file).isFile()) continue } catch { continue }
  scanned++
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^-\s+id:\s*persona\s*$/.test(line) || /^\s*-\s+id:\s*persona\s*$/.test(line))
  if (start < 0) continue
  let touched = false
  for (let i = start + 1; i < lines.length && i < start + 24; i++) {
    if (/^\s*-\s+id:/.test(lines[i])) break
    const m = /^(\s*)text:(\s|$)/.exec(lines[i])
    if (m) {
      lines[i] = `${m[1]}prefix:${lines[i].slice(m[1].length + 'text:'.length)}`
      touched = true
      break
    }
  }
  if (!touched) continue
  writeFileSync(file, lines.join('\n'))
  console.log(`patched persona key: ${file}`)
  changed++
}
console.log(`presets scanned: ${scanned}, patched: ${changed}`)
