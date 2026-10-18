/* ==========================================================================
   JARVIS — what the service worker does with a push message and with a tap on
   a notification. Plain functions with no browser objects, so every rule can
   be tested; sw.js loads this with importScripts.

   The one rule that matters most: EVERY push must end in a visible
   notification. Apple removes a phone's push permission after a few pushes
   that show nothing, so even a damaged or empty message gets a plain
   fallback notification rather than none.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisPushHandlers = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FALLBACK = { title: "JARVIS", body: "You have a reminder.", tag: "jarvis-reminder", url: "./index.html", kind: "reminder", id: "" };

  function text(v, max, fallback) {
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
    return t || fallback;
  }

  // The message from the server, as an object that is always safe to show. Never throws.
  function parsePush(raw) {
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return Object.assign({}, FALLBACK);
    const id = text(data.id, 80, "");
    return {
      title: text(data.title, 80, FALLBACK.title),
      body: text(data.body, 160, ""),
      tag: text(data.tag, 80, id || FALLBACK.tag),
      url: text(data.url, 300, FALLBACK.url),
      kind: data.kind === "test" ? "test" : "reminder",
      id: id
    };
  }

  // What to hand to showNotification. scope is the service worker's scope URL.
  function notificationFor(payload, scope) {
    const base = String(scope || "./");
    const icon = new URL("icon-192.png", base).href;
    return {
      title: payload.title,
      options: {
        body: payload.body,
        // The same tag replaces a notification still on screen, so a retry never stacks a second copy.
        tag: payload.tag,
        icon: icon,
        badge: icon,
        data: { url: payload.url, id: payload.id, kind: payload.kind }
      }
    };
  }

  // Where a tap should go: always inside the app, never to some other address.
  function targetUrl(data, scope) {
    const base = String(scope || "./");
    const fallback = new URL("index.html", base).href;
    if (!data || typeof data.url !== "string" || !data.url.trim()) return fallback;
    let u;
    try { u = new URL(data.url, base); } catch (e) { return fallback; }
    let origin;
    try { origin = new URL(base).origin; } catch (e) { return fallback; }
    if (u.origin !== origin || u.href.indexOf(base) !== 0) return fallback;
    return u.href;
  }

  // The open window of the app to bring forward, if any.
  function appWindow(clientUrls, scope) {
    const base = String(scope || "./");
    for (let i = 0; i < clientUrls.length; i++) if (String(clientUrls[i]).indexOf(base) === 0) return i;
    return -1;
  }

  return { FALLBACK: FALLBACK, parsePush: parsePush, notificationFor: notificationFor, targetUrl: targetUrl, appWindow: appWindow };
});
