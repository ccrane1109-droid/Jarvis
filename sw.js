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

const CACHE_NAME = "jarvis-cache-v100";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=100",
  "./manifest.json",
  "./icon.svg",
  "./js/vendor/qrcode/qrcode.js",
  "./js/vendor/qrcode/qrcode_UTF8.js",
  "./js/firebase-config.js?v=100",
  "./js/backup-logic.js?v=100",
  "./js/live-refresh.js?v=100",
  "./js/cloud-backup.js?v=100",
  "./js/auth.js?v=100",
  "./js/app.js?v=100",
  "./js/menu-ui.js?v=100",
  "./js/exercises.js?v=100",
  "./js/workout-logic.js?v=100",
  "./js/exercise-logic.js?v=100",
  "./js/exercise-guides.js?v=100",
  "./js/musclemap-art.js?v=100",
  "./js/workout.js?v=100",
  "./js/workout-ui.js?v=100",
  "./js/routine-logic.js?v=100",
  "./js/routines-ui.js?v=100",
  "./js/progress-logic.js?v=100",
  "./js/insights-logic.js?v=100",
  "./js/charts.js?v=100",
  "./js/history-ui.js?v=100",
  "./js/insights-ui.js?v=100",
  "./js/library-ui.js?v=100",
  "./js/progress-ui.js?v=100",
  "./js/formcheck-logic.js?v=100",
  "./js/form-check.js?v=100",
  "./js/nutrition.js?v=100",
  "./js/nutrition-label-parse.js?v=100",
  "./js/food-amount-logic.js?v=100",
  "./js/nutrition-label-scan.js?v=100",
  "./js/food-flow-ui.js?v=100",
  "./js/groceries.js?v=100",
  "./js/mealprep-foods.js?v=100",
  "./js/mealprep-logic.js?v=100",
  "./js/habit-logic.js?v=100",
  "./js/task-kind-logic.js?v=100",
  "./js/habit-plan-logic.js?v=100",
  "./js/habit-schedule-logic.js?v=100",
  "./js/planning-core-logic.js?v=100",
  "./js/goals-logic.js?v=100",
  "./js/dayplan-logic.js?v=100",
  "./js/habits.js?v=100",
  "./js/dayplan-ui.js?v=100",
  "./js/calendar-logic.js?v=100",
  "./js/schedule-logic.js?v=100",
  "./js/ics-logic.js?v=100",
  "./js/assistant-logic.js?v=100",
  "./js/calendar-ui.js?v=100",
  "./js/assistant-ui.js?v=100",
  "./js/calendar-reminders-logic.js?v=100",
  "./js/calendar-reminders-ui.js?v=100",
  "./js/ics-ui.js?v=100",
  "./js/home-ui.js?v=100",
  "./js/discipline-logic.js?v=100",
  "./js/discipline-program.js?v=100",
  "./js/discipline-habits.js?v=100",
  "./js/discipline-insights.js?v=100",
  "./js/discipline-charts.js?v=100",
  "./js/discipline-delivery.js?v=100",
  "./js/discipline.js?v=100",
  "./js/wakecheck-logic.js?v=100",
  "./js/wakecheck.js?v=100",
  "./functions/lib/reminder-spec.js?v=100",
  "./functions/lib/reminder-events.js?v=100",
  "./js/reminders.js?v=100",
  "./js/push-handlers.js?v=100",
  "./icon-192.png",
  "./apple-touch-icon.png",
  "./js/video-api-client.js?v=100",
  "./js/video-connections.js?v=100",
  "./js/retired-data.js?v=100",
  "./js/retired-ui.js?v=100",
  "./js/shopify-ui.js?v=100",
  "./js/learning-srs.js?v=100",
  "./js/learning-logic.js?v=100",
  "./js/learning-cards-logic.js?v=100",
  "./js/learning-goals-logic.js?v=100",
  "./js/learning-links-logic.js?v=100",
  "./js/learning-reading-logic.js?v=100",
  "./js/learning-notebook-logic.js?v=100",
  "./js/learning-weekly-logic.js?v=100",
  "./js/learning-overview-logic.js?v=100",
  "./js/learning-store.js?v=100",
  "./js/learning-ui.js?v=100",
  "./js/learning-books-ui.js?v=100",
  "./js/learning-research-ui.js?v=100",
  "./js/learning-library-ui.js?v=100",
  "./js/learning-actions-ui.js?v=100",
  "./js/learning-review-ui.js?v=100",
  "./js/learning-study-ui.js?v=100",
  "./js/learning-topics-ui.js?v=100",
  "./js/learning-goals-ui.js?v=100",
  "./js/learning-reading-ui.js?v=100",
  "./js/learning-notebook-ui.js?v=100",
  "./js/learning-capture-ui.js?v=100",
  "./js/learning-overview-ui.js?v=100",
  "./js/plan-logic.js?v=100",
  "./js/plan-store.js?v=100",
  "./js/plan-charts.js?v=100",
  "./js/plan-ui.js?v=100",
  "./js/plan-yearly-ui.js?v=100",
  "./js/plan-quarterly-ui.js?v=100",
  "./js/plan-dash-ui.js?v=100",
  "./js/plan-breakdown-ui.js?v=100",
  "./js/plan-week-logic.js?v=100",
  "./js/intentions-logic.js?v=100",
  "./js/day-planner-logic.js?v=100",
  "./js/plan-insights-logic.js?v=100",
  "./js/plan-week-ui.js?v=100",
  "./js/plan-intentions-ui.js?v=100",
  "./js/plan-insights-ui.js?v=100",
  "./js/plan-home-ui.js?v=100",
  "./js/calendar-planner-ui.js?v=100",
  "./js/planning-sync-ui.js?v=100",
  "./js/focus-logic.js?v=100",
  "./js/focus-ui.js?v=100",
  "./js/goals-ui.js?v=100",
  "./js/mealprep-ui.js?v=100",
  "./js/mealprep-plan-ui.js?v=100",
  "./js/mealprep-recipes-ui.js?v=100",
  "./js/mealprep-grocery-ui.js?v=100",
  "./js/mealprep-tracker-ui.js?v=100",
  "./js/health-overview-ui.js?v=100",
  "./js/planning-overview-logic.js?v=100",
  "./js/plan-routine-logic.js?v=100",
  "./js/planning-quick-ui.js?v=100",
  "./js/plan-routine-ui.js?v=100",
  "./js/planning-overview-ui.js?v=100"
];

// Push notifications (reminders). The rules live in js/push-handlers.js so they can be tested.
importScripts("./js/push-handlers.js?v=100");

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
