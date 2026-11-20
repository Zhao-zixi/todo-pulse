'use strict';
const $ = id => document.getElementById(id);
const editor = $('editor');
const feedback = $('feedback');
let editing = null;
let registration;
let pushActive = false;
let settings = {};
let refreshing = false;
let hydrated = false;
let previousTasks;
let previousEvents;
const seen = new Set();
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, {
    method, ...(body === undefined ? {} : {headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '操作失败，请稍后重试。');
  return data;
}
function message(text, error = false) {
  feedback.textContent = text;
  feedback.classList.toggle('error', error);
}
function local(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
function fill(task = {}, id = null) {
  editing = id;
  $('title').value = task.title ?? '';
  $('notes').value = task.notes ?? '';
  $('time').value = local(task.nextAt);
  $('interval').value = task.intervalMinutes ?? '';
  $('save').textContent = id === null ? '保存待办' : '保存修改';
  $('cancel').hidden = id === null;
}
function showDate(value) {
  return new Date(value).toLocaleString('zh-CN', {dateStyle:'medium', timeStyle:'short'});
}
function element(tag, text, cls) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (cls) item.className = cls;
  return item;
}
function action(label, fn) {
  const button = element('button', label);
  button.type = 'button';
  button.onclick = async () => {
    button.disabled = true;
    try { await fn(); } catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  };
  return button;
}
function renderTasks(tasks) {
  $('count').textContent = tasks.filter(task => !task.done).length + ' 项未完成';
  const ordered = [...tasks].sort((a,b) => Number(a.done) - Number(b.done) || (Date.parse(a.nextAt) || Infinity) - (Date.parse(b.nextAt) || Infinity));
  $('tasks').replaceChildren(...ordered.map(task => {
    const li = element('li', '', task.done ? 'done' : '');
    li.append(element('strong', task.title));
    if (task.notes) li.append(element('p', task.notes));
    const time = task.nextAt ? '下次提醒：' + showDate(task.nextAt) : '未安排提醒';
    li.append(element('p', time + (task.intervalMinutes ? ' · 每 ' + task.intervalMinutes + ' 分钟' : ''), 'muted'));
    const actions = element('div', '', 'actions');
    const path = 'tasks/' + encodeURIComponent(task.id);
    actions.append(action(task.done ? '重新打开' : '完成', async () => {
      await api(path, 'PATCH', {done:!task.done}); await refresh();
    }), action('编辑', () => { fill(task, task.id); $('title').focus(); }),
    action('删除', async () => {
      if (!confirm('删除这条待办？')) return;
      await api(path, 'DELETE');
      if (editing === task.id) fill();
      await refresh();
    }));
    li.append(actions);
    return li;
  }));
  if (!tasks.length) $('tasks').append(element('li','还没有待办，先记下今天的一件事。','muted'));
}
async function renderEvents(events) {
  const sorted = [...events].sort((a,b)=>Date.parse(b.scheduledAt)-Date.parse(a.scheduledAt));
  $('events').replaceChildren(...sorted.slice(0,12).map(e => element('li', showDate(e.scheduledAt) + ' · ' + e.title)));
  if (!events.length) $('events').append(element('li','到点的提醒会显示在这里。','muted'));
  for (const e of [...sorted].reverse()) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (!hydrated || pushActive || !('Notification' in window) || Notification.permission !== 'granted') continue;
    if (registration) await registration.showNotification('待办提醒', {body:e.title, tag:String(e.id)});
    else new Notification('待办提醒', {body:e.title, tag:String(e.id)});
  }
  hydrated = true;
  while (seen.size > 500) seen.delete(seen.values().next().value);
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [{tasks},{events}] = await Promise.all([api('tasks'), api('reminders')]);
    const taskSnapshot = JSON.stringify(tasks);
    if (taskSnapshot !== previousTasks) { renderTasks(tasks); previousTasks = taskSnapshot; }
    const eventSnapshot = JSON.stringify(events);
    if (eventSnapshot !== previousEvents) { await renderEvents(events); previousEvents = eventSnapshot; }
  } catch (error) { message(error.message, true); }
  finally { refreshing = false; }
}
$('generate').onsubmit = async event => {
  event.preventDefault();
  const button = $('generate').querySelector('button');
  button.disabled = true;
  try {
    const {draft, warning, source} = await api('draft','POST',{text:$('prompt').value,offsetMinutes:-new Date().getTimezoneOffset(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    fill(draft);
    $('title').focus();
    message((warning || (source === 'local' ? '已用本地规则生成草稿。' : '草稿已生成。')) + '请核对时间和间隔，再保存。');
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
};
editor.onsubmit = async event => {
  event.preventDefault();
  const button = $('save');
  button.disabled = true;
  try {
    const minutes = $('interval').value;
    const when = $('time').value;
    const data = {title:$('title').value.trim(),notes:$('notes').value.trim(),nextAt:when ? new Date(when).toISOString() : null,intervalMinutes:minutes ? Number(minutes) : null};
    if (!data.title) throw new Error('请填写待办标题。');
    const id = editing;
    await api(id === null ? 'tasks' : 'tasks/'+encodeURIComponent(id), id === null ? 'POST' : 'PATCH', data);
    fill();
    $('generate').reset();
    await refresh();
    message('待办已保存。');
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
};
$('cancel').onclick = () => fill();
function connection() {
  $('notifications').textContent = pushActive ? '关闭后台推送' : '开启通知';
  const ai = settings.aiEnabled ? 'AI 已接入' : 'AI 未配置';
  $('connection').textContent = ai + ' · ' + (pushActive ? '后台推送已开启' : '后台推送未开启，建议保持页面打开');
}
function keyBytes(value) {
  const padded = value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4);
  return Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
}
$('notifications').onclick = async () => {
  if (!('Notification' in window)) return message('当前浏览器不支持通知，请使用支持通知的浏览器或查看最近提醒。', true);
  $('notifications').disabled = true;
  try {
    if (pushActive && registration?.pushManager) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api('push', 'DELETE', {subscription:subscription.toJSON()});
        await subscription.unsubscribe();
      }
      localStorage.removeItem('todo-pulse-push');
      pushActive = false;
      connection();
      return message('已关闭后台推送，打开页面时仍可收到提醒。');
    }
    if (await Notification.requestPermission() !== 'granted') throw new Error('未取得通知权限，请在浏览器站点设置中开启。');
    if ('serviceWorker' in navigator) {
      try { registration = await navigator.serviceWorker.register('/sw.js'); }
      catch (error) { if (settings.pushEnabled) throw error; }
    }
    if (settings.pushEnabled && settings.publicKey && registration && 'pushManager' in registration) {
      registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:keyBytes(settings.publicKey)});
      await api('push','POST',{subscription:subscription.toJSON()});
      localStorage.setItem('todo-pulse-push', subscription.endpoint);
      pushActive = true;
    }
    connection();
    message(pushActive ? '通知已开启。后台送达仍取决于浏览器和系统设置。' : '已允许通知。当前只支持页面打开时提醒。');
  } catch (error) { message(error.message, true); }
  finally { $('notifications').disabled = false; }
};
(async () => {
  try {
    settings = await api('status');
    if ('serviceWorker' in navigator) registration = await navigator.serviceWorker.getRegistration();
    if (settings.pushEnabled && registration && 'pushManager' in registration) {
      const subscription = await registration.pushManager.getSubscription();
      pushActive = !!subscription && localStorage.getItem('todo-pulse-push') === subscription.endpoint;
    }
  } catch (error) { message(error.message, true); }
  connection();
  await refresh();
  setInterval(refresh, 5000);
})();
