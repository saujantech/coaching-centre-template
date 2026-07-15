// Minimal service worker — exists only to satisfy PWA installability
// requirements (Chrome/Android requires a registered service worker with
// a fetch handler before it will offer "Add to Home Screen"). This is not
// about offline support: every admin page needs a live Supabase
// connection to be useful, so there is no cache-first/offline strategy
// here, just a passthrough to the network.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
