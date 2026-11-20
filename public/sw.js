self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }
  if (!data || typeof data.title !== 'string' || typeof data.id !== 'string') return;
  event.waitUntil(self.registration.showNotification(data.title,{
    body:'你的待办提醒',tag:data.id
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(tabs.length) return tabs[0].focus();
    return self.clients.openWindow('/');
  })());
});
