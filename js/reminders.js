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

   This step stores and manages reminders. It does not send notifications yet,
   and the page says so.
   ========================================================================== */

(function () {
  "use strict";

  const CACHE_KEY = "jarvisRemindersCache";
  const spec = window.JarvisReminderSpec || null;
  const state = {
    ready: false, loading: false, loaded: false, error: "", fromCache: false, cachedAt: null,
    reminders: [], settings: null, max: 100, busy: {},
    editingId: null, form: null, openerId: null
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
      nextFireAt: isoOrNull(r.nextFireAt), today: isoList(r.today), upcoming: isoList(r.upcoming)
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
      render();
    });
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
    strip.appendChild(stripChip("off", "⊘", "Phone notifications: not set up yet"));
    if (state.settings) strip.appendChild(stripChip("info", "◷", state.settings.timezone.replace(/_/g, " ")));
  }

  function renderToday() {
    const box = $("rmToday");
    const hint = $("rmTodayHint");
    box.textContent = "";
    const items = [];
    state.reminders.forEach(function (r) {
      if (!r.enabled) return;
      r.today.forEach(function (iso) { items.push({ r: r, iso: iso }); });
    });
    items.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
    if (!items.length) {
      hint.textContent = "";
      box.appendChild(el("p", "nr-empty", state.reminders.length
        ? "Nothing is scheduled for the rest of today."
        : "Your reminders for today will show here."));
      return;
    }
    hint.textContent = "What is scheduled for today. Marking reminders done, snoozing and skipping arrive with notifications.";
    const now = Date.now();
    items.forEach(function (it) {
      const past = new Date(it.iso).getTime() <= now;
      const row = el("div", "rm-today-row" + (past ? " past" : ""));
      row.appendChild(el("span", "rm-icon", iconOf(it.r))).setAttribute("aria-hidden", "true");
      const text = el("div", "rm-today-text");
      text.appendChild(el("p", "rm-title", it.r.title));
      text.appendChild(el("p", "rm-sub", (past ? "Earlier today" : "Coming up") + (it.r.notes ? " · " + it.r.notes : "")));
      row.appendChild(text);
      const when = timeText(it.iso, it.r.timezone) + (it.r.timezone !== deviceZone() ? " " + zoneName(it.iso, it.r.timezone) : "");
      row.appendChild(el("span", "rm-when", when));
      box.appendChild(row);
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

  function openForm(reminder, category, openerId) {
    if (!signedIn()) return;
    state.editingId = reminder ? reminder.id : null;
    state.form = reminder ? formFrom(reminder) : blankForm(category);
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
    $("rmSettingsSaveBtn").addEventListener("click", function () { saveSettings(false); });
    $("rmSettingsMoveBtn").addEventListener("click", function () { saveSettings(true); });

    // Load when the Reminders tab is opened, not on every app start.
    $("habitsSubNavReminders").addEventListener("click", function () {
      render();
      if (!state.loaded || state.error) load(); else if (Date.now() - (state.lastLoadAt || 0) > 5 * 60000) load();
      state.lastLoadAt = Date.now();
    });
    // The relative times ("in 5 min") and the Today list stay fresh while the tab is open.
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      const panel = $("habits-reminders");
      if (panel && panel.classList.contains("active") && state.loaded) { renderHero(); renderToday(); }
    }, 60000);
  }

  function init() {
    if (!spec || !$("habits-reminders") || state.ready) return;
    state.ready = true;
    loadCache();
    renderQuick();
    wire();
    render();
  }

  window.JarvisReminders = {
    init: init,
    render: render,
    helpers: { relative: relative, describeError: describeError, cleanReminder: cleanReminder }
  };
})();
