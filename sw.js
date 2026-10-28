// Each Pages path owns its cache; never remove another budget app's cache.
const CACHE = 'mijn-budget-pin-v1-' + self.registration.scope;
const FILES = ['./', './index.html', './style.css', './app.js', './beta.js', './pin.js', './pin.css', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(response => response || fetch(event.request)));
});
