/* ==========================================================================
   JARVIS — live refresh: when the other device has saved something, bring it in.

   The feature modules read their data once, when the app opens, and keep it in memory. So newer data from the other device
   cannot just be written under a running screen: the screen would never show it, and its next save would put the old copy
   back over the new one. What can be done safely is to start the app again, which reads everything fresh and combines it
   with what is on this device (see cloud-backup.js). This file decides WHEN that is safe, and does it:

     - right when you come back to the app (nothing has been touched yet), or when you have been idle for a few seconds;
     - never while a form or sheet is open or you are typing: a small "Refresh" pill is shown instead, and the refresh
       happens by itself as soon as the form is closed and you are idle, or when you tap the pill;
     - the tab and sub-tab you were on are put back afterwards;
     - the same news is acted on once: if a refresh could not absorb a revision, it is not repeated in a loop, and no more
       than one automatic refresh happens every 15 seconds.

   Nothing is lost by refreshing: every save is already on this device before it is uploaded, a workout in progress is kept
   as a draft, and start-up combines this device's changes with the cloud's instead of replacing them.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisLiveRefresh = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const IDLE_MS = 3000;          // no touch, key or scroll for this long: safe to refresh
  const RETURN_MS = 2500;        // just came back to the app and has not touched anything yet: safe
  const LOOP_GUARD_MS = 15000;   // at most one automatic refresh in this time
  const RECHECK_MS = 1000;
  const HANDLED_KEY = "jarvisLiveHandled";        // sessionStorage: { storageKey: newest revision already acted on }
  const REFRESHED_KEY = "jarvisLiveRefreshedAt";  // sessionStorage: when the last automatic refresh happened
  const TAB_KEY = "jarvisLiveTab";                // sessionStorage: the tabs to put back after a refresh

  // ctx: { visible, editing, dialogOpen, sinceRefreshMs, sinceReturnMs, interactedSinceReturn, idleMs }
  //   "wait"   the app is not on screen: decide again when it is
  //   "ask"    something is open or being typed: show the pill and let the person choose
  //   "soon"   not idle yet: look again in a moment
  //   "reload" refresh now
  function decide(c) {
    if (!c.visible) return "wait";
    if (c.editing || c.dialogOpen) return "ask";
    if (c.sinceRefreshMs < LOOP_GUARD_MS) return "ask";
    if (c.sinceReturnMs <= RETURN_MS && !c.interactedSinceReturn) return "reload";
    if (c.idleMs >= IDLE_MS) return "reload";
    return "soon";
  }

  /* ---------------- the page ---------------- */

  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  let pending = {};                 // storage key -> newest revision heard about
  let exactKeys = {};               // storage key -> true when its "revision" is a fingerprint of the content, compared for equality only
  let lastTouch = Date.now(), returnedAt = 0, touchedSinceReturn = true;
  let timer = null, pill = null, dismissed = false;

  function session() { try { return window.sessionStorage; } catch (e) { return null; } }
  function readJson(key, fallback) { const s = session(); try { const v = s && JSON.parse(s.getItem(key) || "null"); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function writeJson(key, value) { const s = session(); try { if (s) s.setItem(key, JSON.stringify(value)); } catch (e) { /* a browser that will not keep it: the guard just has less to go on */ } }
  function handledRevs() { const h = readJson(HANDLED_KEY, {}); return h && typeof h === "object" ? h : {}; }

  function isEditing() {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    const tag = a.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return ["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].indexOf(String(a.type).toLowerCase()) === -1;
    return !!a.isContentEditable;
  }
  function dialogIsOpen() {
    const list = document.querySelectorAll('.modal-overlay, .sheet-overlay, [role="dialog"], [aria-modal="true"]');
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.id === "liveRefreshPill") continue;
      if (e.classList.contains("hidden") || e.hidden) continue;
      if (e.getClientRects().length) return true;
    }
    return false;
  }

  // A clock that was set back (a phone re-checking the time, a laptop waking up) must not make "how long ago" negative: that would
  // read as "just now" for ever. Time since the last touch or return is then counted from now; time since the last refresh is treated
  // as long ago (the "same news is acted on once" memory still prevents a loop).
  function since(now, then, whenBackwards) { return then <= now ? now - then : whenBackwards; }

  function context() {
    const n = Date.now(), last = Number(readJson(REFRESHED_KEY, 0)) || 0;
    if (lastTouch > n) lastTouch = n;
    if (returnedAt > n) returnedAt = n;
    return {
      visible: document.visibilityState !== "hidden", editing: isEditing(), dialogOpen: dialogIsOpen(),
      sinceRefreshMs: since(n, last, Infinity), sinceReturnMs: returnedAt ? since(n, returnedAt, 0) : Infinity, interactedSinceReturn: touchedSinceReturn, idleMs: since(n, lastTouch, 0)
    };
  }

  /* ---- the pill ---- */

  function showPill() {
    if (dismissed) return;
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "liveRefreshPill";
      pill.className = "live-refresh-pill";
      pill.setAttribute("role", "status");
      pill.innerHTML = '<span class="live-refresh-text">New changes from your other device.</span>' +
        '<button type="button" class="btn btn-primary live-refresh-go" data-live="refresh">Refresh</button>' +
        '<button type="button" class="btn btn-secondary live-refresh-later" data-live="later" aria-label="Not now">Not now</button>';
      pill.addEventListener("click", function (e) {
        const b = e.target.closest("[data-live]");
        if (!b) return;
        if (b.getAttribute("data-live") === "refresh") reload();
        else { dismissed = true; hidePill(); }
      });
      document.body.appendChild(pill);
    }
    pill.classList.remove("hidden");
  }
  function hidePill() { if (pill) pill.classList.add("hidden"); }

  /* ---- the tabs, so a refresh puts you back where you were ---- */

  // The main tab first, then the sub-tabs inside it, then the Learning hub's own: they can only be opened in that order.
  const TAB_ATTRS = ["data-target", "data-subtarget", "data-ln"];
  function captureTabs() {
    const out = [];
    TAB_ATTRS.forEach(function (attr) {
      Array.prototype.forEach.call(document.querySelectorAll("button.active[" + attr + "]"), function (b) { out.push({ a: attr, v: b.getAttribute(attr) }); });
    });
    return out;
  }
  function restoreTabs() {
    const saved = readJson(TAB_KEY, null);
    if (!Array.isArray(saved) || !saved.length) return;
    const s = session(); try { if (s) s.removeItem(TAB_KEY); } catch (e) { /* nothing to remove */ }
    const apply = function () {
      saved.forEach(function (t) {
        if (!t || TAB_ATTRS.indexOf(t.a) === -1 || typeof t.v !== "string") return;
        const b = Array.prototype.filter.call(document.querySelectorAll("button[" + t.a + "]"), function (x) { return x.getAttribute(t.a) === t.v; })[0];
        if (b && !b.classList.contains("active")) b.click();
      });
    };
    // the app's own tabs work once it has started; the Learning hub's once it is first shown
    window.setTimeout(apply, 400);
    window.setTimeout(apply, 1500);
  }
  // Start-up can take a few seconds (sign-in, the first backup pass), so wait for the app's own "ready" signal.
  function restoreWhenStarted() {
    let done = false;
    const go = function () { if (!done) { done = true; restoreTabs(); } };
    document.addEventListener("jarvis-ready-to-start", go, { once: true });
  }

  /* ---- deciding and doing ---- */

  function evaluate() {
    window.clearTimeout(timer); timer = null;
    if (!Object.keys(pending).length) { hidePill(); return; }
    if (dismissed) { hidePill(); return; }       // "Not now": left alone until you leave and come back, or newer news arrives
    const act = decide(context());
    if (act === "reload") { reload(); return; }
    if (act === "ask") showPill(); else hidePill();
    if (act !== "wait") timer = window.setTimeout(evaluate, RECHECK_MS);
  }

  function reload() {
    const h = handledRevs();
    Object.keys(pending).forEach(function (k) { h[k] = exactKeys[k] ? pending[k] : Math.max(Number(h[k]) || 0, pending[k] || 0); });
    writeJson(HANDLED_KEY, h);
    writeJson(REFRESHED_KEY, Date.now());
    writeJson(TAB_KEY, captureTabs());
    pending = {}; exactKeys = {};
    window.location.reload();
  }

  // news: [{ key, rev, exact? }] (or a bare key). Called by the cloud backup and the original sync. `rev` is a revision number that only
  // goes up; with `exact` it is a fingerprint of the content, and news is skipped only if that very one was already refreshed for.
  function notify(news) {
    if (!hasDom) return;
    const handled = handledRevs();
    (Array.isArray(news) ? news : []).forEach(function (n) {
      const key = typeof n === "string" ? n : n && n.key, rev = typeof n === "string" ? 0 : Number(n && n.rev) || 0, exact = !!(n && n.exact);
      if (!key) return;
      if (exact ? (rev && rev === Number(handled[key])) : (rev && rev <= (Number(handled[key]) || 0))) return;      // already refreshed for this one
      pending[key] = exact ? rev : Math.max(pending[key] || 0, rev);
      if (exact) exactKeys[key] = true;
    });
    if (!Object.keys(pending).length) return;
    dismissed = false;
    evaluate();
  }

  function wire() {
    const touch = function () { lastTouch = Date.now(); touchedSinceReturn = true; };
    ["pointerdown", "keydown", "touchstart", "wheel"].forEach(function (t) { document.addEventListener(t, touch, { passive: true, capture: true }); });
    window.addEventListener("scroll", touch, { passive: true, capture: true });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { returnedAt = Date.now(); touchedSinceReturn = false; lastTouch = Date.now(); dismissed = false; }
      evaluate();
    });
  }
  if (hasDom) {
    restoreWhenStarted();          // registered as the script runs, so the app's start signal can never be missed
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
  }

  return {
    IDLE_MS: IDLE_MS, RETURN_MS: RETURN_MS, LOOP_GUARD_MS: LOOP_GUARD_MS,
    HANDLED_KEY: HANDLED_KEY, REFRESHED_KEY: REFRESHED_KEY, TAB_KEY: TAB_KEY,
    decide: decide, notify: notify, since: since,
    // for tests
    _pending: function () { return Object.assign({}, pending); },
    // pretend `ms` milliseconds have passed since the last touch, the last return and the last refresh (no real waiting, no fake clock)
    _age: function (ms) {
      lastTouch -= ms; if (returnedAt) returnedAt -= ms;
      const last = Number(readJson(REFRESHED_KEY, 0)) || 0; if (last) writeJson(REFRESHED_KEY, last - ms);
      evaluate();
    }
  };
});
