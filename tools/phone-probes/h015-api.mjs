// DSH typert HTTP client for on-phone probes. Avoids shell-quoting pitfalls by
// building every request body as real JSON.
// usage: node phone-015-api.mjs <port> <cmd> [args...]
//   create <cwd> [agentPreset]
//   prompt <sessionId> [text] [mode]
//   list | catalog | inspect <sessionId> | cancel <sessionId>
const port = process.argv[2];
const cmd = process.argv[3];
const base = `http://127.0.0.1:${port}/api`;

async function rpc(endpoint, args, timeoutMs = 30000) {
  const rpcId = crypto.randomUUID();
  try {
    const res = await fetch(`${base}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { http: res.status, body };
  } catch (error) {
    return { error: String(error && error.message || error) };
  }
}

const a = process.argv.slice(4);
let out;
switch (cmd) {
  case 'create': {
    const request = { cwd: a[0] };
    if (a[1]) request.agentPreset = a[1];
    out = await rpc('session/create', { request });
    break;
  }
  case 'prompt':
    out = await rpc('session/prompt', {
      request: {
        sessionId: a[0],
        requestId: crypto.randomUUID(),
        mode: a[2] || 'queue',
        content: [{ type: 'text', text: a[1] || 'Reply with exactly: pong' }],
      },
    });
    break;
  case 'list': out = await rpc('session/list', { _request: {} }); break;
  case 'catalog': out = await rpc('session/modelCatalog', {}); break;
  case 'inspect': out = await rpc('session/inspect', { sessionId: a[0] }); break;
  case 'cancel': out = await rpc('session/cancel', { request: { sessionId: a[0] } }); break;
  case 'raw': out = await rpc(a[0], JSON.parse(a[1] || '{}')); break;
  default: out = { error: `unknown cmd ${cmd}` };
}
console.log(JSON.stringify(out));
