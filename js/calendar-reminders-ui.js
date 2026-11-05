/* ==========================================================================
   JARVIS — Calendar reminders (the screen).

   The rules are in calendar-reminders-logic.js. This file looks at your calendar once a minute at most, and at the
   moment something comes due, and then:
   - shows a banner inside JARVIS (if that is on), with Open, Snooze and Dismiss;
   - asks the phone or computer for a notification, but only if you turned that on AND allowed it, and only when
     JARVIS is in the background (when you are looking at it the banner is enough);
   - lists reminders that came due while JARVIS wasn't open or was running in the background, marked as missed.

   What it cannot do: run when JARVIS is closed. Nothing here is sent from a server, so a calendar reminder that
   comes due while JARVIS is closed is only listed the next time you open it. The settings screen says so.

   Which reminders have been shown is kept on this device only (jarvisCalReminderLog, not synced), so each device
   reminds you for itself.
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const R = window.JarvisCalendarReminders;
  const LOG_KEY = "jarvisCalReminderLog", MAX_DELAY_MS = 5 * 60000, MIN_DELAY_MS = 1000;
  let log = {}, timer = null, queue = [], missed = [], notified = {}, st = null, ready = false;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function cal() { return window.JarvisCalendar && window.JarvisCalendar.getEvents && window.JarvisCalendar.showEvent ? window.JarvisCalendar : null; }
  function zone() { return cal().zone(); }
  function notifyPrefs() { return C.notifySettings(cal().getSettings().notify); }
  function announce(text) { const el = $("calLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  function focusSoon(sel) { window.setTimeout(function () { const e = document.querySelector(sel); if (e) e.focus(); }, 0); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------------- what has been shown (this device only) ---------------- */

  function loadLog() { log = R.sanitizeLog(core().loadJSON(LOG_KEY, {})); }
  function saveLog() { log = R.prune(log, Date.now()); core().saveJSON(LOG_KEY, log); }

  /* ---------------- the browser's side ---------------- */

  function env() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    return { supported: "Notification" in window, permission: "Notification" in window ? Notification.permission : "denied", ios: ios, standalone: standalone };
  }
  // Asks for a system notification. Resolves true if the browser accepted the request; that is not proof anything appeared.
  function showSystem(n) {
    if (!("Notification" in window) || Notification.permission !== "granted") return Promise.resolve(false);
    const opts = { body: n.body, tag: n.tag, icon: "./icon-192.png", badge: "./icon-192.png", data: n.data };
    const reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration() : Promise.resolve(null);
    return Promise.resolve(reg).catch(function () { return null; }).then(function (r) { return r && r.showNotification ? r.showNotification(n.title, opts) : new Notification(n.title, opts); }).then(function () { return true; }, function () { return false; });
  }

  /* ---------------- looking at the calendar ---------------- */

  function check() {
    window.clearTimeout(timer);
    if (!ready || !cal()) return;
    const now = Date.now(), prefs = notifyPrefs();
    const p = R.plan(cal().getEvents(), { now: now, zone: zone(), notify: prefs, log: log });
    missed = p.missed;
    const e = env();
    p.due.forEach(function (d) {
      if (!queue.some(function (q) { return q.key === d.key; })) { if (prefs.inApp) queue.push(d); }
      if (!notified[d.key] && prefs.system && e.supported && e.permission === "granted" && document.visibilityState !== "visible") {
        notified[d.key] = true;
        showSystem(R.notificationFor(d, prefs, now, zone())).then(function (ok) { if (ok) { log = R.markShown(log, d.key, now, "system"); saveLog(); queue = queue.filter(function (q) { return q.key !== d.key; }); render(); } });
      }
    });
    queue = queue.filter(function (q) { return !log[q.key] || (log[q.key].snoozeUntil > 0); });
    render();
    const wait = p.next === null ? MAX_DELAY_MS : Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, p.next - now));
    timer = window.setTimeout(check, wait);
  }

  /* ---------------- the banner ---------------- */

  function lineFor(e) { return R.whenLine(e, Date.now(), zone()); }
  function renderBar() {
    const bar = $("crBar"); if (!bar) return;
    const prefs = notifyPrefs();
    let h = "";
    if (prefs.inApp && queue.length) {
      const e = queue[0];
      h += '<div class="cr-card" role="group" aria-label="Reminder"><div class="cr-main"><strong class="cr-t">' + esc(e.title) + '</strong><span class="cr-w">' + esc(lineFor(e)) + (queue.length > 1 ? " · " + (queue.length - 1) + " more" : "") + '</span></div>' +
        '<div class="cr-acts"><button type="button" class="btn btn-primary" data-cr="open" data-key="' + esc(e.key) + '">Open</button><button type="button" class="btn btn-secondary" data-cr="snooze" data-key="' + esc(e.key) + '">Snooze 10 min</button><button type="button" class="btn btn-secondary" data-cr="dismiss" data-key="' + esc(e.key) + '">Dismiss</button></div></div>';
    }
    if (missed.length) {
      h += '<div class="cr-card cr-missed" role="group" aria-label="Missed reminders"><div class="cr-main"><strong class="cr-t">' + esc(plural(missed.length, "reminder", "reminders")) + ' came due while JARVIS wasn’t open</strong><span class="cr-w">JARVIS can only remind you while it is open.</span></div>' +
        '<div class="cr-acts"><button type="button" class="btn btn-secondary" data-cr="show-missed">Show</button><button type="button" class="btn btn-secondary" data-cr="dismiss-missed">Dismiss all</button></div></div>';
    }
    bar.innerHTML = h;
    bar.classList.toggle("hidden", !h);
  }
  function render() {
    const before = ($("crBar") && $("crBar").textContent) || "";
    renderBar();
    const after = $("crBar").textContent;
    if (after !== before && after) announce(queue.length && notifyPrefs().inApp ? "Reminder: " + queue[0].title + ". " + lineFor(queue[0]) : plural(missed.length, "reminder", "reminders") + " came due while JARVIS wasn't open.");
    if (st && st.step === "missed") { st.list = missed; if (!missed.length) closeSheet(); else drawSheet(); }
  }

  function parseKey(itemKey) { const i = String(itemKey).lastIndexOf("@"); return i > 0 ? { id: itemKey.slice(0, i), occDate: itemKey.slice(i + 1) } : null; }
  function openItem(itemKey) {
    const k = parseKey(itemKey), c = cal();
    if (!k || !c || !c.showEvent(k.id, k.occDate)) core().showToast("That event isn’t there any more.");
  }
  function find(key) { return queue.concat(missed).filter(function (e) { return e.key === key; })[0]; }
  function act(kind, key) {
    const e = find(key), now = Date.now();
    if (kind === "snooze" && e) log = R.snooze(log, key, now, 10, "app");
    else log = R.markShown(log, key, now, "seen");
    saveLog();
    if (kind === "open" && e) openItem(e.itemKey);
    if (kind === "snooze") announce("Snoozed for 10 minutes.");
    queue = queue.filter(function (q) { return q.key !== key; });
    check();
  }
  function dismissAllMissed() { const now = Date.now(); missed.forEach(function (e) { log = R.markShown(log, e.key, now, "seen"); }); saveLog(); missed = []; check(); }

  /* ---------------- the settings and missed sheet ---------------- */

  function formHtml() {
    const f = st.form, e = env(), s = R.status(e, f);
    let h = '';
    if (st.msg) h += '<div class="cal-banner" role="status">' + esc(st.msg) + '</div>';
    h += '<p class="field-hint">Reminders you set on an event (the “Remind me” choices) are shown here.</p>';
    h += '<fieldset class="cc-pick"><legend>In JARVIS</legend><label class="cal-check"><input type="checkbox" id="cr_inApp"' + (f.inApp ? " checked" : "") + '> Show a banner when a reminder comes due</label><p class="field-hint">' + esc(s.inApp) + '</p></fieldset>';
    h += '<fieldset class="cc-pick"><legend>Phone or computer notification</legend><label class="cal-check"><input type="checkbox" id="cr_system"' + (f.system ? " checked" : "") + '> Also show a notification</label><p class="field-hint" id="cr_sysText">' + esc(s.system.text) + '</p>' +
      '<label class="cal-check"><input type="checkbox" id="cr_hide"' + (f.hideTitles ? " checked" : "") + '> Keep event names off the lock screen</label>' +
      '<button type="button" class="btn btn-secondary" data-cr="test"' + (e.permission === "granted" && e.supported ? "" : " disabled") + '>Send a test notification</button></fieldset>';
    h += '<div class="cal-field"><label for="cr_allDay">All-day reminders count from</label><input type="time" id="cr_allDay" value="' + esc(f.allDayAt) + '"></div>';
    h += '<fieldset class="cc-pick"><legend>Quiet hours</legend><label class="cal-check"><input type="checkbox" id="cr_quiet"' + (f.quiet.enabled ? " checked" : "") + '> Hold reminders until quiet hours end</label>' +
      '<div class="cal-row"><div class="cal-field"><label for="cr_qs">From</label><input type="time" id="cr_qs" value="' + esc(f.quiet.start) + '"></div><div class="cal-field"><label for="cr_qe">Until</label><input type="time" id="cr_qe" value="' + esc(f.quiet.end) + '"></div></div>' +
      '<p class="field-hint">A reminder that falls inside these hours comes when they end, unless the event is already over by then. These are starting times; change them to suit you.</p></fieldset>';
    h += '<div class="cr-limit"><strong>When JARVIS is closed</strong><p>' + esc(s.closed) + '</p></div>';
    h += '<div class="cal-actions"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn btn-secondary" data-cr="close">Cancel</button></div>';
    return h;
  }
  function missedHtml() {
    let h = '<p class="field-hint">These came due while JARVIS wasn’t open or was running in the background. They are only listed here; nothing was sent to your phone.</p>';
    h += '<ul class="as-props">' + st.list.map(function (e) {
      return '<li class="as-slot"><span class="as-body"><span class="as-t">' + esc(e.title) + '</span><span class="as-sub">Was due ' + esc(C.timeLabel(C.instantToWall(e.deliverAt, zone()).time)) + '</span><span class="as-why">' + esc(lineFor(e)) + '</span></span>' +
        '<span class="cr-rowacts"><button type="button" class="btn btn-secondary" data-cr="open-missed" data-key="' + esc(e.key) + '">Open</button><button type="button" class="btn btn-secondary" data-cr="dismiss-one" data-key="' + esc(e.key) + '">Dismiss</button></span></li>';
    }).join("") + '</ul>';
    h += '<div class="cal-actions"><button type="button" class="btn btn-secondary" data-cr="dismiss-missed">Dismiss all</button><button type="button" class="btn btn-secondary" data-cr="close">Close</button></div>';
    return h;
  }
  function drawSheet() {
    if (!st) return;
    $("crTitle").textContent = st.step === "missed" ? "Missed reminders" : "Reminder settings";
    $("crBody").innerHTML = st.step === "missed" ? missedHtml() : formHtml();
    $("crModal").classList.remove("hidden");
  }
  function closeSheet() {
    const s = st; st = null;
    $("crModal").classList.add("hidden"); $("crBody").innerHTML = "";
    if (s && s.opener && s.opener.focus && document.contains(s.opener)) s.opener.focus();
  }
  function readForm() {
    const f = st.form, v = function (id) { const x = $(id); return x ? x.value : undefined; }, c = function (id, d) { const x = $(id); return x ? x.checked : d; };
    f.inApp = c("cr_inApp", f.inApp); f.system = c("cr_system", f.system); f.hideTitles = c("cr_hide", f.hideTitles);
    f.allDayAt = v("cr_allDay") || f.allDayAt; f.quiet = { enabled: c("cr_quiet", f.quiet.enabled), start: v("cr_qs") || f.quiet.start, end: v("cr_qe") || f.quiet.end };
  }
  function openSettings(opener) {
    if (!cal()) return;
    st = { step: "prefs", opener: opener || document.activeElement, form: notifyPrefs(), msg: "" };
    drawSheet(); focusSoon("#cr_inApp");
  }
  function openMissed(opener) {
    st = { step: "missed", opener: opener || document.activeElement, list: missed }; drawSheet(); focusSoon("#crBody .btn");
  }
  function save() {
    readForm();
    if (st.form.quiet.enabled && st.form.quiet.start === st.form.quiet.end) { st.msg = "Quiet hours can't start and end at the same time."; drawSheet(); return; }
    const c = cal(), next = C.settings(Object.assign({}, c.getSettings(), { notify: C.notifySettings(st.form), updatedAt: Date.now() }));
    if (!c.saveSettings(next)) { st.msg = "The browser would not save your settings."; drawSheet(); return; }
    closeSheet(); announce("Reminder settings saved."); check();
  }
  // Turning the notification option on asks for permission, which the browser only allows from a tap like this one.
  function onSystemToggle() {
    readForm();
    if (!st.form.system) { st.msg = ""; drawSheet(); focusSoon("#cr_system"); return; }
    const s = R.status(env(), st.form).system;
    const finish = function (perm) {
      const now = R.status(env(), st.form).system;
      if (perm !== "granted" && env().permission !== "granted") st.form.system = false;
      st.msg = env().permission === "granted" ? "" : now.text;
      drawSheet(); focusSoon("#cr_system");
    };
    if (s.canAsk) {
      let done = false;
      const once = function (p) { if (!done) { done = true; finish(p); } };
      try { const r = Notification.requestPermission(once); if (r && r.then) r.then(once, function () { once("denied"); }); } catch (e) { once("denied"); }
      return;
    }
    if (env().permission !== "granted") st.form.system = false;
    st.msg = env().permission === "granted" ? "" : s.text;
    drawSheet(); focusSoon("#cr_system");
  }
  function sendTest() {
    readForm();
    showSystem({ title: "JARVIS", body: "This is a test of calendar reminders.", tag: "cal:test", data: { kind: "calendar", id: "", url: "./index.html" } }).then(function (ok) {
      if (!st) return;
      st.msg = ok ? "Asked your browser to show a test notification. Whether it appears is up to this device; if nothing showed, check the notification settings for JARVIS." : "The browser wouldn’t show a notification. Check that notifications are allowed for JARVIS on this device.";
      drawSheet(); focusSoon('[data-cr="test"]');
    });
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    const el = e.target.closest("[data-cr]");
    if (e.target === $("crModal") && st) { closeSheet(); return; }
    if (!el) return;
    const a = el.getAttribute("data-cr"), key = el.getAttribute("data-key") || "";
    if (a === "open" || a === "snooze" || a === "dismiss") act(a, key);
    else if (a === "show-missed") openMissed(el);
    else if (a === "dismiss-missed") { dismissAllMissed(); if (st) closeSheet(); }
    else if (a === "open-missed") { const m = find(key); const k = m ? m.itemKey : ""; closeSheet(); act("dismiss", key); if (k) openItem(k); }
    else if (a === "dismiss-one") act("dismiss", key);
    else if (a === "close") closeSheet();
    else if (a === "test") sendTest();
  }
  function onSubmit(e) { e.preventDefault(); if (st && st.step === "prefs") save(); }
  function onKey(e) { if (st && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSheet(); } }

  function openFromUrl() {
    const m = window.location.search.match(/[?&]calReminder=([^&#]*)/);
    if (!m) return;
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* ignore */ }
    let k = ""; try { k = decodeURIComponent(m[1]); } catch (e) { k = ""; }
    if (k) openItem(k);
  }

  function init() {
    if (!C || !R || !$("crBar") || !$("crModal")) return;
    loadLog();
    $("crBar").addEventListener("click", onClick);
    $("crModal").addEventListener("click", onClick);
    $("crBody").addEventListener("submit", onSubmit);
    $("crBody").addEventListener("change", function (e) { if (e.target.id === "cr_system" && st && st.step === "prefs") onSystemToggle(); });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("jarvis-calendar-changed", function () { if (ready) check(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    if ("serviceWorker" in navigator && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener("message", function (e) { if (e && e.data && e.data.type === "jarvis-open-reminder" && e.data.kind === "calendar" && typeof e.data.id === "string") openItem(e.data.id); });
    }
    ready = true;
    check();
    openFromUrl();
  }

  window.JarvisCalReminders = { init: init, openSettings: openSettings, check: check };
})();
