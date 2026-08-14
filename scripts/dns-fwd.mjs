// dns-fwd.mjs — zero-dependency DNS-over-HTTPS forwarder for Android
// Listens on 127.0.0.1:53 (v4) and :: (all v6, covers ::1 and any locally
// assigned link-local like fe80::5). Forwards via DoH to AliDNS, connecting
// to IP 223.5.5.5 directly with SNI dns.alidns.com (no upstream DNS needed).
import dgram from 'node:dgram'
import net from 'node:net'
import https from 'node:https'

const DOH_HOST = '223.5.5.5'
const DOH_SNI = 'dns.alidns.com'

function resolveViaDoh(queryBuf) {
  return new Promise((resolve, reject) => {
    const b64 = queryBuf.toString('base64url')
    const req = https.request({
      host: DOH_HOST,
      servername: DOH_SNI,
      port: 443,
      path: '/dns-query?dns=' + b64,
      method: 'GET',
      headers: { accept: 'application/dns-message' },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(8000, () => req.destroy(new Error('doh timeout')))
    req.end()
  })
}

function serveUdp(host, type) {
  const s = dgram.createSocket(type === 'udp6' ? { type, ipv6Only: true } : type)
  s.on('message', (msg, rinfo) => {
    resolveViaDoh(msg).then((resp) => {
      try { s.send(resp, rinfo.port, rinfo.address) } catch { /* ignore */ }
    }).catch(() => { /* ignore */ })
  })
  s.on('error', (e) => console.log('udp ' + host + ' error: ' + e.message))
  s.bind(53, host, () => console.log('udp listening on ' + host + ':53'))
}

function serveTcp(host) {
  const s = net.createServer((conn) => {
    let buf = Buffer.alloc(0)
    conn.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 2) {
        const len = buf.readUInt16BE(0)
        if (buf.length < 2 + len) return
        const q = buf.slice(2, 2 + len)
        buf = buf.slice(2 + len)
        resolveViaDoh(q).then((resp) => {
          const out = Buffer.alloc(2 + resp.length)
          out.writeUInt16BE(resp.length, 0)
          resp.copy(out, 2)
          try { conn.write(out) } catch { /* ignore */ }
        }).catch(() => { /* ignore */ })
      }
    })
    conn.on('error', () => { /* ignore */ })
  })
  s.on('error', (e) => console.log('tcp ' + host + ' error: ' + e.message))
  s.listen({ port: 53, host, ipv6Only: true }, () => console.log('tcp listening on ' + host + ':53'))
}

serveUdp('0.0.0.0', 'udp4')
serveTcp('0.0.0.0')
serveUdp('::', 'udp6')
serveTcp('::')
console.log('dns-fwd running')

