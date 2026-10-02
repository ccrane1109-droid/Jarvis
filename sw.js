/* ==========================================================================
   JARVIS — service worker
   Network-first with cache fallback, so the app still opens offline once
   it's been loaded at least once, but never serves stale content while
   online. All user data lives in localStorage, not in this cache.

   CACHE_NAME and the ?v=N query string on every local <link>/<script> tag
   in index.html should be bumped together on every deploy that changes CSS
   or JS. Belt and suspenders: CACHE_NAME rotates this worker's own Cache
   API storage, and the ?v=N query string changes the actual URL being
   requested, which busts the *browser's* HTTP cache (and any CDN edge
   cache in front of GitHub Pages) independently of this service worker or
   its cache:"no-store" fetch below — that combination is what actually
   fixed a real bug where a stale cached style.css shipped alongside a
   fresh index.html, leaving brand-new CSS classes completely unstyled.
   ========================================================================== */

const CACHE_NAME = "jarvis-cache-v17";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=17",
  "./manifest.json",
  "./icon.svg",
  "./js/vendor/qrcode/qrcode.js",
  "./js/vendor/qrcode/qrcode_UTF8.js",
  "./js/firebase-config.js?v=17",
  "./js/auth.js?v=17",
  "./js/app.js?v=17",
  "./js/exercises.js?v=17",
  "./js/workout.js?v=17",
  "./js/form-check.js?v=17",
  "./js/nutrition.js?v=17",
  "./js/habits.js?v=17",
  "./js/business.js?v=17",
  "./js/trading.js?v=17",
  "./js/blobstore.js?v=17",
  "./js/video-api-client.js?v=17",
  "./js/video-connections.js?v=17",
  "./js/video.js?v=17",
  "./js/video-studio.js?v=17"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  // cache: "no-store" bypasses the browser's own HTTP cache, not just this
  // service worker's cache — without it, a stale disk-cached response could
  // satisfy this fetch and the "network-first" promise above would be broken.
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(function (response) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      })
      .catch(function () { return caches.match(event.request); })
  );
});
