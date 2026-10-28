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

const CACHE_NAME = "jarvis-cache-v57";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=57",
  "./manifest.json",
  "./icon.svg",
  "./js/vendor/qrcode/qrcode.js",
  "./js/vendor/qrcode/qrcode_UTF8.js",
  "./js/firebase-config.js?v=57",
  "./js/backup-logic.js?v=57",
  "./js/cloud-backup.js?v=57",
  "./js/auth.js?v=57",
  "./js/app.js?v=57",
  "./js/exercises.js?v=57",
  "./js/workout.js?v=57",
  "./js/form-check.js?v=57",
  "./js/nutrition.js?v=57",
  "./js/nutrition-label-parse.js?v=57",
  "./js/nutrition-label-scan.js?v=57",
  "./js/groceries.js?v=57",
  "./js/habits.js?v=57",
  "./js/discipline-logic.js?v=57",
  "./js/discipline-program.js?v=57",
  "./js/discipline-habits.js?v=57",
  "./js/discipline-insights.js?v=57",
  "./js/discipline-charts.js?v=57",
  "./js/discipline.js?v=57",
  "./functions/lib/reminder-spec.js?v=57",
  "./functions/lib/reminder-events.js?v=57",
  "./js/reminders.js?v=57",
  "./js/push-handlers.js?v=57",
  "./icon-192.png",
  "./apple-touch-icon.png",
  "./js/business.js?v=57",
  "./js/trading.js?v=57",
  "./js/blobstore.js?v=57",
  "./js/video-api-client.js?v=57",
  "./js/video-connections.js?v=57",
  "./js/video.js?v=57",
  "./js/video-studio.js?v=57",
  "./functions/lib/idea-spec.js?v=57",
  "./functions/lib/niche-spec.js?v=57",
  "./js/marketing-stats.js?v=57",
  "./js/niche-research.js?v=57",
  "./js/content-intelligence.js?v=57"
];

// Push notifications (reminders). The rules live in js/push-handlers.js so they can be tested.
importScripts("./js/push-handlers.js?v=57");

// Every push must show a notification, even a damaged one: Apple removes the push
// permission from a web app that keeps receiving pushes that show nothing.
self.addEventListener("push", function (event) {
  const H = self.JarvisPushHandlers;
  let raw = "";
  try { raw = event.data ? event.data.text() : ""; } catch (e) { raw = ""; }
  const n = H.notificationFor(H.parsePush(raw), self.registration.scope);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

// A tap brings JARVIS forward (or opens it) and tells the page which reminder it was.
self.addEventListener("notificationclick", function (event) {
  const H = self.JarvisPushHandlers;
  const data = event.notification.data || {};
  const scope = self.registration.scope;
  const target = H.targetUrl(data, scope);
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      const i = H.appWindow(list.map(function (c) { return c.url; }), scope);
      if (i === -1) return self.clients.openWindow(target);
      return list[i].focus().then(function (client) {
        if (client && client.postMessage) client.postMessage({ type: "jarvis-open-reminder", id: data.id || "", kind: data.kind || "reminder", url: target });
        return client;
      });
    })
  );
});

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
