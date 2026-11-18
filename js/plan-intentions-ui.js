/* ==========================================================================
   JARVIS — Weekly Intentions (Strategy › Weekly).

   Two cards for the week the planner is showing: three things to start or do more of (a box to tick) and three things to stop
   (a Monday–Sunday row to mark the days you avoided them), a two-question reflection, and a folded history of earlier weeks.
   Every change is saved as it is made (a short pause after typing), in the plan's own storage (jarvisPlanIntentions). The rules
   are in intentions-logic.js; this file draws and listens. It is drawn by the Weekly screen (plan-week-ui.js), and changes are
   written into the page in place, so nothing you are typing is ever redrawn.
   ========================================================================== */

(function () {
  "use strict";

  const L = window.JarvisIntentionsLogic, A = window.JarvisPlanApp, PL = window.JarvisPlanLogic;
  if (!L || !A || !PL) return;
  const store = A.store, esc = A.esc;
  const SAVE_DELAY = 500;
  const DO_HINTS = ["Read every morning", "Work on my business", "Follow my daily routine"];
  const STOP_HINTS = ["Excessive scrolling", "Procrastinating", "Staying up too late"];
  const timers = {};
  let savedTimer = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function rangeLabel(ws) { return A.fmtShort(ws) + " – " + A.fmtShort(PL.addDays(ws, 6)); }

  /* ---------------- drawing ---------------- */

  function barHtml(pct, label, key) {
    if (pct === null) return '<span class="wi-bar" data-wi-bar="' + key + '" aria-hidden="true"><span style="width:0%"></span></span>';
    return '<span class="wi-bar' + (pct >= 100 ? " is-full" : "") + '" data-wi-bar="' + key + '" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, pct) + '"><span style="width:' + Math.min(100, pct) + '%"></span></span>';
  }
  function doText(p) { return p.doFilled ? p.doDone + " of " + p.doFilled + " done" : "Write your three to begin"; }
  function stopText(p) { return p.stopFilled ? p.stopMarked + " of " + p.stopTotal + " days avoided" : "Write what you want to stop"; }

  function doRow(x, i) {
    return '<li class="wi-row' + (x.done && x.text ? " is-done" : "") + '" data-wi-row="do-' + i + '">' +
      '<label class="wi-check"><input type="checkbox" data-wi="do-done" data-i="' + i + '"' + (x.done ? " checked" : "") + (x.text ? "" : " disabled") + ' aria-label="' + esc(x.text ? "Done: " + x.text : "Done: thing " + (i + 1) + " (write it first)") + '"></label>' +
      '<textarea class="wi-text" rows="1" data-wi="do-text" data-i="' + i + '" maxlength="' + L.TEXT_MAX + '" placeholder="e.g. ' + esc(DO_HINTS[i]) + '" aria-label="Thing ' + (i + 1) + ' I want to do this week" autocomplete="off">' + esc(x.text) + '</textarea></li>';
  }
  function dayButton(x, i, d, ws, today) {
    const date = PL.addDays(ws, d), future = date > today, on = x.days[d];
    return '<button type="button" class="wi-day' + (on ? " is-on" : "") + (date === today ? " is-today" : "") + '" data-wi="stop-day" data-i="' + i + '" data-d="' + d + '" aria-pressed="' + on + '"' + (future || !x.text ? " disabled" : "") +
      ' aria-label="' + esc(L.DAY_NAMES[d] + " " + A.fmtShort(date) + ": avoided " + (x.text || "thing " + (i + 1))) + '"><span class="wi-day-l" aria-hidden="true">' + L.DAY_LETTERS[d] + '</span><span class="wi-day-m" aria-hidden="true">&#10003;</span></button>';
  }
  function stopRow(x, i, ws, today) {
    let days = "";
    for (let d = 0; d < L.DAYS; d++) days += dayButton(x, i, d, ws, today);
    return '<li class="wi-row wi-stop" data-wi-row="stop-' + i + '"><div class="wi-stop-top">' +
      '<textarea class="wi-text" rows="1" data-wi="stop-text" data-i="' + i + '" maxlength="' + L.TEXT_MAX + '" placeholder="e.g. ' + esc(STOP_HINTS[i]) + '" aria-label="Thing ' + (i + 1) + ' I want to stop this week" autocomplete="off">' + esc(x.text) + '</textarea>' +
      '<span class="wi-count" data-wi-count="' + i + '">' + x.days.filter(Boolean).length + '/7</span></div>' +
      '<div class="wi-days" role="group" aria-label="Days I avoided: ' + esc(x.text || "thing " + (i + 1)) + '" data-wi-days="' + i + '">' + days + '</div></li>';
  }

  function historyHtml() {
    const weeks = L.history(store.all("intentions"), store.today());
    let h = '<details class="wi-history"><summary class="wi-history-s">History <span class="sp-dim">' + (weeks.length ? plural(weeks.length, "week") : "none yet") + '</span></summary>';
    if (!weeks.length) return h + '<p class="sp-dim wi-note">An earlier week is saved here when a new week begins.</p></details>';
    h += '<ul class="wi-hist">' + weeks.map(function (w) {
      const p = w.progress, bits = [];
      if (p.doFilled) bits.push("To do " + p.doDone + " of " + p.doFilled);
      if (p.stopFilled) bits.push("Avoided " + p.stopMarked + " of " + p.stopTotal);
      const doList = w.doItems.filter(function (x) { return x.text; }).map(function (x) { return '<li><span class="wi-hmark" aria-hidden="true">' + (x.done ? "&#10003;" : "&#9675;") + '</span><span class="visually-hidden">' + (x.done ? "Done: " : "Not done: ") + '</span>' + esc(x.text) + '</li>'; }).join("");
      const stopList = w.stopItems.filter(function (x) { return x.text; }).map(function (x) { return '<li>' + esc(x.text) + ' <span class="sp-dim">' + plural(x.days.filter(Boolean).length, "day") + ' of 7 avoided</span></li>'; }).join("");
      return '<li><details class="wi-hweek"><summary><span class="wi-hweek-d">' + esc(rangeLabel(w.weekStart)) + '</span><span class="wi-hweek-s">' + esc(bits.join(" · ") || "Reflection only") + '</span></summary><div class="wi-hweek-b">' +
        (doList ? '<h5 class="wi-hweek-h">Things I wanted to do</h5><ul class="wi-hlist">' + doList + '</ul>' : "") +
        (stopList ? '<h5 class="wi-hweek-h">Things I wanted to stop</h5><ul class="wi-hlist">' + stopList + '</ul>' : "") +
        (w.wentWell.trim() ? '<h5 class="wi-hweek-h">What I did well</h5><p class="wi-hnote">' + esc(w.wentWell) + '</p>' : "") +
        (w.improve.trim() ? '<h5 class="wi-hweek-h">What I should improve</h5><p class="wi-hnote">' + esc(w.improve) + '</p>' : "") + '</div></details></li>';
    }).join("") + '</ul></details>';
    return h;
  }

  // The whole section for the week starting ws (a Monday).
  function html(ws) {
    store.init();
    const today = store.today();
    if (store.blocked("intentions")) {
      return '<section class="wi" aria-labelledby="wiTitle"><div class="wi-head"><h3 class="sp-h3" id="wiTitle">Weekly Intentions</h3></div><p class="sp-dim">Something saved for Weekly Intentions could not be read, so it isn’t shown and nothing will be saved over it.</p></section>';
    }
    const v = L.view(store.all("intentions"), ws, today), p = v.progress;
    let h = '<section class="wi" aria-labelledby="wiTitle" data-wi-week="' + esc(ws) + '"><div class="wi-head"><h3 class="sp-h3" id="wiTitle">Weekly Intentions</h3><span class="wi-saved" data-wi-saved role="status" aria-live="polite"></span></div>';
    h += '<div class="wi-cards">';
    h += '<div class="wi-card" role="group" aria-labelledby="wiDoT"><h4 class="wi-card-h" id="wiDoT">3 things I want to do this week</h4>' +
      '<div class="wi-prog"><span class="wi-prog-t" data-wi-prog="do">' + doText(p) + '</span>' + barHtml(p.doPct, "Things I want to do", "do") + '</div><ul class="wi-list">' + v.doItems.map(doRow).join("") + '</ul></div>';
    h += '<div class="wi-card" role="group" aria-labelledby="wiStopT"><h4 class="wi-card-h" id="wiStopT">3 things I want to stop doing this week</h4>' +
      '<div class="wi-prog"><span class="wi-prog-t" data-wi-prog="stop">' + stopText(p) + '</span>' + barHtml(p.stopPct, "Days I avoided the things I want to stop", "stop") + '</div><ul class="wi-list">' + v.stopItems.map(function (x, i) { return stopRow(x, i, ws, today); }).join("") + '</ul></div>';
    h += '</div>';
    h += '<div class="wi-card wi-reflect" role="group" aria-labelledby="wiRefT"><h4 class="wi-card-h" id="wiRefT">Weekly reflection</h4>' +
      '<label class="wi-q" for="wiWell">What did I do well this week?</label><textarea id="wiWell" class="wi-area" data-wi="reflect" data-f="wentWell" rows="3" maxlength="' + L.NOTE_MAX + '">' + esc(v.wentWell) + '</textarea>' +
      '<label class="wi-q" for="wiImprove">What should I improve next week?</label><textarea id="wiImprove" class="wi-area" data-wi="reflect" data-f="improve" rows="3" maxlength="' + L.NOTE_MAX + '">' + esc(v.improve) + '</textarea></div>';
    h += historyHtml() + '</section>';
    return h;
  }

  /* ---------------- changing the page in place ---------------- */

  function paint(root) {
    const ws = root.getAttribute("data-wi-week"), v = L.view(store.all("intentions"), ws, store.today()), p = v.progress;
    v.doItems.forEach(function (x, i) {
      const row = $('[data-wi-row="do-' + i + '"]', root); if (!row) return;
      row.classList.toggle("is-done", !!(x.done && x.text));
      const cb = $('[data-wi="do-done"]', row);
      cb.checked = x.done; cb.disabled = !x.text;
      cb.setAttribute("aria-label", x.text ? "Done: " + x.text : "Done: thing " + (i + 1) + " (write it first)");
    });
    v.stopItems.forEach(function (x, i) {
      const row = $('[data-wi-row="stop-' + i + '"]', root); if (!row) return;
      const g = $('[data-wi-days="' + i + '"]', row);
      g.setAttribute("aria-label", "Days I avoided: " + (x.text || "thing " + (i + 1)));
      Array.prototype.forEach.call(g.querySelectorAll(".wi-day"), function (b) {
        const d = Number(b.getAttribute("data-d")), date = PL.addDays(ws, d), on = x.days[d];
        b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
        b.disabled = date > store.today() || !x.text;
        b.setAttribute("aria-label", L.DAY_NAMES[d] + " " + A.fmtShort(date) + ": avoided " + (x.text || "thing " + (i + 1)));
      });
      $('[data-wi-count="' + i + '"]', row).textContent = x.days.filter(Boolean).length + "/7";
    });
    const set = function (key, text, pct, label) {
      const t = $('[data-wi-prog="' + key + '"]', root), bar = $('[data-wi-bar="' + key + '"]', root);
      if (t) t.textContent = text;
      if (!bar) return;
      const fill = bar.firstElementChild;
      if (fill) fill.style.width = (pct === null ? 0 : Math.min(100, pct)) + "%";
      bar.classList.toggle("is-full", pct !== null && pct >= 100);
      if (pct === null) { bar.removeAttribute("role"); bar.removeAttribute("aria-valuenow"); bar.setAttribute("aria-hidden", "true"); }
      else { bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", label); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100"); bar.setAttribute("aria-valuenow", String(Math.min(100, pct))); bar.removeAttribute("aria-hidden"); }
    };
    set("do", doText(p), p.doPct, "Things I want to do");
    set("stop", stopText(p), p.stopPct, "Days I avoided the things I want to stop");
  }
  function flash(root, text) {
    const el = $("[data-wi-saved]", root);
    if (!el) return;
    window.clearTimeout(savedTimer);
    el.textContent = text;
    savedTimer = window.setTimeout(function () { el.textContent = ""; }, 1800);
  }
  // Put the section back as it is in storage (after a change that could not be kept).
  function redraw(root) {
    const ws = root.getAttribute("data-wi-week"), box = document.createElement("div");
    box.innerHTML = html(ws);
    if (box.firstElementChild) root.replaceWith(box.firstElementChild);
    sizeAll();
  }

  /* ---------------- saving ---------------- */

  function commit(root, change) {
    const ws = root.getAttribute("data-wi-week");
    const r = L.update(store.all("intentions"), ws, change, { today: store.today() });
    if (!r.ok) { A.notice(r.error || "That couldn't be changed.", ""); paint(root); return false; }
    if (!store.replace("intentions", r.records)) { A.saveFailed(); redraw(root); return false; }
    paint(root);
    flash(root, "Saved");
    return true;
  }
  function textChange(el) {
    const kind = el.getAttribute("data-wi"), i = Number(el.getAttribute("data-i"));
    if (kind === "do-text") return { type: "doText", index: i, text: el.value };
    if (kind === "stop-text") return { type: "stopText", index: i, text: el.value };
    return { type: "reflection", field: el.getAttribute("data-f"), text: el.value };
  }
  // Nothing to save when the box already holds what is stored (so just tapping into a box never writes anything).
  function unchanged(root, el) {
    const v = L.view(store.all("intentions"), root.getAttribute("data-wi-week"), store.today()), kind = el.getAttribute("data-wi"), i = Number(el.getAttribute("data-i"));
    const clean = String(el.value).replace(/\s+/g, " ").trim().slice(0, L.TEXT_MAX);
    if (kind === "do-text") return v.doItems[i].text === clean;
    if (kind === "stop-text") return v.stopItems[i].text === clean;
    return v[el.getAttribute("data-f")] === String(el.value).replace(/\r\n?/g, "\n").slice(0, L.NOTE_MAX);
  }
  function key(el) { return [el.getAttribute("data-wi"), el.getAttribute("data-i") || el.getAttribute("data-f")].join(":"); }
  function saveText(el) {
    window.clearTimeout(timers[key(el)]); delete timers[key(el)];
    const root = el.closest("[data-wi-week]");
    if (!root || !document.contains(el) || unchanged(root, el)) return;
    commit(root, textChange(el));
  }

  function inSection(e) {
    const el = e.target;
    return el && el.getAttribute && el.getAttribute("data-wi") && el.closest("[data-wi-week]") ? el : null;
  }
  // The word boxes wrap and grow to show everything written in them (a phone is narrow).
  function autosize(el) {
    if (!el.classList.contains("wi-text")) return;
    el.style.height = "auto";
    el.style.height = Math.max(44, el.scrollHeight + 2) + "px";
  }
  function sizeAll() { Array.prototype.forEach.call(document.querySelectorAll(".wi .wi-text"), autosize); }
  window.addEventListener("resize", sizeAll);
  document.addEventListener("input", function (e) {
    const el = inSection(e);
    if (!el || !/-text$|^reflect$/.test(el.getAttribute("data-wi"))) return;
    autosize(el);
    window.clearTimeout(timers[key(el)]);
    timers[key(el)] = window.setTimeout(function () { saveText(el); }, SAVE_DELAY);
  });
  // leaving a box (or pressing Enter) saves at once, and so does changing weeks or leaving the page
  document.addEventListener("change", function (e) {
    const el = inSection(e);
    if (!el) return;
    const kind = el.getAttribute("data-wi");
    if (kind === "do-done") { commit(el.closest("[data-wi-week]"), { type: "doDone", index: Number(el.getAttribute("data-i")), done: el.checked }); return; }
    if (/-text$|^reflect$/.test(kind)) saveText(el);
  });
  document.addEventListener("focusout", function (e) { const el = inSection(e); if (el && /-text$|^reflect$/.test(el.getAttribute("data-wi"))) saveText(el); });
  document.addEventListener("keydown", function (e) {
    const el = inSection(e);
    if (el && e.key === "Enter" && el.classList.contains("wi-text")) { e.preventDefault(); saveText(el); el.blur(); }
  });
  document.addEventListener("click", function (e) {
    const b = e.target.closest ? e.target.closest('[data-wi="stop-day"]') : null;
    if (!b || b.disabled || !b.closest("[data-wi-week]")) return;
    commit(b.closest("[data-wi-week]"), { type: "stopDay", index: Number(b.getAttribute("data-i")), day: Number(b.getAttribute("data-d")), value: b.getAttribute("aria-pressed") !== "true" });
  });
  function flushAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-wi-week] [data-wi="do-text"], [data-wi-week] [data-wi="stop-text"], [data-wi-week] [data-wi="reflect"]'), saveText);
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) flushAll(); });
  window.addEventListener("pagehide", flushAll);

  window.JarvisIntentionsUI = { html: html, after: sizeAll, flush: flushAll };
})();
