// patch-dsh-client-modules.mjs — keep the DSH web client bundle composer cheap
// enough to boot on a phone.
//
// Why: `ClientModuleRegistry.compose()` builds an indexed source map for every
// module and re-encodes every client bundle. Two things make that fatal here:
//
//  1. When a plugin ships no `.map`, `identitySectionMap()` synthesises one: a
//     per-generated-line `mappings` string plus the *entire* source duplicated
//     into `sourcesContent`, then `JSON.stringify` + `Buffer.from` over the
//     result. → ship an empty mapping instead (devtools-only data; the emitted
//     script bytes are unchanged).
//  2. Every plugin registration schedules its own flush (a microtask coalesces
//     only same-tick registrations), so a boot that registers ~70 client plugins
//     recomposes the whole 10.8 MB bundle set dozens of times. → coalesce a burst
//     into one recomposition with a short debounce.
//
// Measured on the 13 Pro (0.1.5-rc.2, Android 14): boot never finished — 225 s of
// CPU samples with buildCombo 48 s, newlineCount 45 s, Buffer/utf8Write 62 s,
// identitySectionMap 23 s — and the web UI never rendered.
//
// Idempotent. Usage: node patch-dsh-client-modules.mjs <path to dsh-client-modules/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node patch-dsh-client-modules.mjs <path-to-dsh-client-modules-lib-index.js>')
  process.exit(2)
}
let src = readFileSync(target, 'utf8')
let changed = 0

// --- 1. cheap identity section maps -----------------------------------------
const mapAnchor = [
  '\tconst mappings = Array.from({ length: newlineCount(source) }, (_, index) => index === 0 ? "AAAA" : "AACA").join(";");',
  '\treturn {',
  '\t\tversion: 3,',
  '\t\tnames: [],',
  '\t\tsources: [sourceUrl],',
  '\t\tsourcesContent: [source],',
  '\t\tmappings',
  '\t};',
].join('\n')

const mapReplacement = [
  '\t// Android/phone: this synthesised map is devtools-only data. Building the',
  '\t// per-line mapping table and embedding the full `sourcesContent` for every',
  '\t// module costs minutes of CPU per boot here. Ship an empty mapping — the',
  '\t// emitted script bytes are unchanged, only devtools line mapping is lost.',
  '\treturn {',
  '\t\tversion: 3,',
  '\t\tnames: [],',
  '\t\tsources: [sourceUrl],',
  '\t\tmappings: ""',
  '\t};',
].join('\n')

if (src.includes(mapAnchor)) {
  src = src.replace(mapAnchor, mapReplacement)
  changed++
} else if (!src.includes('devtools-only data')) {
  console.error('source-map anchor not found — is this the right file/build?')
  process.exit(1)
}

// --- 2. coalesce the per-registration flush ---------------------------------
const flushAnchor = [
  '\t\t\tif (this.flushQueued) return;',
  '\t\t\tthis.flushQueued = true;',
  '\t\t\tqueueMicrotask(() => {',
  '\t\t\t\tthis.flushQueued = false;',
].join('\n')

const flushReplacement = [
  '\t\t\tif (this.flushQueued) return;',
  '\t\t\tthis.flushQueued = true;',
  '\t\t\t// Android/phone: a boot registers ~70 client plugins across many ticks and',
  '\t\t\t// every flush re-encodes every bundle (~10.8 MB here). queueMicrotask only',
  '\t\t\t// coalesces same-tick work, so debounce the burst into one recomposition.',
  '\t\t\tsetTimeout(() => {',
  '\t\t\t\tthis.flushQueued = false;',
].join('\n')

if (src.includes(flushAnchor)) {
  src = src.replace(flushAnchor, flushReplacement)
  // close the debounce with the matching delay argument
  const closeAnchor = [
    '\t\t\t\tthis.flush((err) => {',
    '\t\t\t\t\tctx.logger.warn(err);',
    '\t\t\t\t});',
    '\t\t\t});',
  ].join('\n')
  const closeReplacement = [
    '\t\t\t\tthis.flush((err) => {',
    '\t\t\t\t\tctx.logger.warn(err);',
    '\t\t\t\t});',
    '\t\t\t}, 150);',
  ].join('\n')
  if (!src.includes(closeAnchor)) {
    console.error('flush close anchor not found — aborting before writing')
    process.exit(1)
  }
  src = src.replace(closeAnchor, closeReplacement)
  changed++
} else if (!src.includes('debounce the burst')) {
  console.error('flush anchor not found — is this the right file/build?')
  process.exit(1)
}

if (changed === 0) {
  console.log('already patched — nothing to do')
  process.exit(0)
}
writeFileSync(target, src)
console.log(`patched (${changed} edit group(s)): ` + target)

