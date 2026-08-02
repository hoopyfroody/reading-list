// Offline is the point: a reading list is most useful on a train. The shell
// is cached on install and served cache-first; the list itself never touches
// this cache — it comes from local storage, and the network is only ever
// consulted through the contents API, which must not be cached at all.

const VERSION = 'reading-list-v1';
const SHELL = [
  './',
  './index.html',
  './add.html',
  './styles.css',
  './app.js',
  './add.js',
  './lib/normalize.js',
  './lib/markdown.js',
  './lib/fold.js',
  './lib/sync.js',
  './lib/github.js',
  './lib/local.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // api.github.com goes straight to the network

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      // Cache-first, then refresh in the background so a deploy lands on the
      // next launch rather than blocking this one.
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => hit ?? caches.match('./index.html'));

      return hit ?? fresh;
    }),
  );
});
