/* komorebi service worker: shows the push notifications the Mac Bridge sends, and opens the room when one is tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const readWorkerLang = async () => {
  try {
    if (typeof caches === 'undefined') return 'zh';
    const cache = await caches.open('komorebi-prefs');
    const res = await cache.match('/__komorebi_lang');
    const lang = res ? (await res.text()).trim() : '';
    return lang === 'en' || lang === 'ja' ? lang : 'zh';
  } catch {
    return 'zh';
  }
};

const localizeWho = (lang, who) => {
  if (lang !== 'en') return who;
  return who.replace(/^(瞳|光|響)(?=$| · )/, (_, n) => (n === '瞳' ? 'Hitomi' : n === '光' ? 'Hikaru' : 'Hibiki'));
};

const localizePush = (lang, title, body, kind) => {
  if (lang !== 'en' && lang !== 'ja') return { title, body };
  const nextTitle = title || 'Komorebi Bridge';
  if (kind === 'inbox') return { title: nextTitle, body: lang === 'en' ? 'An Inbox item needs attention.' : 'Inbox に確認が必要な項目があります。' };
  if (kind === 'test' || body === '測試通知：收到這則通知，代表鎖屏推送可以使用') {
    return {
      title: nextTitle,
      body: lang === 'en'
        ? 'Test notification: if you received this, lock-screen push is working.'
        : 'テスト通知：この通知が届けば、ロック画面プッシュ通知は利用できます。',
    };
  }
  const approval = /^(.+?) 等待你審批$/.exec(body);
  if (approval) {
    const who = localizeWho(lang, approval[1]);
    return {
      title: nextTitle,
      body: lang === 'en' ? `${who} is waiting for your approval` : `${who} が承認を待っています`,
    };
  }
  const question = /^(.+?) 有問題等你回答$/.exec(body);
  if (question) {
    const who = localizeWho(lang, question[1]);
    return {
      title: nextTitle,
      body: lang === 'en' ? `${who} has a question for you` : `${who} が回答を待っています`,
    };
  }
  const attention = /^(.+?) 畫面長時間沒有變化，可能需要你處理$/.exec(body);
  if (attention) {
    const who = localizeWho(lang, attention[1]);
    return {
      title: nextTitle,
      body: lang === 'en'
        ? `${who} screen has not changed for a while and may need your attention`
        : `${who} の画面が長時間変化していません。確認が必要かもしれません`,
    };
  }
  const done = /^(.+?) 已完成$/.exec(body);
  if (done) {
    const who = localizeWho(lang, done[1]);
    return {
      title: nextTitle,
      body: lang === 'en' ? `${who} finished` : `${who} が完了しました`,
    };
  }
  return { title: nextTitle, body };
};

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }
  const text = value => (typeof value === 'string' ? value : '');
  // Safari requires every push to show a notification, so this always does, even for a message it cannot read.
  event.waitUntil((async () => {
    const lang = await readWorkerLang();
    const localized = localizePush(lang, text(data.title) || 'Komorebi Bridge', text(data.body), text(data.kind));
    return self.registration.showNotification(localized.title, {
      body: localized.body,
      tag: text(data.tag) || 'komorebi',
      // A newer notification with the same tag replaces the old one; this makes it alert again instead of replacing it silently.
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { roomId: text(data.roomId) || undefined, ...(data.openInbox === true ? { openInbox: true } : {}) },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const roomId = event.notification.data && event.notification.data.roomId;
  const openInbox = event.notification.data && event.notification.data.openInbox === true;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => 'focus' in client);
    if (open) {
      await open.focus();
      if (roomId) open.postMessage({ type: 'komorebi-open-room', roomId });
      else if (openInbox) open.postMessage({ type: 'komorebi-open-inbox' });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(roomId ? '/?room=' + encodeURIComponent(roomId) : openInbox ? '/?inbox=pending' : '/');
  })());
});
