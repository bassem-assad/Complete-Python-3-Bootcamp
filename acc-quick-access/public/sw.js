// Minimal service worker: caches the app shell only. Never caches /api or /auth (data stays live and private).
const CACHE = 'accqa-shell-v1';
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin ||
      url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;
  // Network first so updates arrive; fall back to cache when offline.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
