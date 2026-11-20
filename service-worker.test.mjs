import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const script = await readFile(new URL('./public/sw.js', import.meta.url), 'utf8');

function worker(tabs = []) {
  const handlers = {};
  const shown = [];
  const opened = [];
  runInNewContext(script, {self: {
    addEventListener(name, handler) { handlers[name] = handler; },
    registration: {async showNotification(title, options) { shown.push({title, ...options}); }},
    clients: {async matchAll() { return tabs; }, async openWindow(url) { opened.push(url); }}
  }});
  return {handlers, shown, opened};
}

test('push worker displays a reminder with a stable notification tag, ignoring malformed input', async () => {
  const {handlers, shown} = worker();
  let pending;
  handlers.push({data: {json: () => ({id: 'test-1', title: '喝水'})}, waitUntil(p) { pending = p; }});
  await pending;
  assert.deepEqual(shown, [{title: '喝水', body: '你的待办提醒', tag: 'test-1'}]);
  handlers.push({data: {json() { throw new Error('bad payload'); }}, waitUntil: () => assert.fail()});
  assert.equal(shown.length, 1);
});

test('clicking a reminder focuses an existing tab or opens the app', async () => {
  let focuses = 0, closes = 0;
  for (const tabs of [[{async focus() { focuses++; }}], []]) {
    const {handlers, opened} = worker(tabs);
    let pending;
    handlers.notificationclick({notification: {close() { closes++; }}, waitUntil(p) { pending = p; }});
    await pending;
    assert.deepEqual(opened, tabs.length ? [] : ['/']);
  }
  assert.equal(focuses, 1);
  assert.equal(closes, 2);
});
