// Dump a 0.1.5 session artifact (framed zstd JSONL) as event lines.
// Node's zstd decompressor stops at the first frame, so frames are split on the
// zstd magic and decoded independently.
// usage: node phone-015-decode.mjs <session.v3.jsonl.zstd> [--full]
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const full = process.argv.includes('--full')
const buf = readFileSync(file)
const positions = []
for (let i = 0; i + 4 <= buf.length; i++) if (buf.readUInt32LE(i) === 0xFD2FB528) positions.push(i)
const parts = []
for (let i = 0; i < positions.length; i++) {
  for (let j = i + 1; j <= positions.length; j++) {
    const end = j < positions.length ? positions[j] : buf.length
    try { parts.push(zstdDecompressSync(buf.slice(positions[i], end))); break } catch (error) {
      if (j === positions.length) console.error(`frame ${i}: ${error.message}`)
    }
  }
}
const text = Buffer.concat(parts).toString('utf8')
const lines = text.split('\n').filter(Boolean)
console.log(`frames=${positions.length} raw=${text.length} lines=${lines.length}`)
for (const line of lines) {
  let e
  try { e = JSON.parse(line) } catch { console.log('  raw: ' + line.slice(0, 200)); continue }
  const type = e.type ?? '?'
  if (full || /turn\/|step\/|error|assistant\/message|user\/message|tool\//.test(type)) {
    console.log(`  ${type} ${JSON.stringify(e.data ?? e).slice(0, full ? 2000 : 240)}`)
  }
}
