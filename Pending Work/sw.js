/* ============================================================
   sw.js — Service Worker for StudyAlert PWA
   Caches all app files so it works OFFLINE
   ============================================================ */

const CACHE_NAME = 'studyalert-v1';

// Files to cache for offline use
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  // Google Fonts (cached automatically on first load)
];

/* ── INSTALL EVENT ──
   Runs once when the service worker is first installed.
   We pre-cache all our files here.
*/
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app files');
        return cache.addAll(FILES_TO_CACHE);
      })
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

/* ── ACTIVATE EVENT ──
   Runs when the SW takes control.
   Clean up old caches here.
*/
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)  // Old versions
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // Take control of all pages
  );
});

/* ── FETCH EVENT ──
   Intercepts every network request.
   Strategy: Cache First, then Network fallback.
   This means the app loads instantly from cache,
   and updates files when online.
*/
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // If we have a cached version, return it
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise fetch from network and cache the result
        return fetch(event.request)
          .then(networkResponse => {
            // Don't cache non-successful responses or cross-origin
            if (
              !networkResponse ||
              networkResponse.status !== 200 ||
              networkResponse.type === 'opaque'
            ) {
              return networkResponse;
            }

            // Clone the response (it can only be consumed once)
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });

            return networkResponse;
          })
          .catch(() => {
            // If offline and not cached, return a simple offline message
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
      })
  );
});