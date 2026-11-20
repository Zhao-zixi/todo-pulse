import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWindowsNotifier} from './windows-notify.mjs';
const opts={platform:'win32',env:{SystemRoot:'C:\\Windows',SESSIONNAME:'Console'},hasFile:()=>true};
test('Windows popup is off outside Windows, in services, when disabled or when PowerShell is missing',()=>{
  assert.equal(createWindowsNotifier({...opts,platform:'linux'}),null);
  assert.equal(createWindowsNotifier({...opts,env:{...opts.env,SESSIONNAME:'Services'}}),null);
  assert.equal(createWindowsNotifier({...opts,env:{...opts.env,TODO_WINDOWS_NOTIFY:'0'}}),null);
  assert.equal(createWindowsNotifier({...opts,hasFile:()=>false}),null);
});
test('Windows popup passes Chinese and command-like text as UTF-8 stdin; queue stays bounded',()=>{
  const children=[], reports=[];
  const notifier=createWindowsNotifier({...opts,report:r=>reports.push(r),spawnProcess:(exe,args,options)=>{
    const child=new EventEmitter();
    child.stdin=new EventEmitter();
    child.stdin.end=(data,encoding)=>{child.data=data;child.encoding=encoding;};
    child.kill=()=>{child.killed=true;child.emit('close',null,'SIGTERM');};
    children.push(child);
    assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(options.windowsHide,true);
    assert.equal(args.includes('-ExecutionPolicy'),false);
    assert.equal(args.some(value=>value.includes('中文提醒')),false);
    return child;
  }});
  notifier.notify([{title:'中文提醒 "$env:PATH"; $(evil)'}]);
  assert.equal(children[0].data,'中文提醒 "$env:PATH"; $(evil)');
  assert.equal(children[0].encoding,'utf8');
  for(let i=0;i<8;i++) notifier.notify([{title:String(i)}]);
  assert.equal(children.length,1);
  children[0].emit('close',0,null);
  assert.equal(children[1].data,'3');
  notifier.close();
  assert.equal(children[1].killed,true);
  assert.equal(children.length,2);
  assert.deepEqual(reports,[]);
});
