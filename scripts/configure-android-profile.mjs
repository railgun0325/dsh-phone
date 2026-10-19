// Merge required Android backend rows while preserving the user's YAML bytes.
import { existsSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs'
import { installation } from './dsh-compat.mjs'
const [dsh, target, template] = process.argv.slice(2)
const tree = installation(dsh)
const yaml = tree.require('js-yaml')
const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar' })])
const begin = '# BEGIN DSH PHONE ANDROID 0.2', end = '# END DSH PHONE ANDROID 0.2'
let src = existsSync(target) ? readFileSync(target, 'utf8') : ''
const original = src
if (src.includes(begin)) {
  const start = src.indexOf(begin), stop = src.indexOf(end, start)
  if (stop < 0 || src.indexOf(begin, start + 1) >= 0) throw new Error('Malformed managed Android profile block; preserve and fix manually')
  src = src.slice(0, start) + src.slice(stop + end.length).replace(/^\r?\n/, '')
}
const rows = src.trim() ? yaml.load(src, { schema }) : []
if (!Array.isArray(rows)) throw new Error('Web profile must be a YAML patch list')
const inserted = rows.flatMap(row => Array.isArray(row?.insert) ? row.insert : [])
let overlay = `${begin}\n`
for (const id of ['client-hmr', 'bash-sandbox', 'pwsh-sandbox', 'permission']) overlay += `- id: ${id}\n  disabled: true\n`
// Retain the sandbox service dependency of the default PTC runtime. Ordinary
// Android Bash uses bash-local; permission-presets refuses unconfined backends.
overlay += '- id: sandbox\n  disabled: false\n'
for (const [id, name] of [['bash-local', '@deepseek-ai/dsh-bash-local'], ['android-control', 'dsh-android-control']]) {
  const existing = inserted.find(row => row.id === id || row.name === name)
  if (existing && existing.name !== name) throw new Error(`Custom ${id} conflicts with required Android backend; merge manually`)
  overlay += existing ? `- id: ${existing.id}\n  disabled: false\n` : `- insert:\n    - id: ${id}\n      name: '${name}'\n`
}
overlay += `${end}\n`
const result = src.trimEnd() + (src.trim() ? '\n\n' : '') + overlay
if (result !== original) {
  if (existsSync(target)) copyFileSync(target, `${target}.backup-${Date.now()}-${process.pid}`)
  writeFileSync(target, result, { mode: 0o600 })
}
console.log('PROFILE_OK required Android backend rows merged; user rows preserved')
