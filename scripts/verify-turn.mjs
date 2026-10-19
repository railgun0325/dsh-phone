// Post-deploy live API acceptance. A counted failed step is never success.
// Usage: node verify-turn.mjs [port] [cwd] [prompt]
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
export function assessTurn(events, expectedText) {
  const end = events.filter(e => e.type === 'turn/end').at(-1)
  if (!end) return false
  if (end.data.reason?.kind !== 'completed') throw new Error(`turn ended with ${end.data.reason?.kind ?? 'unknown reason'}`)
  const text = events.filter(e => e.type === 'assistant/message' && e.data.turn === end.data.turn && !e.data.interrupted)
    .flatMap(e => e.data.message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('').trim()
  if (!text || (expectedText !== undefined && text !== expectedText)) throw new Error('completed turn did not return the expected assistant text')
  return true
}
async function main() {
  const port = process.argv[2] ?? '3080', cwd = process.argv[3] ?? process.env.HOME
  const prompt = process.argv[4] ?? 'Reply with exactly: verify-ok'
  const base = `http://127.0.0.1:${port}/api`
  async function rpc(endpoint, args) {
    const res = await fetch(`${base}/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args } }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`)
    const body = await res.json()
    if (body.result?.ok !== true) throw new Error(`${endpoint}: ${body.result?.error?.code ?? 'RPC failed'}`)
    return body.result.value
  }
  const { sessionId } = await rpc('session/create', { request: { cwd } })
  console.log(`verification session ${sessionId}`)
  await rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: prompt }] } })
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const projection = await rpc('session/projections', { request: { sessionId } })
    if (!projection) continue
    const page = await rpc('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq, maxMessages: 50 } })
    const events = page.records.filter(record => record.type === 'event').map(record => record.event)
    if (assessTurn(events, process.argv[4] === undefined ? 'verify-ok' : undefined)) {
      console.log('VERIFY_OK completed turn with expected assistant content; scratch session retained for inspection')
      return
    }
  }
  throw new Error('no completed turn after 90s')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`VERIFY_FAIL ${error.message}`); process.exitCode = 1 })
}
