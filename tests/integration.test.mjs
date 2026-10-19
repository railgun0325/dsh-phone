import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { installation } from '../scripts/dsh-compat.mjs'
const dsh = process.env.DSH_INSTALL
const root = resolve(import.meta.dirname, '..')
test('custom profile migration and real web/API boot with installed npm tree', {skip: !dsh && 'set DSH_INSTALL to a disposable npm install'}, async () => {
 const tree = installation(dsh), dir = mkdtempSync(join(tmpdir(),'dsh-integration-'))
 let child
 try {
  const home = join(dir,'.dsh'), profile = join(home,'profiles/web'), plugin = join(dir,'plugin')
  mkdirSync(join(profile,'node_modules'),{recursive:true})
  cpSync(join(root,'plugin'),plugin,{recursive:true})
  symlinkSync(join(tree.scope,'..'),join(plugin,'node_modules'),'junction')
  symlinkSync(plugin,join(profile,'node_modules/dsh-android-control'),'junction')
  const config = join(profile,'cordis.patch.yml')
  const user = '# preserve my configuration\n- id: client-hmr\n  disabled: true\n'
  writeFileSync(config,user)
  const configure = () => spawnSync(process.execPath,[join(root,'scripts/configure-android-profile.mjs'),tree.root,config],{encoding:'utf8'})
  assert.equal(configure().status,0)
  const configured = readFileSync(config,'utf8')
  assert.ok(configured.startsWith(user))
  assert.equal(configure().status,0)
  assert.equal(readFileSync(config,'utf8'),configured)
  const apply = spawnSync(process.execPath,[join(root,'scripts/apply-android-patches.mjs'),tree.root],{encoding:'utf8'})
  assert.equal(apply.status,0,apply.stderr)
  const verify = spawnSync(process.execPath,[join(root,'scripts/verify-patched-tree.mjs'),home,tree.root],{encoding:'utf8'})
  assert.equal(verify.status,0,verify.stdout+verify.stderr)
  const listener = createServer().listen(0,'127.0.0.1'); await once(listener,'listening')
  const port=listener.address().port; await new Promise(r=>listener.close(r))
  const env={...process.env,DSH_HOME:home}
  for(const key of Object.keys(env)) if(/API_KEY|AUTH_TOKEN/.test(key)) delete env[key]
  let log=''
  child=spawn(process.execPath,[join(tree.root,'lib/bin.js'),'web','--no-open','--host','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x)
  const origin=`http://127.0.0.1:${port}`
  let ready=false
  for(let i=0;i<150;i++) {
   if(child.exitCode!==null) break
   try {const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,200))
  }
  const safeLog=log.replace(/token=[^\s]+/g,'token=[REDACTED]')
  assert.ok(ready,safeLog)
  assert.doesNotMatch(log,/did not activate|Error:|pending \(waiting/)
  async function rpc(method,args) {
   const res=await fetch(`${origin}/api/${method}`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}}),signal:AbortSignal.timeout(10000)})
   assert.equal(res.status,200)
   const body=await res.json();assert.equal(body.result?.ok,true,JSON.stringify(body));return body.result.value
  }
  const session=await rpc('session/create',{request:{cwd:dir}})
  assert.ok(session.sessionId)
  const list=await rpc('session/list',{_request:{}})
  assert.ok(list.items.some(row=>row.sessionId===session.sessionId))
  // A cross-origin browser cannot use the local token exemption.
  const denied=await fetch(`${origin}/api/session/list`,{method:'POST',headers:{'content-type':'application/json',origin:'http://evil.test'},body:'{}'})
  assert.equal(denied.status,403)
 } finally {
  if(child && child.exitCode===null) {const exited=once(child,'exit');child.kill();await exited}
  rmSync(dir,{recursive:true,force:true})
 }
})
