/* ==========================================================================
   JARVIS — Habits › Reminders

   Create, edit, delete, turn on and off your reminders (blue-light glasses,
   medication, protein shake, creatine, water, workouts, reading, business
   tasks, anything custom), choose a time zone and quiet hours.

   Where the data lives: on your JARVIS server (Firebase), reached through the
   `reminders` function, because the server is what will send the
   notifications. This page only keeps a read-only copy on the device
   (localStorage key jarvisRemindersCache, not synced) so the list still shows
   when you're offline. Changes need a connection; nothing is queued silently.

   Notifications are sent by the server (see the Phone notifications card).
   What you do about a reminder (done, skip, snooze, undo) goes through the
   same function, and the page works out today's progress from the server's
   records with functions/lib/reminder-events.js, the same file the
   server uses. Nothing here ever marks anything done for you: only your tap
   does, medication included.
   ========================================================================== */

(function () {
  "use strict";

  const CACHE_KEY = "jarvisRemindersCache";
  const spec = window.JarvisReminderSpec || null;
  const ev = window.JarvisReminderEvents || null;
  const state = {
    ready: false, loading: false, loaded: false, error: "", fromCache: false, cachedAt: null,
    reminders: [], settings: null, max: 100, busy: {},
    editingId: null, form: null, openerId: null,
    events: [], eventsLoaded: false, eventsError: "", eventsAt: 0, eventsBusy: false,
    hist: null, histBusy: false, act: null, actBusy: false, pendingOpen: null, loadedDay: ""
  };
  let tickTimer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function cloud() { return window.JarvisCloud || null; }
  function signedIn() { const c = cloud(); return !!(c && c.isSignedIn()); }
  function core() { return window.JarvisCore; }

  /* ---------------- time formatting ---------------- */

  function deviceZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
  }

  function fmt(iso, zone, options) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: zone || undefined }, options)).format(d);
    } catch (e) {
      return new Intl.DateTimeFormat("en-US", options).format(d);
    }
  }
  function timeText(iso, zone) { return fmt(iso, zone, { hour: "numeric", minute: "2-digit" }); }
  function dayText(iso, zone) { return fmt(iso, zone, { weekday: "short", month: "short", day: "numeric" }); }
  function zoneName(iso, zone) {
    const parts = fmt(iso || new Date().toISOString(), zone, { timeZoneName: "short" });
    return (parts.match(/[A-Z]{2,5}(?:[+-]\d+)?$|GMT[+-]\d+(?::\d+)?$/) || [""])[0];
  }

  // "in 5 min", "in 2 h 10 min", otherwise the day.
  function relative(iso, zone) {
    const ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms)) return "";
    if (ms < 60000) return "now";
    const min = Math.round(ms / 60000);
    if (min < 60) return "in " + min + " min";
    if (min < 24 * 60) return "in " + Math.floor(min / 60) + " h" + (min % 60 ? " " + (min % 60) + " min" : "");
    return dayText(iso, zone);
  }

  /* ---------------- phone notifications ---------------- */

  const CHECK_KEY = "jarvisPushCheck";
  const push = { cfg: null, subscribed: false, serverKnows: false, busy: false, loaded: false, error: "", scheduledAt: null };

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }
  function canPush() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function permission() { return "Notification" in window ? Notification.permission : "denied"; }

  function readCheck() {
    try { const c = JSON.parse(localStorage.getItem(CHECK_KEY) || "null"); return c && (c.result === "arrived" || c.result === "missing") ? c : null; } catch (e) { return null; }
  }
  function writeCheck(result) {
    try { localStorage.setItem(CHECK_KEY, JSON.stringify({ result: result, at: new Date().toISOString() })); } catch (e) { /* ignore */ }
  }

  function urlBase64ToUint8Array(base64) {
    const padded = (base64 + "=".repeat((4 - base64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function sameKey(buffer, bytes) {
    if (!buffer) return false;
    const a = new Uint8Array(buffer);
    if (a.length !== bytes.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }

  // True only when the browser shows which key a subscription was made with and it isn't ours.
  // If the browser doesn't show it, the subscription is given the benefit of the doubt.
  function keyMismatch(sub, key) {
    const buffer = sub && sub.options ? sub.options.applicationServerKey : null;
    return !!buffer && !sameKey(buffer, key);
  }

  function callN(data) {
    const c = cloud();
    if (!c) return Promise.reject(Object.assign(new Error("Sign in to JARVIS to use notifications."), { code: "functions/unauthenticated" }));
    return c.call("notifications", data, { timeout: 25000 });
  }

  // Which of the screens the card shows. Only says "on" when this phone is really subscribed and your server knows it.
  function pushMode() {
    if (!signedIn()) return "signed-out";
    if (isIos() && !isStandalone()) return "needs-home-screen";
    if (!canPush()) return "unsupported";
    if (permission() === "denied") return "denied";
    if (push.cfg && push.cfg.keysReady === false) return "keys-missing";
    if (push.subscribed && push.serverKnows) return "on";
    return "off";
  }

  function pushError(err) {
    if (err && err.name === "NotAllowedError") return "Notifications weren't allowed. If you tapped Don't Allow, change it in the iPhone's Settings app.";
    if (err && err.name === "AbortError") return "The phone's push service didn't answer. Check you're online and try again.";
    if (err && err.name === "InvalidStateError") return "JARVIS isn't ready to receive notifications yet. Close it, open it from the Home Screen icon, and try again.";
    return describeError(err);
  }

  // Looks at this phone and your server and updates the card. Heals a missing server record without asking.
  function refreshPush() {
    push.error = "";
    if (!signedIn() || !canPush() || (isIos() && !isStandalone())) { push.loaded = true; renderPush(); return Promise.resolve(); }
    let sub = null;
    const swReady = permission() === "granted" ? navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }) : Promise.resolve(null);
    return swReady.then(function (s) {
      sub = s;
      return callN({ action: "config", endpoint: sub ? sub.endpoint : "" });
    }).then(function (cfg) {
      if (!cfg || cfg.ok !== true) throw new Error("The server answered, but not in the format JARVIS expects.");
      push.cfg = cfg;
      if (sub && cfg.publicKey && keyMismatch(sub, urlBase64ToUint8Array(cfg.publicKey))) sub = null;
      push.subscribed = !!sub;
      push.serverKnows = !!(sub && cfg.thisDevice);
      if (sub && !cfg.thisDevice && cfg.keysReady) {
        // The phone has a subscription the server lost (or never got): register it again quietly.
        return callN({ action: "subscribe", subscription: sub.toJSON() }).then(function () { push.serverKnows = true; return callN({ action: "config", endpoint: sub.endpoint }); }).then(function (c2) { push.cfg = c2; });
      }
      return null;
    }).catch(function (err) {
      push.error = pushError(err);
    }).then(function () {
      push.loaded = true;
      renderPush();
    });
  }

  function setPushStatus(text) { $("rmNotifStatus").textContent = text || ""; }

  const HOME_SCREEN_STEPS = [
    "Open JARVIS in Safari (https://ccrane1109-droid.github.io/Jarvis/).",
    "Tap the Share button, then Add to Home Screen.",
    "Turn on Open as Web App, then tap Add.",
    "Close Safari and open JARVIS from the new icon on your Home Screen, then come back to this tab."
  ];

  function renderPush() {
    const mode = pushMode();
    const badge = $("rmNotifBadge");
    const text = $("rmNotifText");
    const steps = $("rmNotifSteps");
    const show = function (id, on) { $(id).classList.toggle("hidden", !on); };
    const set = function (cls, icon, label) {
      badge.className = "nr-status-badge nr-status-" + cls;
      badge.textContent = "";
      badge.appendChild(el("span", "nr-status-icon", icon)).setAttribute("aria-hidden", "true");
      badge.appendChild(document.createTextNode(" " + label));
    };
    steps.textContent = "";
    show("rmNotifSteps", false);
    ["rmNotifOnBtn", "rmNotifTestNowBtn", "rmNotifTestLaterBtn", "rmNotifOffBtn"].forEach(function (id) { show(id, false); $(id).disabled = push.busy; });
    show("rmNotifCheck", false);
    $("rmNotifDevices").textContent = "";
    const check = readCheck();

    if (mode === "signed-out") {
      set("off", "⊘", "Signed out");
      text.textContent = "Sign in to JARVIS to turn on notifications.";
    } else if (mode === "needs-home-screen") {
      set("off", "⊘", "Needs the Home Screen");
      text.textContent = "iPhone only allows notifications for web apps that were added to the Home Screen. It won't work from a Safari tab.";
      HOME_SCREEN_STEPS.forEach(function (t) { steps.appendChild(el("li", "", t)); });
      show("rmNotifSteps", true);
    } else if (mode === "unsupported") {
      set("off", "⊘", "Not supported here");
      text.textContent = "This browser can't receive notifications from JARVIS. Use JARVIS from the Home Screen on your iPhone.";
    } else if (mode === "denied") {
      set("bad", "✕", "Blocked");
      text.textContent = "Notifications are blocked for JARVIS on this phone. In the iPhone's Settings app, find JARVIS under Notifications and allow them, then come back.";
    } else if (mode === "keys-missing") {
      set("off", "⊘", "Server setup needed");
      text.textContent = "Your JARVIS server doesn't have its notification keys yet. That's a one-time setup step in Cloud Shell (it's written in functions/README.md).";
    } else if (mode === "on") {
      set("ok", "✓", "On for this phone");
      const d = push.cfg && push.cfg.devices ? push.cfg.devices : [];
      const via = d.length ? d.map(function (x) { return x.platform; }).filter(function (p, i, all) { return all.indexOf(p) === i; }).join(" and ") + "'s notification service" : "the phone maker's notification service";
      text.textContent = "This phone is registered. Your server sends reminders to it through " + via + "." +
        (check && check.result === "arrived" ? "" : " Whether they reach a locked phone with JARVIS closed hasn't been proven yet. Use “Test in 90 seconds”, close JARVIS and lock the phone to find out.");
      show("rmNotifTestNowBtn", true);
      show("rmNotifTestLaterBtn", true);
      show("rmNotifOffBtn", true);
      show("rmNotifCheck", !!push.scheduledAt || !check);
      if (check) {
        $("rmNotifCheckLabel").textContent = "You reported on " + core().formatDateTime(check.at) + " that a closed-app test " + (check.result === "arrived" ? "arrived." : "did not arrive.") + " Run the test again to update that.";
      } else {
        $("rmNotifCheckLabel").textContent = "Run “Test in 90 seconds”, close JARVIS and lock your phone, then tell JARVIS what happened:";
      }
      show("rmNotifCheck", !!push.scheduledAt || !!check);
      const lines = d.map(function (x) { return x.platform + (x.lastSuccessAt ? ": last accepted by the push service " + core().formatDateTime(x.lastSuccessAt) : ": nothing sent yet") + (x.lastError ? " (last problem: " + x.lastError + ")" : ""); });
      $("rmNotifDevices").textContent = lines.join(" · ");
    } else {
      set("off", "⊘", "Not on yet");
      text.textContent = "Turn this on once on this phone. iPhone will ask you to allow notifications.";
      show("rmNotifOnBtn", true);
    }
    if (push.error) setPushStatus(push.error);
    renderHero();
  }

  function turnOn() {
    if (push.busy) return;
    push.busy = true;
    push.error = "";
    setPushStatus("Asking for permission…");
    renderPush();
    let cfg = null;
    // The permission question has to be asked straight from the tap, before anything is awaited.
    const asked = Notification.requestPermission();
    Promise.resolve(asked).then(function (perm) {
      if (perm !== "granted") throw Object.assign(new Error("not allowed"), { name: "NotAllowedError" });
      setPushStatus("Setting up this phone…");
      return callN({ action: "config" });
    }).then(function (c) {
      cfg = c;
      if (!c || !c.keysReady || !c.publicKey) throw new Error("Your JARVIS server doesn't have its notification keys yet.");
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      const key = urlBase64ToUint8Array(cfg.publicKey);
      return reg.pushManager.getSubscription().then(function (existing) {
        // A subscription made with different keys can't be used; replace it.
        if (existing && keyMismatch(existing, key)) {
          return existing.unsubscribe().then(function () { return null; });
        }
        return existing;
      }).then(function (existing) {
        return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      });
    }).then(function (sub) {
      return callN({ action: "subscribe", subscription: sub.toJSON() });
    }).then(function () {
      setPushStatus("Turned on. Press “Send a test now” to check it.");
    }).catch(function (err) {
      push.error = pushError(err);
      setPushStatus(push.error);
    }).then(function () {
      push.busy = false;
      return refreshPush();
    });
  }

  function turnOff() {
    if (push.busy) return;
    push.busy = true;
    setPushStatus("Turning off…");
    renderPush();
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return null;
      const endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () { return callN({ action: "unsubscribe", endpoint: endpoint }); });
    }).then(function () {
      push.scheduledAt = null;
      setPushStatus("Turned off for this phone.");
    }).catch(function (err) {
      setPushStatus(pushError(err));
    }).then(function () {
      push.busy = false;
      return refreshPush();
    });
  }

  // What a "test now" answer means, in words. Accepted means the push service took it from the server; it does not mean it appeared.
  function testResultText(res) {
    if (res.accepted > 0) {
      return "Sent. The push service accepted it for " + res.accepted + " of " + res.devices + (res.devices === 1 ? " phone" : " phones") + ". Did a notification appear on your phone? If not, check the iPhone's Settings → Notifications → JARVIS and Focus mode.";
    }
    if (res.gone) return "The push service says this phone isn't registered any more. Turn notifications off and on again.";
    return "The push service didn't accept it" + (res.errors && res.errors[0] ? ": " + res.errors[0] : ".") + (res.retryable ? " This may be temporary. Try again in a minute." : "");
  }

  function testNow() {
    if (push.busy) return;
    push.busy = true;
    setPushStatus("Sending…");
    renderPush();
    callN({ action: "test", delaySeconds: 0 }).then(function (res) {
      setPushStatus(testResultText(res));
    }).catch(function (err) {
      setPushStatus(describeError(err));
    }).then(function () {
      push.busy = false;
      return refreshPush();
    });
  }

  function testLater() {
    if (push.busy) return;
    push.busy = true;
    setPushStatus("Scheduling…");
    renderPush();
    callN({ action: "test", delaySeconds: 90 }).then(function (res) {
      push.scheduledAt = res.dueAt;
      setPushStatus("Scheduled. It should arrive within about 2 minutes. Close JARVIS and lock your phone now, then tell JARVIS what happened when you open it again.");
    }).catch(function (err) {
      setPushStatus(describeError(err));
    }).then(function () {
      push.busy = false;
      renderPush();
    });
  }

  function reportCheck(result) {
    writeCheck(result);
    push.scheduledAt = null;
    setPushStatus(result === "arrived" ? "Thanks. That's recorded on this phone." : "Recorded. A missing notification is useful to know: check the iPhone's Settings → Notifications → JARVIS, Focus modes, and Low Power Mode, then try again.");
    renderPush();
  }

  function pushChip() {
    const m = pushMode();
    if (m === "on") return stripChip("ok", "✓", "Phone notifications: on");
    if (m === "denied") return stripChip("bad", "✕", "Phone notifications: blocked");
    if (m === "needs-home-screen") return stripChip("off", "⊘", "Phone notifications: needs Home Screen");
    return stripChip("off", "⊘", "Phone notifications: not on yet");
  }

  /* ---------------- talking to the server ---------------- */

  function call(data) {
    const c = cloud();
    if (!c) return Promise.reject(Object.assign(new Error("Sign in to JARVIS to use reminders."), { code: "functions/unauthenticated" }));
    return c.call("reminders", data, { timeout: 25000 });
  }

  function describeError(err) {
    const code = (err && err.code) || "";
    const message = (err && err.message) || "";
    if (code === "functions/unauthenticated") return "Sign in to JARVIS to use reminders.";
    if (code === "functions/permission-denied") return "This account isn't allowed to use reminders.";
    if (code === "functions/not-found" && /reminder/i.test(message)) return message;
    if (code === "functions/not-found") return "The reminders server isn't deployed yet. It has to be redeployed from Cloud Shell.";
    if (code === "functions/internal") {
      const ref = err.details && err.details.ref;
      if (ref) return "The server hit an unexpected error (reference " + ref + "). Find that reference in Firebase console → Functions → Logs.";
      return "Couldn't get a response from the reminders server. Usually it hasn't been redeployed yet, or the last deploy failed.";
    }
    if (code === "functions/invalid-argument" && /Unknown reminders action/i.test(message)) return "The server needs its latest update (redeploy from Cloud Shell) before this works.";
    if (code === "functions/failed-precondition" || code === "functions/resource-exhausted" || code === "functions/invalid-argument") return message;
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") return "Couldn't reach the server. Check your connection and try again.";
    return "Something went wrong" + (message ? ": " + message : ".");
  }

  /* ---------------- data ---------------- */

  const isoOrNull = function (v) { return typeof v === "string" && !isNaN(Date.parse(v)) ? v : null; };
  const isoList = function (v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && !isNaN(Date.parse(x)); }) : []; };

  // Keeps only what the page uses, re-checked with the same rules the server applies.
  function cleanReminder(r) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !spec.ID_RE.test(r.id)) return null;
    const s = spec.sanitizeReminder(r);
    if (!s.ok) return null;
    return Object.assign({}, s.value, {
      id: r.id, timezone: s.value.timezone || spec.DEFAULT_TIMEZONE,
      nextFireAt: isoOrNull(r.nextFireAt), today: isoList(r.today), upcoming: isoList(r.upcoming),
      createdAt: isoOrNull(r.createdAt), updatedAt: isoOrNull(r.updatedAt)
    });
  }

  function applyList(res) {
    state.reminders = res.reminders.map(cleanReminder).filter(Boolean);
    state.settings = spec.sanitizeSettings(res.settings);
    state.max = typeof res.max === "number" ? res.max : spec.MAX_REMINDERS;
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), reminders: state.reminders, settings: state.settings }));
    } catch (e) { /* the copy is a convenience */ }
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!c || !Array.isArray(c.reminders)) return;
      state.reminders = c.reminders.map(cleanReminder).filter(Boolean);
      state.settings = c.settings ? spec.sanitizeSettings(c.settings) : null;
      state.cachedAt = isoOrNull(c.savedAt);
      state.fromCache = state.reminders.length > 0 || !!state.settings;
    } catch (e) { /* ignore a damaged copy */ }
  }

  function load() {
    if (!spec) return Promise.resolve();
    if (!signedIn()) { state.error = "Sign in to JARVIS to use reminders."; render(); return Promise.resolve(); }
    if (state.loading) return Promise.resolve();
    state.loading = true;
    render();
    return call({ action: "list" }).then(function (res) {
      if (!res || res.ok !== true || !Array.isArray(res.reminders)) throw Object.assign(new Error("The server answered, but not in the format JARVIS expects."), { code: "bad-shape" });
      applyList(res);
      state.error = "";
      state.fromCache = false;
      saveCache();
    }).catch(function (err) {
      state.error = err && err.code === "bad-shape" ? err.message : describeError(err);
    }).then(function () {
      state.loading = false;
      state.loaded = true;
      state.loadedDay = core().todayISODate();
      render();
      return state.error ? null : loadEvents();
    });
  }

  /* ---------------- what happened: the records ---------------- */

  const STATUSES = ["queued", "sent", "missed", "failed", "no-device", "cancelled"];

  // Keeps only what the page uses, and checks the shape before anything is drawn from it.
  function cleanEvent(e) {
    if (!ev || !e || typeof e !== "object" || typeof e.id !== "string") return null;
    const test = e.kind === "test";
    if (test ? !/^test_[a-z0-9]+$/.test(e.id) : !ev.ID_RE.test(e.id)) return null;
    const scheduledFor = isoOrNull(e.scheduledFor);
    if (!scheduledFor) return null;
    return {
      id: e.id, kind: test ? "test" : "reminder", reminderId: typeof e.reminderId === "string" ? e.reminderId : null,
      category: typeof e.category === "string" ? e.category : "custom", title: typeof e.title === "string" ? e.title.slice(0, 80) : "",
      timezone: typeof e.timezone === "string" ? e.timezone : null, scheduledFor: scheduledFor,
      status: STATUSES.indexOf(e.status) !== -1 ? e.status : "queued", outcome: e.outcome === "done" || e.outcome === "skipped" ? e.outcome : null,
      outcomeAt: isoOrNull(e.outcomeAt), snoozedUntil: isoOrNull(e.snoozedUntil), snoozeCount: Number(e.snoozeCount) > 0 ? Math.floor(Number(e.snoozeCount)) : 0,
      sentAt: isoOrNull(e.sentAt), lastError: typeof e.lastError === "string" ? e.lastError.slice(0, 200) : null
    };
  }

  function badShape() { return Object.assign(new Error("The server answered, but not in the format JARVIS expects."), { code: "bad-shape" }); }
  function errText(err) { return err && err.code === "bad-shape" ? err.message : describeError(err); }

  // The last two days of records: enough to know how today is going, whatever time zone a reminder is in.
  function loadEvents() {
    if (!signedIn() || !ev || state.eventsBusy) return Promise.resolve();
    state.eventsBusy = true;
    return call({ action: "events", days: 2 }).then(function (res) {
      if (!res || res.ok !== true || !Array.isArray(res.events)) throw badShape();
      state.events = res.events.map(cleanEvent).filter(Boolean);
      state.eventsLoaded = true;
      state.eventsError = "";
      state.eventsAt = Date.now();
    }).catch(function (err) {
      state.eventsError = errText(err);
    }).then(function () {
      state.eventsBusy = false;
      renderToday();
    });
  }

  // Puts one changed record (or its removal) into everything the page holds.
  function applyEvent(id, fresh) {
    [state.events, state.hist && state.hist.events].forEach(function (list) {
      if (!list) return;
      const i = list.findIndex(function (x) { return x.id === id; });
      if (i !== -1) list.splice(i, 1);
      if (fresh) list.push(fresh);
    });
    state.events.sort(function (a, b) { return a.scheduledFor < b.scheduledFor ? 1 : -1; });
    if (state.hist) state.hist.events.sort(function (a, b) { return a.scheduledFor < b.scheduledFor ? 1 : -1; });
  }

  function replaceReminder(r) {
    const c = cleanReminder(r);
    if (!c) return;
    const i = state.reminders.findIndex(function (x) { return x.id === c.id; });
    if (i === -1) state.reminders.push(c); else state.reminders[i] = c;
    state.fromCache = false;
    saveCache();
  }

  /* ---------------- rendering ---------------- */

  function sortedReminders() {
    return state.reminders.slice().sort(function (a, b) {
      if (!!a.nextFireAt !== !!b.nextFireAt) return a.nextFireAt ? -1 : 1;
      if (a.nextFireAt !== b.nextFireAt) return a.nextFireAt < b.nextFireAt ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }

  function iconOf(r) { const c = spec.categoryOf(r.category); return c ? c.icon : "🔔"; }

  function setStatus(text) { $("rmStatus").textContent = text || ""; }

  function stripChip(cls, icon, text) {
    const li = el("li", "nr-strip-item nr-status-" + cls);
    li.appendChild(el("span", "nr-status-icon", icon)).setAttribute("aria-hidden", "true");
    li.appendChild(document.createTextNode(" " + text));
    return li;
  }

  function renderHero() {
    const active = state.reminders.filter(function (r) { return r.enabled; });
    const next = sortedReminders().filter(function (r) { return r.enabled && r.nextFireAt; })[0];
    let sub;
    if (!signedIn()) sub = "Sign in to JARVIS to set up reminders.";
    else if (!state.reminders.length) sub = state.loading ? "Loading your reminders…" : "No reminders yet. Add your first one to get started.";
    else {
      sub = active.length + " turned on of " + state.reminders.length;
      if (next) sub += " · next: " + next.title + " at " + timeText(next.nextFireAt, next.timezone) + ", " + relative(next.nextFireAt, next.timezone);
    }
    $("rmHeroSub").textContent = sub;
    $("rmNewBtn").disabled = !signedIn() || state.reminders.length >= state.max;

    const strip = $("rmStrip");
    strip.textContent = "";
    if (!signedIn()) strip.appendChild(stripChip("off", "⊘", "Signed out"));
    else if (state.loading && !state.loaded) strip.appendChild(stripChip("info", "…", "Checking server"));
    else if (state.error) strip.appendChild(stripChip("bad", "✕", state.fromCache ? "Showing saved copy" : "Server problem"));
    else strip.appendChild(stripChip("ok", "✓", "Saved on your server"));
    strip.appendChild(pushChip());
    if (state.settings) strip.appendChild(stripChip("info", "◷", state.settings.timezone.replace(/_/g, " ")));
  }

  /* ---------------- today: progress and what's still open ---------------- */

  function stateLabel(it) {
    switch (it.state) {
      case "done": return "Done" + (it.outcomeAt ? " at " + timeText(it.outcomeAt, it.timezone) : "");
      case "skipped": return "Skipped";
      case "snoozed": return "Snoozed until " + timeText(it.snoozedUntil, it.timezone);
      case "awaiting": return "Sent. Waiting for you";
      case "sending": return "Sending…";
      case "missed": return "Missed: over 30 minutes late, so it wasn't sent";
      case "failed": return "Couldn't be sent";
      case "no-device": return "No phone was set up for notifications";
      case "cancelled": return "Not sent";
      case "due": return "Due now";
      default: return "Coming up";
    }
  }

  function whenText(it) {
    return timeText(it.scheduledFor, it.timezone) + (it.timezone !== deviceZone() ? " " + zoneName(it.scheduledFor, it.timezone) : "");
  }

  function progressText(c) {
    const parts = [c.done + " of " + c.total + " done"];
    if (c.skipped) parts.push(c.skipped + " skipped");
    if (c.open) parts.push(c.open + " still open");
    if (c.snoozed) parts.push(c.snoozed + " snoozed");
    if (c.upcoming) parts.push(c.upcoming + " coming up");
    return parts.join(" · ");
  }

  function renderProgress(view) {
    const box = $("rmProgress");
    const c = view.counts;
    box.classList.toggle("hidden", !c.total);
    const open = $("rmOpen");
    open.textContent = "";
    open.classList.toggle("hidden", !view.open.length);
    if (!c.total) return;
    const pct = view.percent === null ? 0 : view.percent;
    $("rmProgressFill").style.width = pct + "%";
    $("rmProgressText").textContent = progressText(c) + (view.percent === null ? "" : " (" + view.percent + "%)");
    const bar = $("rmProgressBar");
    bar.setAttribute("aria-valuenow", String(pct));
    bar.classList.toggle("done", c.total > 0 && c.done + c.skipped === c.total && c.done > 0);
    if (view.open.length) {
      open.appendChild(el("p", "rm-open-title", "Still open (" + view.open.length + ")"));
      const chips = el("div", "rm-open-chips");
      view.open.forEach(function (it) {
        const b = el("button", "rm-open-chip", it.title + " · " + whenText(it));
        b.type = "button";
        b.addEventListener("click", function () { openAct(it, b); });
        chips.appendChild(b);
      });
      open.appendChild(chips);
    }
  }

  function renderToday() {
    const box = $("rmToday");
    const hint = $("rmTodayHint");
    box.textContent = "";
    // Without the server's records the plan can still be shown, but not what happened to it.
    const known = state.eventsLoaded && !!ev;
    const view = known ? ev.dayView(state.reminders, state.events, Date.now()) : null;
    if (view) renderProgress(view); else { $("rmProgress").classList.add("hidden"); $("rmOpen").classList.add("hidden"); }

    const byId = {};
    state.reminders.forEach(function (r) { byId[r.id] = r; });
    let items;
    if (view) {
      items = view.items;
    } else {
      items = [];
      state.reminders.forEach(function (r) {
        if (!r.enabled) return;
        r.today.forEach(function (iso) { items.push({ reminderId: r.id, eventId: null, title: r.title, category: r.category, timezone: r.timezone, scheduledFor: iso, state: new Date(iso).getTime() <= Date.now() ? "past" : "upcoming", hasEvent: false }); });
      });
      items.sort(function (a, b) { return a.scheduledFor < b.scheduledFor ? -1 : a.scheduledFor > b.scheduledFor ? 1 : 0; });
    }
    if (!items.length) {
      hint.textContent = "";
      box.appendChild(el("p", "nr-empty", state.reminders.length
        ? "Nothing is scheduled for the rest of today."
        : "Your reminders for today will show here."));
      return;
    }
    hint.textContent = view
      ? "Tap a reminder to mark it done, skip it or snooze it. You can mark one done before its time, too."
      : (state.eventsError ? state.eventsError + " " : "") + "What is scheduled for today. Marking reminders done, skipping and snoozing need the server's records, which couldn't be read just now.";
    items.forEach(function (it) {
      const r = byId[it.reminderId] || {};
      const row = el("div", "rm-today-row rm-s-" + it.state);
      const main = el(view ? "button" : "div", "rm-today-main");
      if (view) {
        main.type = "button";
        main.setAttribute("aria-label", it.title + ", " + whenText(it) + ", " + stateLabel(it) + ". Open options.");
        main.addEventListener("click", function () { openAct(it, main); });
      }
      main.appendChild(el("span", "rm-icon", iconOf(it))).setAttribute("aria-hidden", "true");
      const text = el("div", "rm-today-text");
      text.appendChild(el("p", "rm-title", it.title));
      text.appendChild(el("p", "rm-sub rm-state", view ? stateLabel(it) : (it.state === "past" ? "Earlier today" : "Coming up") + (r.notes ? " · " + r.notes : "")));
      main.appendChild(text);
      row.appendChild(main);
      row.appendChild(el("span", "rm-when", whenText(it)));
      if (view && (ev.OPEN_STATES.indexOf(it.state) !== -1 || it.state === "snoozed")) {
        const done = el("button", "nr-btn nr-btn-ghost nr-btn-small rm-quick-done", "Done");
        done.type = "button";
        done.setAttribute("aria-label", "Mark " + it.title + " at " + whenText(it) + " as done");
        done.disabled = state.actBusy;
        done.addEventListener("click", function () { quickDone(it); });
        row.appendChild(done);
      }
      box.appendChild(row);
    });
  }

  /* ---------------- answering a reminder: done, skip, snooze, undo ---------------- */

  function itemFromEvent(e) {
    return {
      reminderId: e.reminderId, eventId: e.id, title: e.title || "Reminder", category: e.category, hasEvent: true,
      timezone: e.timezone || (state.settings && state.settings.timezone) || deviceZone() || spec.DEFAULT_TIMEZONE,
      scheduledFor: e.scheduledFor, state: ev.stateOf(e, Date.now()), snoozedUntil: e.snoozedUntil, outcomeAt: e.outcomeAt, snoozeCount: e.snoozeCount
    };
  }

  // One request for any answer. A moment with no record yet is named by reminder + moment; otherwise by its record.
  function answer(item, choice, minutes) {
    const body = { action: "act", choice: choice };
    if (minutes) body.minutes = minutes;
    if (item.hasEvent) body.eventId = item.eventId;
    else { body.reminderId = item.reminderId; body.scheduledFor = item.scheduledFor; }
    return call(body).then(function (res) {
      if (!res || res.ok !== true || (!res.event && res.removed !== true)) throw badShape();
      applyEvent(item.eventId, res.event ? cleanEvent(res.event) : null);
      return res;
    });
  }

  const SNOOZE_LABELS = { 5: "5 min", 10: "10 min", 15: "15 min", 30: "30 min", 60: "1 hour" };
  const ACT_TOAST = { done: "Marked done.", skip: "Skipped.", undo: "Undone." };

  // Done in one tap from the list; the sheet has the rest (and Undo).
  function quickDone(it) {
    if (state.actBusy) return;
    state.actBusy = true;
    setStatus("");
    renderToday();
    answer(it, "done").then(function () {
      core().showToast("Marked done. Tap it to undo.");
    }).catch(function (err) {
      setStatus(errText(err));
    }).then(function () {
      state.actBusy = false;
      renderToday();
      renderHistory();
    });
  }

  function openAct(item, opener) {
    if (!ev || !signedIn()) return;
    state.act = { item: item, opener: opener || null };
    state.actBusy = false;
    $("rmActError").textContent = "";
    renderAct();
    core().openModal("rmActModal");
    const first = [$("rmActDone"), $("rmActUndo")].filter(function (b) { return !b.classList.contains("hidden"); })[0];
    if (first) first.focus();
  }

  function closeAct() {
    core().closeModal("rmActModal");
    const opener = state.act && state.act.opener;
    state.act = null;
    if (opener && opener.isConnected && opener.focus) opener.focus();
  }

  function renderAct() {
    if (!state.act) return;
    const it = state.act.item;
    const cat = spec.categoryOf(it.category);
    const answered = it.state === "done" || it.state === "skipped";
    const upcoming = it.state === "upcoming";
    $("rmActTitle").textContent = (cat ? cat.icon + " " : "") + it.title;
    $("rmActWhen").textContent = dayText(it.scheduledFor, it.timezone) + " at " + whenText(it);
    $("rmActState").textContent = stateLabel(it) + (it.snoozeCount ? " · snoozed " + it.snoozeCount + (it.snoozeCount === 1 ? " time" : " times") : "");
    $("rmActMed").classList.toggle("hidden", it.category !== "medication" || answered);
    $("rmActMain").classList.toggle("hidden", answered);
    $("rmActDone").textContent = upcoming ? "Done already" : "Done";
    $("rmActSkip").textContent = upcoming ? "Skip this one" : "Skip";
    const canSnooze = !answered && !upcoming && it.hasEvent && it.snoozeCount < ev.MAX_SNOOZES;
    $("rmActSnoozeWrap").classList.toggle("hidden", !canSnooze);
    const chips = $("rmActSnooze");
    chips.textContent = "";
    ev.SNOOZE_MINUTES.forEach(function (m) {
      const b = el("button", "rm-chip", SNOOZE_LABELS[m] || m + " min");
      b.type = "button";
      b.disabled = state.actBusy;
      b.addEventListener("click", function () { doAct("snooze", m); });
      chips.appendChild(b);
    });
    $("rmActUndo").classList.toggle("hidden", !answered);
    ["rmActDone", "rmActSkip", "rmActUndo", "rmActCloseBtn"].forEach(function (id) { $(id).disabled = state.actBusy; });
  }

  function doAct(choice, minutes) {
    if (!state.act || state.actBusy) return;
    state.actBusy = true;
    $("rmActError").textContent = "";
    renderAct();
    const item = state.act.item;
    answer(item, choice, minutes).then(function (res) {
      core().showToast(choice === "snooze" ? "Snoozed for " + (SNOOZE_LABELS[minutes] || minutes + " min") + ". It will be sent again." : ACT_TOAST[choice]);
      const fresh = res.event ? cleanEvent(res.event) : null;
      if (choice === "undo" && fresh) state.act.item = itemFromEvent(fresh);
      else closeAct();
    }).catch(function (err) {
      $("rmActError").textContent = errText(err);
    }).then(function () {
      state.actBusy = false;
      if (state.act) renderAct();
      renderToday();
      renderHistory();
    });
  }

  /* ---------------- tapping a notification ---------------- */

  // A tapped notification opens the reminders and, when JARVIS can tell which one, its options.
  function openFromNotification(id) {
    const nav = $("navBtnHabits");
    if (nav) nav.click();
    const tab = $("habitsSubNavReminders");
    if (tab) tab.click();
    if (typeof id === "string" && id) {
      state.pendingOpen = { id: id, tries: 0 };
      tryPendingOpen();
    }
  }

  // Sign-in is restored a moment after the page opens, so wait for it (up to about ten seconds).
  function tryPendingOpen() {
    const p = state.pendingOpen;
    if (!p || !ev || !spec) return;
    if (/^test_/.test(p.id)) { state.pendingOpen = null; core().showToast("That was a test notification."); return; }
    if (!ev.ID_RE.test(p.id)) { state.pendingOpen = null; return; }
    if (!signedIn()) {
      if (++p.tries < 40) setTimeout(tryPendingOpen, 250); else state.pendingOpen = null;
      return;
    }
    state.pendingOpen = null;
    if (!state.loaded || state.error) load();
    call({ action: "event", eventId: p.id }).then(function (res) {
      const c = res && res.ok === true && res.event ? cleanEvent(res.event) : null;
      if (!c) { core().showToast("That reminder isn't on record any more."); return; }
      openAct(itemFromEvent(c), null);
    }).catch(function (err) {
      setStatus(errText(err));
    });
  }

  /* ---------------- history ---------------- */

  function historyLabel(e) {
    const s = ev.stateOf(e, Date.now());
    if (e.kind === "test") return { cls: "info", text: "Test · " + (e.status === "sent" ? "sent" : e.status === "queued" ? "waiting" : e.status) };
    if (s === "done") return { cls: "ok", text: "Done" };
    if (s === "skipped") return { cls: "off", text: "Skipped" };
    if (s === "snoozed") return { cls: "info", text: "Snoozed" };
    if (s === "awaiting") return Date.now() - Date.parse(e.scheduledFor) < ev.FRESH_MS ? { cls: "info", text: "Sent" } : { cls: "warn", text: "No answer" };
    if (s === "sending") return { cls: "info", text: "Sending" };
    if (s === "missed") return { cls: "bad", text: "Missed" };
    if (s === "failed") return { cls: "bad", text: "Failed" };
    if (s === "no-device") return { cls: "bad", text: "No phone" };
    return { cls: "off", text: "Not sent" };
  }

  function summaryBar(s) {
    const bar = el("div", "rm-sum-bar");
    bar.setAttribute("aria-hidden", "true");
    [["done", s.done], ["skipped", s.skipped], ["pending", s.pending], ["open", s.open]].forEach(function (seg) {
      if (!seg[1]) return;
      const x = el("span", "rm-sum-seg " + seg[0]);
      x.style.width = (100 * seg[1] / s.total) + "%";
      bar.appendChild(x);
    });
    return bar;
  }

  function historySummaryText(s) {
    const parts = [s.done + " done"];
    if (s.skipped) parts.push(s.skipped + " skipped");
    if (s.open) parts.push(s.open + " with no answer");
    if (s.pending) parts.push(s.pending + " just sent");
    return parts.join(" · ") + (s.percent === null ? "" : " · " + s.percent + "%");
  }

  function renderHistory() {
    const box = $("rmHist");
    box.textContent = "";
    if (!state.hist || !ev) return;
    const list = state.hist.events;
    if (!list.length) { box.appendChild(el("p", "nr-empty", "Nothing has been sent in the last 14 days.")); return; }
    const sum = ev.summarize(list, Date.now());
    if (sum.reminders.length) {
      box.appendChild(el("h3", "nr-h3", "How it went"));
      const all = el("p", "rm-sum-all", "All reminders: " + historySummaryText(sum.all));
      box.appendChild(all);
      sum.reminders.forEach(function (s) {
        const row = el("div", "rm-sum-row");
        const head = el("div", "rm-sum-head");
        head.appendChild(el("span", "rm-title", s.title));
        head.appendChild(el("span", "rm-sub", historySummaryText(s)));
        row.appendChild(head);
        row.appendChild(summaryBar(s));
        box.appendChild(row);
      });
      box.appendChild(el("p", "nr-hint", "“No answer” means the reminder passed and you didn't tap Done or Skip. It doesn't mean you didn't do it."));
    }
    box.appendChild(el("h3", "nr-h3 rm-hist-h", "Every notification"));
    let lastDay = "";
    list.forEach(function (e) {
      const zone = e.timezone || (state.settings && state.settings.timezone) || deviceZone();
      const day = dayText(e.scheduledFor, zone);
      if (day !== lastDay) { box.appendChild(el("p", "rm-hist-day", day)); lastDay = day; }
      const tappable = e.kind === "reminder" && !!e.reminderId;
      const row = el(tappable ? "button" : "div", "rm-hist-row");
      if (tappable) {
        row.type = "button";
        row.setAttribute("aria-label", e.title + " at " + timeText(e.scheduledFor, zone) + ". Open options.");
        row.addEventListener("click", function () { openAct(itemFromEvent(e), row); });
      }
      row.appendChild(el("span", "rm-hist-time", timeText(e.scheduledFor, zone)));
      row.appendChild(el("span", "rm-hist-title", e.kind === "test" ? "JARVIS test" : e.title));
      const lab = historyLabel(e);
      row.appendChild(el("span", "rm-hist-chip nr-status-" + lab.cls, lab.text));
      if (e.lastError && (e.status === "failed" || e.status === "missed")) row.title = e.lastError;
      box.appendChild(row);
    });
    if (state.hist.truncated) box.appendChild(el("p", "nr-hint", "Showing the most recent " + list.length + "."));
  }

  function loadHistory() {
    if (!ev) return;
    if (!signedIn()) { $("rmHistStatus").textContent = "Sign in to JARVIS to see the history."; return; }
    if (state.histBusy) return;
    state.histBusy = true;
    $("rmHistStatus").textContent = "Loading…";
    $("rmHistBtn").disabled = true;
    call({ action: "events", days: 14 }).then(function (res) {
      if (!res || res.ok !== true || !Array.isArray(res.events)) throw badShape();
      state.hist = { events: res.events.map(cleanEvent).filter(Boolean), truncated: res.truncated === true };
      $("rmHistStatus").textContent = "";
      $("rmHistBtn").textContent = "Refresh";
    }).catch(function (err) {
      $("rmHistStatus").textContent = errText(err);
    }).then(function () {
      state.histBusy = false;
      $("rmHistBtn").disabled = false;
      renderHistory();
    });
  }

  function reminderRow(r) {
    const row = el("article", "rm-row" + (r.enabled ? "" : " off"));
    row.appendChild(el("span", "rm-icon", iconOf(r))).setAttribute("aria-hidden", "true");
    const main = el("div", "rm-main");
    main.appendChild(el("h3", "rm-title", r.title));
    main.appendChild(el("p", "rm-sub", spec.describeSchedule(r.schedule)));
    let next;
    if (!r.enabled) next = "Turned off";
    else if (r.nextFireAt) next = "Next: " + dayText(r.nextFireAt, r.timezone) + " at " + timeText(r.nextFireAt, r.timezone) + (r.timezone !== deviceZone() ? " " + zoneName(r.nextFireAt, r.timezone) : "");
    else next = r.schedule.type === "once" ? "Done: this one-time reminder has passed" : "Nothing coming up";
    main.appendChild(el("p", "rm-next", next));
    if (r.category === "medication" || r.notes) {
      const bits = [];
      if (r.category === "medication") bits.push(r.privateText ? "Lock screen: name hidden" : "Lock screen: name shown");
      if (r.notes) bits.push(r.notes);
      main.appendChild(el("p", "rm-sub", bits.join(" · ")));
    }
    row.appendChild(main);

    const actions = el("div", "rm-actions");
    const sw = el("button", "rm-switch" + (r.enabled ? " on" : ""));
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", r.enabled ? "true" : "false");
    sw.setAttribute("aria-label", (r.enabled ? "Turn off " : "Turn on ") + r.title);
    sw.disabled = !!state.busy[r.id];
    sw.appendChild(el("span", "rm-switch-knob")).setAttribute("aria-hidden", "true");
    sw.addEventListener("click", function () { toggle(r); });
    actions.appendChild(sw);
    const edit = el("button", "nr-btn nr-btn-ghost nr-btn-small", "Edit");
    edit.type = "button";
    edit.id = "rmEdit_" + r.id;
    edit.setAttribute("aria-label", "Edit " + r.title);
    edit.addEventListener("click", function () { openForm(r, null, edit.id); });
    actions.appendChild(edit);
    row.appendChild(actions);
    return row;
  }

  function renderList() {
    const box = $("rmList");
    box.textContent = "";
    if (state.error) {
      const note = el("p", "rm-error", state.error + (state.fromCache ? " Showing the last saved copy; changes need a connection." : ""));
      note.setAttribute("role", "alert");
      box.appendChild(note);
      if (signedIn()) {
        const retry = el("button", "nr-btn nr-btn-ghost nr-btn-small", "Try again");
        retry.type = "button";
        retry.addEventListener("click", load);
        box.appendChild(retry);
      }
    } else if (state.fromCache && state.cachedAt) {
      box.appendChild(el("p", "nr-hint", "Showing the copy saved on this device from " + core().formatDateTime(state.cachedAt) + "."));
    }
    const list = sortedReminders();
    if (!list.length) {
      if (!state.error) box.appendChild(el("p", "nr-empty", signedIn() ? (state.loading ? "Loading…" : "No reminders yet. Pick one below or tap New reminder.") : "Sign in to JARVIS to use reminders."));
    }
    list.forEach(function (r, i) {
      const row = reminderRow(r);
      row.style.animationDelay = Math.min(i, 8) * 30 + "ms";
      box.appendChild(row);
    });
    $("rmQuickTitle").classList.toggle("hidden", !signedIn());
    $("rmQuick").classList.toggle("hidden", !signedIn());
  }

  function renderQuick() {
    const box = $("rmQuick");
    box.textContent = "";
    spec.CATEGORIES.forEach(function (c) {
      const b = el("button", "rm-cat");
      b.type = "button";
      b.appendChild(el("span", "rm-cat-icon", c.icon)).setAttribute("aria-hidden", "true");
      b.appendChild(document.createTextNode(" " + c.label));
      b.addEventListener("click", function () { openForm(null, c.value, null); });
      box.appendChild(b);
    });
  }

  const COMMON_ZONES = [
    "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
    "America/Toronto", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"
  ];

  function fillZoneSelect(select, current) {
    const zones = COMMON_ZONES.slice();
    [current, deviceZone()].forEach(function (z) { if (z && zones.indexOf(z) === -1) zones.unshift(z); });
    select.textContent = "";
    zones.forEach(function (z) {
      const o = el("option", "", z.replace(/_/g, " ") + (z === deviceZone() ? " (this device)" : ""));
      o.value = z;
      select.appendChild(o);
    });
    select.value = current;
  }

  function renderSettings() {
    if (document.activeElement && ["rmTz", "rmQuietStart", "rmQuietEnd"].indexOf(document.activeElement.id) !== -1) return;
    const s = state.settings || spec.sanitizeSettings(null);
    fillZoneSelect($("rmTz"), s.timezone);
    $("rmQuietOn").checked = s.quiet.enabled;
    $("rmQuietStart").value = s.quiet.start;
    $("rmQuietEnd").value = s.quiet.end;
    const off = !signedIn();
    ["rmTz", "rmQuietOn", "rmQuietStart", "rmQuietEnd", "rmSettingsSaveBtn", "rmSettingsMoveBtn"].forEach(function (id) { $(id).disabled = off; });
  }

  function render() {
    if (!state.ready) return;
    renderHero();
    renderToday();
    renderList();
    renderSettings();
    renderPush();
  }

  /* ---------------- turning on and off, settings ---------------- */

  function toggle(r) {
    if (state.busy[r.id]) return;
    state.busy[r.id] = true;
    setStatus("");
    render();
    call({ action: "setEnabled", id: r.id, enabled: !r.enabled }).then(function (res) {
      replaceReminder(res.reminder);
      core().showToast(res.reminder.enabled ? "Turned on." : "Turned off.");
    }).catch(function (err) {
      setStatus(describeError(err));
    }).then(function () {
      delete state.busy[r.id];
      render();
    });
  }

  function saveSettings(applyToAll) {
    const status = $("rmSettingsStatus");
    status.textContent = "Saving…";
    const settings = {
      timezone: $("rmTz").value,
      quiet: { enabled: $("rmQuietOn").checked, start: $("rmQuietStart").value, end: $("rmQuietEnd").value }
    };
    if (settings.quiet.enabled && (!spec.cleanTime(settings.quiet.start) || !spec.cleanTime(settings.quiet.end))) {
      status.textContent = "Pick both quiet-hours times.";
      return;
    }
    if (applyToAll && state.reminders.length && !window.confirm("Move all " + state.reminders.length + " reminders to " + settings.timezone.replace(/_/g, " ") + "? They keep the same clock times in the new zone.")) {
      status.textContent = "";
      return;
    }
    call({ action: "saveSettings", settings: settings, applyToAll: !!applyToAll }).then(function (res) {
      state.settings = spec.sanitizeSettings(res.settings);
      status.textContent = applyToAll ? "Saved. Moved " + res.moved + (res.moved === 1 ? " reminder." : " reminders.") : "Saved.";
      return applyToAll ? load() : (saveCache(), null);
    }).catch(function (err) {
      status.textContent = describeError(err);
    }).then(render);
  }

  /* ---------------- the form ---------------- */

  function nextHalfHour() {
    const d = new Date();
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function blankForm(category) {
    const cat = spec.categoryOf(category) || spec.categoryOf("custom");
    const settings = state.settings || spec.sanitizeSettings(null);
    return {
      category: cat.value, title: cat.defaultTitle, type: "daily",
      times: cat.value === "water" ? spec.timesEvery("09:00", "19:00", 2) : [nextHalfHour()],
      days: [1, 2, 3, 4, 5], date: core().todayISODate(), notes: "",
      privateText: cat.privateText, respectQuietHours: false, enabled: true, timezone: settings.timezone
    };
  }

  function formFrom(r) {
    return {
      category: r.category, title: r.title, type: r.schedule.type, times: r.schedule.times.slice(),
      days: r.schedule.days.length ? r.schedule.days.slice() : [1, 2, 3, 4, 5], date: r.schedule.date || core().todayISODate(),
      notes: r.notes, privateText: r.privateText, respectQuietHours: r.respectQuietHours, enabled: r.enabled, timezone: r.timezone
    };
  }

  // A new reminder can start with some things filled in ({ title, times, type, days }), always checked the same way
  // the form checks anything typed in. It is only ever a starting point: nothing is saved until Save is tapped.
  function applyPrefill(form, prefill) {
    const title = spec.cleanText(prefill.title, spec.TITLE_MAX);
    if (title) form.title = title;
    const times = spec.cleanTimes(Array.isArray(prefill.times) ? prefill.times : []).times;
    if (times.length) form.times = times;
    const days = spec.cleanDays(prefill.days);
    if (prefill.type === "weekly" && days.length) { form.type = "weekly"; form.days = days; }
  }

  function openForm(reminder, category, openerId, prefill) {
    if (!signedIn()) return;
    state.editingId = reminder ? reminder.id : null;
    state.form = reminder ? formFrom(reminder) : blankForm(category);
    if (!reminder && prefill) applyPrefill(state.form, prefill);
    state.openerId = openerId || "rmNewBtn";
    $("rmModalTitle").textContent = reminder ? "Edit reminder" : "New reminder";
    $("rmSaveBtn").textContent = reminder ? "Save changes" : "Save reminder";
    $("rmDeleteBtn").classList.toggle("hidden", !reminder);
    $("rmFormError").textContent = "";
    $("rmDate").min = core().todayISODate();
    $("rmEvery").open = false;
    $("rmAdvanced").open = false;
    renderForm();
    core().openModal("rmModal");
    $("rmTitle").focus();
  }

  function closeForm() {
    core().closeModal("rmModal");
    const opener = $(state.openerId) || $("rmNewBtn");
    state.editingId = null;
    state.form = null;
    if (opener && opener.focus) opener.focus();
  }

  function pressButton(parent, label, pressed, onClick, extraClass) {
    const b = el("button", "rm-chip" + (pressed ? " on" : "") + (extraClass ? " " + extraClass : ""), label);
    b.type = "button";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }

  function summaryText() {
    const f = state.form;
    const times = spec.cleanTimes(f.times.filter(Boolean)).times;
    if (!times.length) return "Add a time to see when this will fire.";
    const sched = { type: f.type, times: times, days: f.type === "weekly" ? f.days.slice().sort() : [], date: f.type === "once" ? f.date : null };
    return spec.describeSchedule(sched) + " · " + f.timezone.replace(/_/g, " ");
  }

  function renderForm() {
    const f = state.form;
    if (!f) return;
    // Category chips
    const cats = $("rmCats");
    cats.textContent = "";
    spec.CATEGORIES.forEach(function (c) {
      const b = el("button", "rm-cat" + (f.category === c.value ? " on" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", f.category === c.value ? "true" : "false");
      b.appendChild(el("span", "rm-cat-icon", c.icon)).setAttribute("aria-hidden", "true");
      b.appendChild(document.createTextNode(" " + c.label));
      b.addEventListener("click", function () {
        const prev = spec.categoryOf(f.category);
        // Swap the suggested name only if the name is still the previous suggestion (or empty).
        if (!f.title.trim() || (prev && f.title === prev.defaultTitle)) f.title = c.defaultTitle;
        // The lock-screen default follows the category until you change it yourself.
        if (!f.privateTouched) f.privateText = c.privateText;
        f.category = c.value;
        renderForm();
      });
      cats.appendChild(b);
    });
    $("rmMedNote").classList.toggle("hidden", f.category !== "medication");
    if (document.activeElement !== $("rmTitle")) $("rmTitle").value = f.title;

    // Schedule type
    const type = $("rmType");
    type.textContent = "";
    [["daily", "Every day"], ["weekly", "Certain days"], ["once", "One time"]].forEach(function (p) {
      pressButton(type, p[1], f.type === p[0], function () {
        f.type = p[0];
        if (p[0] === "once" && f.times.length > 1) f.times = [f.times[0]];
        renderForm();
      });
    });
    $("rmDaysWrap").classList.toggle("hidden", f.type !== "weekly");
    $("rmDateWrap").classList.toggle("hidden", f.type !== "once");
    $("rmDate").value = f.date;
    $("rmEvery").classList.toggle("hidden", f.type === "once");

    // Days
    const days = $("rmDays");
    days.textContent = "";
    ["S", "M", "T", "W", "T", "F", "S"].forEach(function (letter, d) {
      const b = pressButton(days, letter, f.days.indexOf(d) !== -1, function () {
        const i = f.days.indexOf(d);
        if (i === -1) f.days.push(d); else f.days.splice(i, 1);
        renderForm();
      }, "rm-day");
      b.setAttribute("aria-label", spec.DAY_NAMES[d]);
    });

    // Times
    const times = $("rmTimes");
    times.textContent = "";
    f.times.forEach(function (t, i) {
      const row = el("div", "rm-time-row");
      const input = el("input");
      input.type = "time";
      input.value = t;
      input.setAttribute("aria-label", "Time " + (i + 1));
      input.addEventListener("input", function () { f.times[i] = input.value; $("rmSummary").textContent = summaryText(); });
      row.appendChild(input);
      if (f.times.length > 1) {
        const rm = el("button", "btn-icon", "×");
        rm.type = "button";
        rm.setAttribute("aria-label", "Remove time " + (i + 1));
        rm.addEventListener("click", function () { f.times.splice(i, 1); renderForm(); });
        row.appendChild(rm);
      }
      times.appendChild(row);
    });
    $("rmAddTimeBtn").disabled = f.type === "once" || f.times.length >= spec.MAX_TIMES;

    $("rmNotes").value = f.notes;
    $("rmPrivate").checked = f.privateText;
    $("rmQuiet").checked = f.respectQuietHours;
    $("rmEnabled").checked = f.enabled;
    fillZoneSelect($("rmFormTz"), f.timezone);
    $("rmSummary").textContent = summaryText();
  }

  function readForm() {
    const f = state.form;
    return {
      title: $("rmTitle").value, category: f.category, notes: $("rmNotes").value, enabled: $("rmEnabled").checked,
      schedule: {
        type: f.type,
        times: f.times.filter(Boolean),
        days: f.type === "weekly" ? f.days : [],
        date: f.type === "once" ? $("rmDate").value : null
      },
      timezone: $("rmFormTz").value, privateText: $("rmPrivate").checked, respectQuietHours: $("rmQuiet").checked
    };
  }

  function saveForm(e) {
    e.preventDefault();
    const err = $("rmFormError");
    const data = readForm();
    // The same checks the server makes, so mistakes show up before the round trip.
    const check = spec.sanitizeReminder(data);
    if (!check.ok) { err.textContent = check.error; return; }
    const btn = $("rmSaveBtn");
    btn.disabled = true;
    err.textContent = "";
    const editing = state.editingId;
    call(editing ? { action: "update", id: editing, reminder: data } : { action: "create", reminder: data }).then(function (res) {
      replaceReminder(res.reminder);
      closeForm();
      core().showToast(editing ? "Reminder updated." : "Reminder saved.");
      setStatus("");
    }).catch(function (e2) {
      err.textContent = describeError(e2);
    }).then(function () {
      btn.disabled = false;
      render();
    });
  }

  function deleteCurrent() {
    const id = state.editingId;
    const r = state.reminders.find(function (x) { return x.id === id; });
    if (!id || !r) return;
    if (!window.confirm("Delete “" + r.title + "”? This can't be undone.")) return;
    const btn = $("rmDeleteBtn");
    btn.disabled = true;
    call({ action: "delete", id: id }).then(function () {
      state.reminders = state.reminders.filter(function (x) { return x.id !== id; });
      saveCache();
      closeForm();
      core().showToast("Reminder deleted.");
    }).catch(function (err) {
      $("rmFormError").textContent = describeError(err);
    }).then(function () {
      btn.disabled = false;
      render();
    });
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    $("rmNewBtn").addEventListener("click", function () { openForm(null, "custom", "rmNewBtn"); });
    $("rmForm").addEventListener("submit", saveForm);
    $("rmCloseBtn").addEventListener("click", closeForm);
    $("rmCancelBtn").addEventListener("click", closeForm);
    $("rmDeleteBtn").addEventListener("click", deleteCurrent);
    $("rmModal").addEventListener("click", function (e) { if (e.target === $("rmModal")) closeForm(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("rmModal").classList.contains("hidden")) closeForm();
      else if (e.key === "Escape" && !$("rmActModal").classList.contains("hidden") && !state.actBusy) closeAct();
    });
    $("rmTitle").addEventListener("input", function () { if (state.form) state.form.title = $("rmTitle").value; });
    $("rmNotes").addEventListener("input", function () { if (state.form) state.form.notes = $("rmNotes").value; });
    $("rmDate").addEventListener("input", function () { if (state.form) { state.form.date = $("rmDate").value; $("rmSummary").textContent = summaryText(); } });
    $("rmPrivate").addEventListener("change", function () { if (state.form) { state.form.privateText = $("rmPrivate").checked; state.form.privateTouched = true; } });
    $("rmQuiet").addEventListener("change", function () { if (state.form) state.form.respectQuietHours = $("rmQuiet").checked; });
    $("rmEnabled").addEventListener("change", function () { if (state.form) state.form.enabled = $("rmEnabled").checked; });
    $("rmFormTz").addEventListener("change", function () { if (state.form) { state.form.timezone = $("rmFormTz").value; $("rmSummary").textContent = summaryText(); } });
    $("rmAddTimeBtn").addEventListener("click", function () {
      const f = state.form;
      if (!f || f.times.length >= spec.MAX_TIMES) return;
      f.times.push(nextHalfHour());
      renderForm();
    });
    $("rmEveryBtn").addEventListener("click", function () {
      const f = state.form;
      const times = spec.timesEvery($("rmEveryStart").value, $("rmEveryEnd").value, $("rmEveryStep").value);
      if (!times.length) { $("rmFormError").textContent = "Pick a start, an end after it, and how often."; return; }
      $("rmFormError").textContent = "";
      f.times = times;
      renderForm();
    });
    $("rmNotifOnBtn").addEventListener("click", turnOn);
    $("rmNotifOffBtn").addEventListener("click", turnOff);
    $("rmNotifTestNowBtn").addEventListener("click", testNow);
    $("rmNotifTestLaterBtn").addEventListener("click", testLater);
    $("rmNotifArrivedBtn").addEventListener("click", function () { reportCheck("arrived"); });
    $("rmNotifMissingBtn").addEventListener("click", function () { reportCheck("missing"); });
    if ("serviceWorker" in navigator && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener("message", function (e) {
        if (e && e.data && e.data.type === "jarvis-open-reminder") openFromNotification(typeof e.data.id === "string" ? e.data.id : "");
      });
    }
    $("rmActCloseBtn").addEventListener("click", closeAct);
    $("rmActDone").addEventListener("click", function () { doAct("done"); });
    $("rmActSkip").addEventListener("click", function () { doAct("skip"); });
    $("rmActUndo").addEventListener("click", function () { doAct("undo"); });
    $("rmHistBtn").addEventListener("click", loadHistory);
    $("rmSettingsSaveBtn").addEventListener("click", function () { saveSettings(false); });
    $("rmSettingsMoveBtn").addEventListener("click", function () { saveSettings(true); });

    // Load when the Reminders tab is opened, not on every app start.
    $("habitsSubNavReminders").addEventListener("click", function () {
      render();
      if (!state.loaded || state.error) load(); else if (Date.now() - (state.lastLoadAt || 0) > 5 * 60000) load();
      else if (Date.now() - state.eventsAt > 30000) loadEvents();
      state.lastLoadAt = Date.now();
      if (!push.loaded || !push.cfg || Date.now() - (push.lastRefreshAt || 0) > 60000) { push.lastRefreshAt = Date.now(); refreshPush(); }
    });
    // The relative times ("in 5 min") and the Today list stay fresh while the tab is open.
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      const panel = $("habits-reminders");
      if (panel && panel.classList.contains("active") && state.loaded) {
        // A new day (or a reminder's today list gone stale) means asking the server again.
        if (state.loadedDay && state.loadedDay !== core().todayISODate()) load();
        else if (state.eventsLoaded && !document.hidden && Date.now() - state.eventsAt > 3 * 60000) loadEvents();
        renderHero();
        renderToday();
      }
    }, 60000);
  }

  function init() {
    if (!spec || !$("habits-reminders") || state.ready) return;
    state.ready = true;
    loadCache();
    renderQuick();
    wire();
    render();
    // JARVIS was opened by tapping a notification: ?reminder=<the reminder's record>.
    const tapped = window.location.search.match(/[?&]reminder=([^&#]*)/);
    if (tapped) {
      try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* ignore */ }
      let id = "";
      try { id = decodeURIComponent(tapped[1]); } catch (e) { id = ""; }
      openFromNotification(id);
    }
  }

  // For other screens: go to Reminders and open a new reminder, already filled in, for the person to check and save.
  function openNew(prefill) {
    const nav = $("navBtnHabits");
    if (nav) nav.click();
    const tab = $("habitsSubNavReminders");
    if (tab) tab.click();
    if (!signedIn()) { core().showToast("Log in to your JARVIS account to set reminders."); return false; }
    openForm(null, "custom", "rmNewBtn", prefill || null);
    return true;
  }

  // For Discipline's Setup: what this phone already knows, with no network call. The reminders are the read-only copy
  // kept on the device (as of the last time the Reminders screen loaded), so Setup can say "saved" only for what the
  // server has confirmed, and "not loaded yet" when it hasn't been asked.
  function snapshot() {
    return {
      available: !!spec, signedIn: signedIn(), loaded: state.loaded, fromCache: state.fromCache, cachedAt: state.cachedAt, error: state.error,
      reminders: spec ? state.reminders.map(function (r) {
        return { id: r.id, title: r.title, enabled: !!r.enabled, category: r.category, schedule: r.schedule, timezone: r.timezone, nextFireAt: r.nextFireAt };
      }) : [],
      settings: state.settings, deviceZone: deviceZone(),
      push: { mode: pushMode(), permission: permission(), ios: isIos(), standalone: isStandalone(), supported: canPush(), check: readCheck(), loaded: push.loaded, error: push.error }
    };
  }

  // Asks the server again (reminders and this phone's notification registration). Resolves when both have answered.
  function refresh() {
    if (!spec) return Promise.resolve();
    return Promise.all([load(), refreshPush()]).then(function () { return null; });
  }

  // Goes to Reminders and opens one reminder for editing. false when there isn't one.
  function openEdit(id) {
    const r = state.reminders.find(function (x) { return x.id === id; });
    if (!r) return false;
    const nav = $("navBtnHabits");
    if (nav) nav.click();
    const tab = $("habitsSubNavReminders");
    if (tab) tab.click();
    if (!signedIn()) { core().showToast("Log in to your JARVIS account to edit reminders."); return false; }
    openForm(r, r.category, "rmNewBtn");
    return true;
  }

  // Sends a test notification now, with JARVIS open. Resolves with the words to show, never claims it appeared.
  function sendTest() {
    if (push.busy) return Promise.resolve("A test is already running.");
    push.busy = true;
    renderPush();
    return callN({ action: "test", delaySeconds: 0 }).then(function (res) {
      const text = testResultText(res);
      setPushStatus(text);
      return text;
    }).catch(function (err) {
      const text = describeError(err);
      setPushStatus(text);
      return text;
    }).then(function (text) {
      push.busy = false;
      return refreshPush().then(function () { return text; });
    });
  }

  window.JarvisReminders = {
    init: init,
    render: render,
    openNew: openNew,
    snapshot: snapshot,
    refresh: refresh,
    openEdit: openEdit,
    sendTest: sendTest,
    helpers: { relative: relative, describeError: describeError, cleanReminder: cleanReminder }
  };
})();
