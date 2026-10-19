import test from 'node:test'
import assert from 'node:assert/strict'
import { assessTurn } from '../scripts/verify-turn.mjs'
test('live acceptance requires successful closure and expected assistant content', () => {
 const message = { type: 'assistant/message', data: { turn: 1, message: { content: [{type:'text', text:'verify-ok'}] } } }
 const end = kind => ({ type:'turn/end', data:{turn:1,reason:{kind}} })
 assert.equal(assessTurn([message,end('completed')],'verify-ok'),true)
 assert.equal(assessTurn([message]),false)
 for (const kind of ['error','aborted','blocked','interrupted','max-tokens']) assert.throws(()=>assessTurn([message,end(kind)]))
 assert.throws(()=>assessTurn([end('completed')],'verify-ok'))
 assert.throws(()=>assessTurn([message,end('completed')],'unexpected'))
 assert.throws(()=>assessTurn([{...message,data:{...message.data,interrupted:true}},end('completed')],'verify-ok'))
})
