import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

export function replaceOnce(source, anchor, replacement, label) {
  if (source.split(anchor).length !== 2) throw new Error(`${label}: expected exactly one anchor`)
  return source.replace(anchor, replacement)
}

// Validate all candidates before replacing any original. Keep the original bytes
// once, outside the *.js set so package scans never execute the backup.
export function savePatches(changes) {
  const staged = []
  try {
    for (const [target, source] of changes) {
      if (readFileSync(target, 'utf8') === source) continue
      if (process.env.DSH_PATCH_CHECK === '1') throw new Error(`unapplied patch: ${target}`)
      const tmp = join(dirname(target), `.dsh-phone-${process.pid}-${staged.length}.mjs`)
      writeFileSync(tmp, source, { flag: 'wx', mode: 0o600 })
      staged.push([target, tmp])
      const check = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
      if (check.status !== 0) throw new Error(`syntax check failed for ${target}: ${check.stderr}`)
    }
    for (const [target, tmp] of staged) {
      if (!existsSync(`${target}.dsh-phone-original`)) copyFileSync(target, `${target}.dsh-phone-original`)
      renameSync(tmp, target)
      console.log(`patched: ${target}`)
    }
  } finally {
    for (const [, tmp] of staged) if (existsSync(tmp)) unlinkSync(tmp)
  }
}
