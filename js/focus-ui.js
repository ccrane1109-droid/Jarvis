/* ==========================================================================
   JARVIS — the focus timer: start a session from any task, habit or time block, with a small bar that stays on screen while it runs.

   Rules are in focus-logic.js. Two things are stored:
     jarvisFocusActive   the session that is running right now (this device only, so a refresh or a closed page loses nothing)
     jarvisFocusLog      one record per finished focus session (backed up, merged by id)
   The bar shows the time from timestamps every second; it never counts, so it cannot drift. Paused time is not work.
   JarvisFocus.start({ title, itemKey, taskId, habitId, opener })  asks how long (2-minute start, 15, 25, 50 or your own), then starts.
   ========================================================================== */

(function () {
  "use strict";

  const F = window.JarvisFocusLogic;
  if (!F) return;
  const ACTIVE_KEY = "jarvisFocusActive", LOG_KEY = "jarvisFocusLog";
  let active = null, log = [], timer = null, bar = null, after = null, upAnnounced = false;

  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === undefined || s === null ? "" : s)); }
  function notify() { try { document.dispatchEvent(new CustomEvent("jarvis-focus-changed")); } catch (e) { /* nothing is listening */ } }

  /* ---------------- storage ---------------- */

  function loadAll() {
    try { active = F.readActive(core().loadJSON(ACTIVE_KEY, null)); } catch (e) { active = null; }
    try { const l = core().loadJSON(LOG_KEY, []); log = Array.isArray(l) ? l : []; } catch (e) { log = []; }
  }
  function saveActive() { return active ? core().saveJSON(ACTIVE_KEY, active) : (function () { try { window.localStorage.removeItem(ACTIVE_KEY); return true; } catch (e) { return false; } })(); }
  function saveLog() { return core().saveJSON(LOG_KEY, log); }

  /* ---------------- the bar ---------------- */

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "fcBar"; bar.className = "fc-bar hidden";
    bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Focus session");
    bar.innerHTML = '<div class="fc-main"><span class="fc-title" id="fcTitle"></span><span class="fc-clock" id="fcClock" role="timer"></span></div><div class="fc-acts" id="fcActs"></div><p class="visually-hidden" id="fcLive" aria-live="polite"></p>';
    document.body.appendChild(bar);
    bar.addEventListener("click", onClick);
    return bar;
  }

  function draw() {
    ensureBar();
    const now = Date.now();
    const on = !!active || !!after;
    bar.classList.toggle("hidden", !on);
    document.body.classList.toggle("fc-on", on);
    if (!on) return;
    const title = bar.querySelector("#fcTitle"), clk = bar.querySelector("#fcClock"), acts = bar.querySelector("#fcActs");
    if (after && !active) {
      title.textContent = after.text;
      clk.textContent = "";
      acts.innerHTML = '<button type="button" class="btn btn-secondary" data-fc="break">5-minute break</button><button type="button" class="btn btn-secondary" data-fc="dismiss">Done</button>';
      return;
    }
    const paused = F.isPaused(active), up = F.isUp(active, now), isBreak = active.kind === "break";
    title.textContent = (isBreak ? "Break · " : "") + active.title;
    clk.textContent = active.plannedMin ? (up ? "Time’s up · +" + F.clock(-F.remainingMs(active, now)) : F.clock(F.remainingMs(active, now)) + " left") : F.clock(F.elapsedMs(active, now)) + " so far";
    clk.classList.toggle("is-up", up);
    bar.classList.toggle("is-paused", paused);
    acts.innerHTML = (up && active.plannedMin ? '<button type="button" class="btn btn-secondary" data-fc="more">+5 min</button>' : '') +
      '<button type="button" class="btn btn-secondary" data-fc="' + (paused ? "resume" : "pause") + '">' + (paused ? "Resume" : "Pause") + '</button>' +
      '<button type="button" class="btn btn-primary" data-fc="finish">' + (isBreak ? "End break" : "Finish") + '</button>';
  }

  function tick() {
    if (!active) { stopTimer(); return; }
    const now = Date.now(), clk = bar && bar.querySelector("#fcClock");
    if (clk) {
      const up = F.isUp(active, now);
      clk.textContent = active.plannedMin ? (up ? "Time’s up · +" + F.clock(-F.remainingMs(active, now)) : F.clock(F.remainingMs(active, now)) + " left") : F.clock(F.elapsedMs(active, now)) + " so far";
      if (up !== clk.classList.contains("is-up")) draw();
    }
    if (F.isUp(active, now) && !F.isPaused(active) && !upAnnounced) {
      upAnnounced = true;
      const live = bar.querySelector("#fcLive");
      if (live) live.textContent = active.kind === "break" ? "Break is over." : "Time is up. Finish, or add five minutes.";
      try { if (navigator.vibrate) navigator.vibrate(active.kind === "break" ? [120] : [200, 100, 200]); } catch (e) { /* no vibration here */ }
      draw();
    }
  }
  function startTimer() { if (!timer) timer = window.setInterval(tick, 1000); }
  function stopTimer() { if (timer) { window.clearInterval(timer); timer = null; } }

  /* ---------------- actions ---------------- */

  function begin(input) {
    const r = F.start(input, Date.now(), function () { return core().uid("fs"); });
    if (!r.ok) { core().showToast(r.error); return false; }
    active = r.active; after = null; upAnnounced = false;
    if (!saveActive()) { active = null; core().showToast("That couldn't be saved. The browser may be full or blocking storage."); return false; }
    draw(); startTimer(); notify();
    const live = bar.querySelector("#fcLive");
    if (live) live.textContent = "Started " + active.title + (active.plannedMin ? " for " + active.plannedMin + " minutes." : ".");
    return true;
  }

  function finishNow() {
    if (!active) return;
    const a = active, rec = F.finish(a, Date.now());
    if (rec) {
      const prev = log;
      log = F.add(log, rec);
      if (!saveLog()) { log = prev; core().showToast("That couldn't be saved. The session is still running."); return; }
    }
    active = null; saveActive(); stopTimer();
    after = a.kind === "focus" ? { text: rec ? "Focused " + Math.max(1, Math.round(rec.focusMs / 60000)) + " min on " + a.title + "." : "Stopped. Under a second isn't recorded." } : null;
    draw(); notify();
    if (after) window.setTimeout(function () { if (after && !active) { after = null; draw(); } }, 12000);
  }

  function onClick(e) {
    const b = e.target.closest("[data-fc]");
    if (!b) return;
    const what = b.getAttribute("data-fc"), now = Date.now();
    if (what === "pause" && active) { active = F.pause(active, now); saveActive(); draw(); notify(); }
    else if (what === "resume" && active) { active = F.resume(active, now); saveActive(); draw(); notify(); }
    else if (what === "more" && active) { active = F.extend(active, 5); upAnnounced = false; saveActive(); draw(); }
    else if (what === "finish") finishNow();
    else if (what === "dismiss") { after = null; draw(); }
    else if (what === "break") { after = null; begin({ title: "Break", kind: "break", plannedMin: 5 }); }
  }

  // Asks how long, then starts. o { title, itemKey, taskId, habitId, opener }
  function start(o) {
    const o2 = o || {}, title = String(o2.title || "").trim() || "Focus";
    const go = function (plannedMin) { begin({ title: title, itemKey: o2.itemKey, taskId: o2.taskId, habitId: o2.habitId, plannedMin: plannedMin }); };
    const choose = function () {
      const rows = F.PRESETS.map(function (p) { return { key: p.key, label: p.label, sub: p.sub }; }).concat([{ key: "custom", label: "Custom length…", sub: "Any number of minutes" }, { key: "open", label: "No timer", sub: "Count up until you finish", minor: true }]);
      window.JarvisMenu.open({
        title: "Focus on " + title, opener: o2.opener, rows: rows,
        onPick: function (key) {
          if (key === "open") go(0);
          else if (key === "custom") askCustom(go, o2.opener);
          else { const p = F.PRESETS.filter(function (x) { return x.key === key; })[0]; if (p) go(p.minutes); }
        }
      });
    };
    if (active) {
      window.JarvisMenu.open({
        title: "A session is already running", opener: o2.opener,
        rows: [{ key: "swap", label: "Finish “" + active.title + "” and start this one", sub: "What you worked is kept" }, { key: "keep", label: "Keep the current one going", minor: true }],
        onPick: function (key) { if (key === "swap") { finishNow(); after = null; choose(); } }
      });
      return;
    }
    choose();
  }

  function askCustom(go, opener) {
    const A = window.JarvisPlanApp;
    if (!A || !A.openSheet) { const v = window.prompt("How many minutes? (1 to " + F.MAX_MIN + ")", "30"); if (v !== null) { const m = F.minutesFrom(v); if (m) go(m); else core().showToast("Choose a length from 1 to " + F.MAX_MIN + " minutes."); } return; }
    A.openSheet({
      title: "Custom focus length",
      body: '<div class="form-row"><label for="spf_mins">Minutes</label><input type="number" id="spf_mins" name="mins" min="1" max="' + F.MAX_MIN + '" step="1" inputmode="numeric" value="30"><p class="sp-err hidden" data-err="mins" role="alert"></p></div>',
      submit: "Start", focus: '[name="mins"]',
      onSubmit: function (v) { const m = F.minutesFrom(v.mins); if (!m) return { ok: false, errors: { mins: "Choose a length from 1 to " + F.MAX_MIN + " minutes." } }; window.setTimeout(function () { go(m); }, 0); return { ok: true }; }
    });
  }

  /* ---------------- reading ---------------- */

  function today() { return core().todayISODate(); }
  function init() {
    loadAll();
    ensureBar();
    draw();
    if (active) startTimer();
    // another tab, or a refresh, may have changed it
    window.addEventListener("storage", function (e) { if (e.key === ACTIVE_KEY || e.key === LOG_KEY) { loadAll(); draw(); if (active) startTimer(); notify(); } });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { tick(); draw(); } });
  }

  window.JarvisFocus = {
    init: init, start: start, isActive: function () { return !!active; },
    active: function () { return active ? Object.assign({}, active) : null; },
    // worked minutes for a day (default today) and for one task on that day
    minutesOn: function (date) { return F.totals(log, date || today(), date || today()).minutes; },
    totals: function (from, to) { return F.totals(log, from, to); },
    records: function () { return F.live(log); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
