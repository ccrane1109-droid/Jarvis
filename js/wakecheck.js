/* ==========================================================================
   JARVIS — Wake check (the Wake tab in Habits). The rules live in
   wakecheck-logic.js.

   localStorage key:
     jarvisWakeCheck — { settings: { enabled, time, days, phrase1, phrase2, delay, window, caseSensitive,
                                     trackedFrom, updatedAt },
                         days: { "<YYYY-MM-DD>": { wake, delay, window, first, due, second } } }
   Saved on this device and backed up to your own account by js/cloud-backup.js.

   What it does and doesn't do: your own alarm (the Clock app) rings. JARVIS asks for a phrase afterwards and a second
   one a few minutes later, and counts a streak of mornings you finished both. It only knows what was typed and when.
   It can't see whether you're awake, can't ring or notify you (not yet), and can't stop an alarm being silenced.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisWakeCheck";
  const L = window.JarvisWakeCheckLogic;
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];                 // Monday first
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let store = null;
  let sig = "";               // what the status card is showing, so it is only redrawn when that changes
  let formDays = [];          // the days ticked in the form (not saved until Save)
  let started = false;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v); }

  /* ---------------- data ---------------- */

  function save() {
    if (!core().saveJSON(LS_KEY, store)) core().showToast("Couldn't save. This browser's storage may be full or blocked.");
  }

  function load() {
    store = L.sanitizeStore(core().loadJSON(LS_KEY, null));
    const settled = L.reconcile(store, Date.now());
    if (settled !== store) { store = settled; save(); }
  }

  /* ---------------- words ---------------- */

  function nextText(next, now) {
    if (!next) return "";
    const today = L.dateKey(now);
    const when = next.dateKey === today ? "today" : next.dateKey === L.addDays(today, 1) ? "tomorrow" : L.dayName(next.dateKey);
    return when + " at " + L.formatMs(next.wake);
  }
  function countSpan(ms) { return '<span class="wk-count" data-wk-to="' + ms + '">' + L.countdownText(ms - Date.now()) + "</span>"; }
  function typedAt(iso) { return L.formatMs(Date.parse(iso)); }

  function badgeFor(v) {
    if (v.mode === "off") return { text: "Off", cls: "badge-neutral" };
    if (v.mode === "active") return v.state === "waiting" ? { text: "Waiting", cls: "badge-neutral" } : { text: "Type now", cls: "badge-accent" };
    if (v.mode === "complete") return { text: "Done", cls: "badge-green" };
    if (v.mode === "missed") return { text: "Missed", cls: "badge-yellow" };
    if (v.mode === "upcoming") return { text: "Later today", cls: "badge-neutral" };
    return { text: "Rest day", cls: "badge-neutral" };
  }

  function answerFormHtml(which, phrase, closesAt) {
    const s = store.settings;
    return '<p class="wk-kicker">' + (which === "first" ? "Type this now" : "One more. Type this now") + "</p>" +
      '<p class="wk-phrase" id="wkPhraseShown">&ldquo;' + esc(phrase) + "&rdquo;</p>" +
      '<form class="stacked-form wk-answer" data-wk-answer="' + which + '" novalidate>' +
      '<div class="form-row"><label for="wkAnswer">Type the phrase above</label>' +
      '<input type="text" id="wkAnswer" class="wk-answer-input" maxlength="120" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-describedby="wkAnswerHint wkAnswerError"></div>' +
      '<p class="dc-error" id="wkAnswerError" role="alert"></p>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary">' + (which === "first" ? "Check in" : "Check in again") + "</button></div></form>" +
      '<p class="field-hint" id="wkAnswerHint">Closes at ' + esc(L.formatMs(closesAt)) + " &middot; " + countSpan(closesAt) + " left. " +
      (s.caseSensitive ? "Capital letters must match." : "Capital letters don't matter.") + " Pasting is off.</p>";
  }

  function statusHtml(v, now) {
    const s = store.settings;
    const next = v.next ? "<p class=\"wk-next\">Next check: " + esc(nextText(v.next, now)) + ".</p>" : "";
    if (v.mode === "off") {
      return '<p class="wk-big">Wake check is off</p><p class="field-hint">Set your alarm time and phrases below, then turn it on.</p>';
    }
    if (v.mode === "upcoming") {
      return '<p class="wk-kicker">Next check</p><p class="wk-big">Today at ' + esc(L.formatMs(v.wake)) + "</p>" +
        '<p class="wk-count-line">in ' + countSpan(v.wake) + "</p>" +
        '<p class="field-hint">When your Clock alarm rings, open JARVIS and type your phrase here. Typing before ' + esc(L.formatMs(v.wake)) + " won't count.</p>";
    }
    if (v.mode === "active" && v.state === "first") return answerFormHtml("first", s.phrase1, v.firstEnd);
    if (v.mode === "active" && v.state === "waiting") {
      return '<p class="wk-kicker">Stay up</p><p class="wk-big">Check-in opens at ' + esc(L.formatMs(v.due)) + "</p>" +
        '<p class="wk-count-line">in ' + countSpan(v.due) + "</p>" +
        '<p class="field-hint">You typed the first phrase at ' + esc(typedAt(store.days[v.dateKey].first)) + ". JARVIS can't ring or notify you for the check-in yet, so keep this screen open or set a timer on your iPhone for the time left.</p>";
    }
    if (v.mode === "active" && v.state === "second") return answerFormHtml("second", s.phrase2, v.secondEnd);
    if (v.mode === "complete") {
      const rec = store.days[v.dateKey];
      return '<p class="wk-kicker">This morning</p><p class="wk-big">Done</p>' +
        '<p class="field-hint">You typed both phrases (' + esc(typedAt(rec.first)) + " and " + esc(typedAt(rec.second)) + ").</p>" + next;
    }
    if (v.mode === "missed") {
      const why = v.reason === "first" ? "The first phrase wasn't typed before " + L.formatMs(v.firstEnd) + "." : "The check-in phrase wasn't typed before " + L.formatMs(v.secondEnd) + ".";
      return '<p class="wk-kicker">This morning</p><p class="wk-big">Missed</p><p class="field-hint">' + esc(why) + " It's recorded as missed, and tomorrow is a fresh start.</p>" + next;
    }
    return '<p class="wk-big">No check today</p>' + (v.next ? "<p class=\"wk-next\">Next check: " + esc(nextText(v.next, now)) + ".</p>" : '<p class="field-hint">Pick the days you want below.</p>');
  }

  const ANNOUNCE = {
    first: "Type your first phrase now.", waiting: "First phrase recorded. The check-in opens soon.", second: "Type your check-in phrase now.",
    complete: "Both phrases typed. Done for this morning.", missed: "This morning was missed."
  };

  function signature(v) {
    const rec = v.dateKey ? store.days[v.dateKey] : null;
    return [v.mode, v.state || "", v.dateKey || "", v.next ? v.next.dateKey : "", store.settings.updatedAt || "", rec ? (rec.first || "") + (rec.second || "") : ""].join("|");
  }

  /* ---------------- drawing ---------------- */

  function dayCell(d) {
    const p = d.dateKey.split("-").map(Number);
    const words = { complete: "both phrases typed", missed: "missed", pending: "still to come or in progress", rest: "no check scheduled" };
    const sym = { complete: "✓", missed: "✕", pending: "…", rest: "–" };
    const label = DAY_SHORT[d.weekday] + " " + MONTHS[p[1] - 1] + " " + p[2];
    return '<li class="wk-day wk-day-' + d.status + '" aria-label="' + esc(label + ": " + words[d.status]) + '">' +
      '<span class="wk-day-name" aria-hidden="true">' + DAY_SHORT[d.weekday] + '</span><span class="wk-day-num" aria-hidden="true">' + p[2] + "</span>" +
      '<span class="wk-day-sym" aria-hidden="true">' + sym[d.status] + "</span></li>";
  }

  function renderHistory(now) {
    const st = L.streaks(store, now);
    const box = function (n, label) { return '<div class="stat-box"><span class="stat-value">' + n + '</span> <span class="stat-label">' + label + "</span></div>"; };
    const many = function (n, one, other) { return n === 1 ? one : other; };
    $("wkStats").innerHTML = [box(st.current, many(st.current, "morning in a row", "mornings in a row")), box(st.best, "best run"), box(st.total, many(st.total, "morning completed", "mornings completed"))].join(" ");
    $("wkDays").innerHTML = L.recent(store, now, 14).map(dayCell).join("");
  }

  function render(v, now) {
    const b = badgeFor(v);
    $("wkBadge").className = "badge " + b.cls;
    $("wkBadge").textContent = b.text;
    const before = sig;
    sig = signature(v);
    $("wkStatus").innerHTML = statusHtml(v, now);
    renderHistory(now);
    const say = v.mode === "active" ? ANNOUNCE[v.state] : ANNOUNCE[v.mode];
    if (say && before !== sig) $("wkAnnounce").textContent = say;
  }

  function updateCounts(now) {
    document.querySelectorAll("#wkStatus .wk-count").forEach(function (el) {
      el.textContent = L.countdownText(Number(el.getAttribute("data-wk-to")) - now);
    });
  }

  function updateStrip(v, now) {
    const strip = $("wkStrip");
    const show = v.mode === "active" && (v.state === "first" || v.state === "second");
    strip.classList.toggle("hidden", !show);
    if (!show) return;
    $("wkStripText").textContent = (v.state === "first" ? "Type your first phrase" : "Time for the check-in phrase") + ". " + L.countdownText((v.state === "first" ? v.firstEnd : v.secondEnd) - now) + " left.";
  }

  function habitsOpen() { const h = $("panel-habits"); return !!h && h.classList.contains("active"); }
  function wakeOpen() { const p = $("habits-wake"); return habitsOpen() && !!p && p.classList.contains("active"); }

  // Once a second while Habits is on screen: keep the countdowns and the strip current, and redraw the card only when
  // what it says changes (so what you're typing isn't wiped).
  function tick() {
    if (!store || document.visibilityState === "hidden" || !habitsOpen()) return;
    const now = Date.now();
    const v = L.view(store, now);
    updateStrip(v, now);
    if (!wakeOpen()) return;
    if (signature(v) !== sig) render(v, now);
    updateCounts(now);
  }

  /* ---------------- typing a phrase ---------------- */

  function handleAnswer(e) {
    const form = e.target.closest("form[data-wk-answer]");
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector("input");
    const err = $("wkAnswerError");
    const r = L.answer(store, form.getAttribute("data-wk-answer"), input.value, Date.now());
    if (!r.ok) {
      err.textContent = r.error;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      tick(); // the window may have just opened or closed
      return;
    }
    store = r.store;
    save();
    const now = Date.now();
    const v = L.view(store, now);
    render(v, now);
    updateStrip(v, now);
    core().showToast(r.state === "complete" ? "Both done. " + L.streaks(store, now).current + " in a row." : "Recorded. The check-in opens at " + L.formatMs(v.due) + ".");
  }

  function blockPaste(e) {
    if (!e.target.closest(".wk-answer-input")) return;
    e.preventDefault();
    const err = $("wkAnswerError");
    if (err) err.textContent = "Pasting is off here. Type it.";
  }

  /* ---------------- set up ---------------- */

  function setSwitch(btn, on) { btn.setAttribute("aria-checked", String(on)); }
  function isOn(btn) { return btn.getAttribute("aria-checked") === "true"; }

  function drawDayPills() {
    $("wkDayPills").innerHTML = DAY_ORDER.map(function (d) {
      const on = formDays.indexOf(d) !== -1;
      return '<button type="button" class="wk-day-pill" data-wk-day="' + d + '" aria-pressed="' + on + '" aria-label="' + L.WEEKDAYS[d] + '">' + DAY_SHORT[d] + "</button>";
    }).join("");
  }

  function fillForm() {
    const s = store.settings;
    setSwitch($("wkEnabled"), s.enabled);
    $("wkTime").value = s.time;
    formDays = s.days.slice();
    drawDayPills();
    $("wkPhrase1").value = s.phrase1;
    $("wkPhrase2").value = s.phrase2;
    $("wkDelay").value = s.delay;
    $("wkWindow").value = s.window;
    setSwitch($("wkStrict"), s.caseSensitive);
    showError("");
  }

  const FIELD_ID = { time: "wkTime", days: "wkDayPills", phrase1: "wkPhrase1", phrase2: "wkPhrase2", delay: "wkDelay", window: "wkWindow" };
  function showError(msg, field) {
    $("wkError").textContent = msg || "";
    Object.keys(FIELD_ID).forEach(function (k) {
      const el = $(FIELD_ID[k]);
      if (msg && k === field) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "wkError"); } else { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }
    });
    if (msg && field) {
      const target = field === "days" ? $("wkDayPills").querySelector("button") : $(FIELD_ID[field]);
      if (target) target.focus();
    }
  }

  function handleSave(e) {
    e.preventDefault();
    const input = {
      enabled: isOn($("wkEnabled")), time: $("wkTime").value, days: formDays.slice(), phrase1: $("wkPhrase1").value, phrase2: $("wkPhrase2").value,
      delay: $("wkDelay").value === "" ? NaN : Number($("wkDelay").value), window: $("wkWindow").value === "" ? NaN : Number($("wkWindow").value),
      caseSensitive: isOn($("wkStrict"))
    };
    const checked = L.validateSettings(input);
    if (!checked.ok) { showError(checked.error, checked.field); return; }
    showError("");
    const was = store.settings.enabled;
    store = L.applySettings(store, checked.settings, Date.now());
    save();
    fillForm();
    const now = Date.now();
    render(L.view(store, now), now);
    updateStrip(L.view(store, now), now);
    core().showToast(!store.settings.enabled ? "Saved. Wake check is off." : was ? "Saved." : "Saved. Wake check is on.");
  }

  function handleFormClick(e) {
    const pill = e.target.closest("[data-wk-day]");
    if (pill) {
      const d = Number(pill.getAttribute("data-wk-day"));
      const at = formDays.indexOf(d);
      if (at === -1) formDays.push(d); else formDays.splice(at, 1);
      pill.setAttribute("aria-pressed", String(at === -1));
      return;
    }
    const sw = e.target.closest(".dc-switch");
    if (sw) setSwitch(sw, !isOn(sw));
  }

  /* ---------------- start ---------------- */

  function init() {
    if (started || !L || !$("habits-wake")) return;
    started = true;
    load();
    fillForm();
    const now = Date.now();
    const v = L.view(store, now);
    render(v, now);
    updateStrip(v, now);
    $("wkStatus").addEventListener("submit", handleAnswer);
    $("wkStatus").addEventListener("paste", blockPaste);
    $("wkStatus").addEventListener("drop", blockPaste);
    $("wkStatus").addEventListener("input", function (e) {
      if (!e.target.classList.contains("wk-answer-input")) return;
      $("wkAnswerError").textContent = "";
      e.target.removeAttribute("aria-invalid");
    });
    $("wkForm").addEventListener("submit", handleSave);
    $("wkForm").addEventListener("click", handleFormClick);
    $("wkStripOpen").addEventListener("click", function () { $("habitsSubNavWake").click(); });
    ["navBtnHabits", "habitsSubNavWake", "habitsSubNavToday"].forEach(function (id) { $(id).addEventListener("click", function () { window.setTimeout(tick, 0); }); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { load(); tick(); } });
    window.setInterval(tick, 1000);
  }

  window.JarvisWakeCheck = { init: init };
})();
