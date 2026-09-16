// preflight-facts.mjs — extract facts about the build config for tools/preflight.sh.
//
// The shell script used to grep these out itself, which is exactly the kind of
// fragile parsing that produced two of the bugs this preflight exists to catch.
// Keeping it in node means one parser, one place to fix.
//
// usage: node tools/preflight-facts.mjs <name|code|payload>
import { readFileSync } from 'node:fs'

const s = readFileSync(new URL('./build-apk.sh', import.meta.url), 'utf8')
const grab = (key) => {
  const m = new RegExp(`${key}=\\$\\{${key}:-([^}]+)\\}`).exec(s)
  return m === null ? '?' : m[1]
}

const which = process.argv[2]
if (which === 'name') console.log(grab('VERSION_NAME'))
else if (which === 'code') console.log(grab('VERSION_CODE'))
else if (which === 'payload') {
  const lists = [...s.matchAll(/PAYLOAD="([\s\S]*?)"/g)].map((m) => m[1].replace(/\\\n/g, ' '))
  const entries = [...new Set(lists.join(' ').split(/\s+/).filter(Boolean))]
  console.log(entries.join('\n'))
} else {
  console.error('usage: node tools/preflight-facts.mjs <name|code|payload>')
  process.exit(2)
}
