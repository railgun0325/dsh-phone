// verify-turn.mjs — post-upgrade end-to-end check over the live web API.
// Creates a scratch session, sends one prompt, and waits until the session's own
// projections report a completed turn. Prints VERIFY_OK or VERIFY_FAIL.
//
// Why not `--profile headless`: this home's cordis.patch.yml inserts
// dsh-android-control into EVERY profile, but the package is only installed in the
// web profile, so a headless boot dies with ERR_MODULE_NOT_FOUND before it can
// prove anything about the runtime.
//
// usage: node verify-turn.mjs <port> <cwd> [prompt]
const port = process.argv[2] ?? '3080'
const cwd = process.argv[3] ?? '/data/data/com.termux/files/home'
const prompt = process.argv[4] ?? 'Reply with exactly: verify-ok'
const base = `http://127.0.0.1:${port}/api`

async function rpc(endpoint, args, timeoutMs = 60000) {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`${base}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await res.json()
  if (body.result?.ok !== true) throw new Error(`${endpoint}: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`)
  return body.result.value
}

const created = await rpc('session/create', { request: { cwd } })
const sessionId = created.sessionId
console.log(`session ${sessionId} (preset ${created.agentPreset ?? 'default'})`)
await rpc('session/prompt', {
  request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: prompt }] },
})

let last = ''
for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  const list = await rpc('session/list', { _request: {} }, 30000)
  const row = list.items.find((item) => item.sessionId === sessionId)
  const stats = row?.projections?.values?.sessionStats
  last = JSON.stringify(stats ?? row?.projections?.values ?? null).slice(0, 200)
  if ((stats?.turns ?? 0) >= 1) {
    console.log(`VERIFY_OK turns=${stats.turns} steps=${stats.steps} ttft=${stats.ttftMs}ms`)
    console.log(`cleanup: rm -rf <home>/sessions/*/${sessionId}`)
    process.exit(0)
  }
  if (row?.projections?.values?.lastError) console.log('turn error seen:', JSON.stringify(row.projections.values.lastError).slice(0, 200))
}
console.log(`VERIFY_FAIL no completed turn after 90s; last=${last}`)
process.exit(1)
