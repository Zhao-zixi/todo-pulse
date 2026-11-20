import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './server.mjs';
async function start(options){
  const {server,tick}=createApp(options); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const request=async (path,method='GET',input,headers={})=>{
    const res=await fetch(base+path,{method,headers:{...headers,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});
    return [res.status,await res.json()];
  };
  return {request,tick,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('Chinese draft (UTC+8) and input/host protections',async()=>{
  const app=await start({dbPath:':memory:',clock:()=>Date.parse('2026-11-20T10:00:00Z'),aiKey:''});
  try{
    let [code,{draft}]=await app.request('/api/draft','POST',{text:'明晚八点提醒我写周报，每隔十分钟提醒一次',offsetMinutes:480});
    assert.equal(code,200); assert.equal(draft.nextAt,'2026-11-21T12:00:00.000Z'); assert.equal(draft.intervalMinutes,10); assert.equal(draft.title,'写周报');
    assert.equal((await app.request('/api/draft','POST',{text:'每隔2分钟提醒我检查一次'}))[1].draft.title,'检查一次');
    assert.equal((await app.request('/api/tasks','POST',{title:'x',intervalMinutes:-1}))[0],400);
    assert.equal((await app.request('/api/tasks','GET',undefined,{'Sec-Fetch-Site':'cross-site'}))[0],403);
  }finally{await app.close();}
});
test('repeat and once persist through restart; missed reminders coalesce and complete cancels',async()=>{
  const project=await mkdtemp(join(tmpdir(),'todo-pulse-'));
  let now=Date.parse('2026-11-20T08:00:00Z');
  const opts={dbPath:join(project,'state.db'),clock:()=>now,pushEnabled:true};
  let app=await start(opts);
  try {
    const first=(await app.request('/api/status'))[1].publicKey;
    const nextAt='2026-11-20T08:01:00Z';
    const repeat=(await app.request('/api/tasks','POST',{title:'重复',nextAt,intervalMinutes:2}))[1].task;
    await app.request('/api/tasks','POST',{title:'一次',nextAt});
    await app.close(); now+=7*60_000; app=await start(opts);
    assert.equal((await app.request('/api/status'))[1].publicKey,first);
    const events=(await app.request('/api/reminders'))[1].events;
    assert.equal(events.length,2);
    assert.equal(events.find(e=>e.title==='重复').scheduledAt,'2026-11-20T08:07:00.000Z');
    assert.equal((await app.request('/api/tasks'))[1].tasks.find(t=>t.id===repeat.id).nextAt,'2026-11-20T08:09:00.000Z');
    await app.request('/api/tasks/'+repeat.id,'PATCH',{done:true});
    now+=12*60_000; app.tick();
    assert.deepEqual((await app.request('/api/reminders'))[1].events.map(e=>e.title),['一次']);
    assert.equal((await app.request('/api/push','POST',{subscription:{endpoint:'https://127.0.0.1/'}}))[0],400);
  }finally{ await app.close(); await rm(project,{recursive:true,force:true}); }
});
test('AI endpoint builds a draft without saving; invalid AI output falls back',async()=>{
  const {createServer}=await import('node:http');
  let bad=false, input, authorization;
  const upstream=createServer(async (req,res)=>{
    authorization=req.headers.authorization;
    const chunks=[];
    for await(const chunk of req) chunks.push(chunk);
    input=JSON.parse(Buffer.concat(chunks));
    assert.equal(req.url,'/v1/chat/completions');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:bad?'not-json':JSON.stringify({title:'写周报',notes:'附截图',intervalMinutes:5})}}]}));
  });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  const app=await start({dbPath:':memory:',aiKey:'test-only',model:'mock-model',baseURL:'http://127.0.0.1:'+upstream.address().port+'/v1'});
  try{
    const [code,result]=await app.request('/api/draft','POST',{text:'帮我写周报，每隔5分钟提醒'});
    assert.equal(code,200);
    assert.equal(result.source,'ai');
    assert.equal(result.draft.notes,'附截图');
    assert.equal(result.draft.intervalMinutes,5);
    assert.equal(authorization,'Bearer test-only');
    assert.equal(input.model,'mock-model');
    assert.equal((await app.request('/api/tasks'))[1].tasks.length,0);
    bad=true;
    const fallback=(await app.request('/api/draft','POST',{text:'帮我写周报，每隔5分钟提醒'}))[1];
    assert.equal(fallback.source,'local');
    assert.equal(fallback.draft.intervalMinutes,5);
    assert.ok(fallback.warning);
  }finally{await app.close();await new Promise(resolve=>upstream.close(resolve));}
});
test('due events reach injected desktop notifier without any browser poll',async()=>{
  let now=Date.parse('2026-11-20T08:00:00Z'),closed=false;
  const received=[];
  const app=await start({dbPath:':memory:',clock:()=>now,windowsNotifier:{notify:e=>received.push(...e),close:()=>{closed=true;}}});
  try{
    assert.equal((await app.request('/api/status'))[1].windowsNotificationsEnabled,true);
    await app.request('/api/tasks','POST',{title:'弹窗',intervalMinutes:1});
    now+=60_000;app.tick();app.tick();
    assert.equal(received.length,1);assert.equal(received[0].title,'弹窗');
  }finally{await app.close();}
  assert.equal(closed,true);
});
