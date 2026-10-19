import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { installation } from './dsh-compat.mjs'

const tree = installation(process.argv[2])
const before = new Map(tree.targets.map(file => [file, readFileSync(file)]))
try {
  for (const [script, target] of tree.jobs) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), target], { stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error(`${script} failed (${result.status}): ${result.error?.message ?? 'see log above'}`)
  }
  console.log(`PATCHES_OK dsh=${tree.version}`)
} catch (error) {
  for (const [file, bytes] of before) writeFileSync(file, bytes)
  console.error('PATCHES_FAIL: restored all package files to their pre-run bytes')
  throw error
}
