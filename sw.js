/* 오프라인 캐시 — 앱 셸만 담는다. 이력서 내용은 localStorage에 있다. */

const CACHE = 'resume-builder-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 네트워크 우선, 실패하면 캐시 — 파일을 고쳐도 새로고침으로 바로 반영된다. */
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(ev.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(ev.request).then(r => r || caches.match('./index.html')))
  );
});
