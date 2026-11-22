/* ==========================================================================
   JARVIS — Meal Prep (Nutrition › Meal Prep): the shell.

   One screen with four tabs (Weekly Plan, Recipes, Grocery List, Prep Tracker) under a small overview. It owns almost no data:

     recipes, the week plan, the grocery list and the pantry are the ones Nutrition and Groceries already keep (js/nutrition.js and
     js/groceries.js hand out copies and take changes through their APIs, so there is one of each, with one set of rules);
     what is new is saved here, in three keys that are in the cloud backup:
       jarvisMealPrepBatches   prepared food: portions left, where it is kept, use-by date
       jarvisMealPrepSessions  shopping / cooking / portioning / reminder times (each is also ONE Calendar event)
       jarvisMealPrepPrefs     which meal habits you track, the tab you were on

   The tabs are in mealprep-plan-ui.js, mealprep-recipes-ui.js, mealprep-grocery-ui.js and mealprep-tracker-ui.js. Each registers
   itself here with a draw function and handlers; this file draws the overview and the tabs, passes taps to the right one, and gives
   them the small kit they share (saving with rollback, Undo, sheets). The rules are in mealprep-logic.js.

   Nothing is reported as done unless it was saved: if the browser refuses a write, the change is taken back and the problem is shown.
   ========================================================================== */

(function () {
  "use strict";

  const L = window.JarvisMealPrepLogic;
  const KEYS = { batches: "jarvisMealPrepBatches", sessions: "jarvisMealPrepSessions", prefs: "jarvisMealPrepPrefs" };
  const TABS = [["plan", "Weekly Plan"], ["recipes", "Recipes"], ["grocery", "Grocery List"], ["tracker", "Prep Tracker"]];
  const UNDO_MS = 9000, TOMBSTONE_MS = 30 * 86400000;

  const panes = {};                 // name -> { render(), click(act, el, e), change(act, el, e), input(act, el, e), after() }
  let root = null, started = false, undoTimer = null, suppressClickUntil = 0;
  const ui = { tab: "plan", open: {} };

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === null || s === undefined ? "" : s)); }
  function now() { return Date.now(); }
  function today() { return core().todayISODate(); }
  function uid(p) { return core().uid(p); }
  function N() { return window.JarvisNutrition || null; }
  function G() { return window.JarvisGroceries && window.JarvisGroceries.api ? window.JarvisGroceries.api : null; }
  function A() { return window.JarvisPlanApp || null; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function num(n) { return Number(n).toLocaleString("en-US"); }

  /* ---------------- small saved lists (batches, sessions) ---------------- */

  // A list of records with ids, saved whole. A removed record is marked (deletedAt) for 30 days so the removal reaches another device.
  function makeStore(key) {
    let list = [], bad = false;
    return {
      load: function () {
        bad = false;
        const v = core().loadJSON(key, []);
        list = Array.isArray(v) ? v.filter(function (x) { return x && typeof x === "object" && typeof x.id === "string"; }) : [];
        const t = now(), kept = list.filter(function (x) { return !(x.deletedAt && t - x.deletedAt > TOMBSTONE_MS); });
        if (kept.length !== list.length) { list = kept; core().saveJSON(key, list); }
      },
      all: function () { return list.filter(function (x) { return !x.deletedAt; }); },
      raw: function () { return list.slice(); },
      find: function (id) { return list.filter(function (x) { return x.id === id && !x.deletedAt; })[0] || null; },
      // next: the whole list as it should be. false (and nothing changed) if the browser refused.
      replace: function (next) {
        const prev = list;
        list = next;
        if (!core().saveJSON(key, list)) { list = prev; return false; }
        return true;
      },
      markDeleted: function (id) {
        const t = now();
        return this.replace(list.map(function (x) { return x.id === id ? Object.assign({}, x, { deletedAt: t, updatedAt: t }) : x; }));
      }
    };
  }
  const batchStore = makeStore(KEYS.batches), sessionStore = makeStore(KEYS.sessions);
  let prefs = { tab: "plan", habits: {}, updatedAt: 0 };
  function loadPrefs() {
    const v = core().loadJSON(KEYS.prefs, null);
    if (v && typeof v === "object") prefs = { tab: TABS.some(function (t) { return t[0] === v.tab; }) ? v.tab : "plan", habits: v.habits && typeof v.habits === "object" ? v.habits : {}, updatedAt: Number(v.updatedAt) || 0 };
  }
  function savePrefs(patch) {
    const prev = prefs;
    prefs = Object.assign({}, prefs, patch, { updatedAt: now() });
    if (!core().saveJSON(KEYS.prefs, prefs)) { prefs = prev; return false; }
    return true;
  }

  /* ---------------- what the other modules hold (copies) ---------------- */

  function recipes() { const n = N(); return n && n.recipes ? n.recipes.all() : []; }
  function recipeById(id) { return recipes().filter(function (r) { return r.id === id; })[0] || null; }
  function plan() { const g = G(); return g ? g.plan() : []; }
  function routines() { const v = core().loadJSON("jarvisRoutines", []); return Array.isArray(v) ? v : []; }
  function logged(date) { const n = N(); try { return n && n.log ? n.log.totals(date) : null; } catch (e) { return null; } }
  function targets() { const n = N(); try { return n && n.log ? n.log.targets() : null; } catch (e) { return null; } }

  // Saves a changed plan (and with it the grocery list). Returns the result; shows the problem if it failed.
  function commitPlan(next) {
    const g = G();
    if (!g) return { ok: false, error: "The meal plan isn't available right now." };
    const r = g.commitPlan(next);
    if (!r.ok) toast(r.error);
    return r;
  }
  // Prepared portions cover planned meals, so the grocery list is brought up to date after any change to them.
  function commitBatches(next) { if (batchStore.replace(next)) { const g = G(); if (g && g.refresh) g.refresh(); return true; } toast("That couldn't be saved. The browser may be full or blocking storage."); return false; }
  function commitSessions(next) { if (sessionStore.replace(next)) return true; toast("That couldn't be saved. The browser may be full or blocking storage."); return false; }

  /* ---------------- messages ---------------- */

  function toast(text) { core().showToast(text); }
  function say(text) { const e = $("mpLive"); if (e) { e.textContent = ""; window.setTimeout(function () { e.textContent = text; }, 30); } }
  // A bar at the bottom of the screen with one button (Undo), for 9 seconds.
  function undo(text, fn) {
    const bar = $("mpUndo");
    if (!bar) return;
    window.clearTimeout(undoTimer);
    bar.innerHTML = '<span class="mp-undo-text">' + esc(text) + '</span><button type="button" class="btn btn-secondary" data-mp-undo>Undo</button>';
    bar.classList.remove("hidden");
    bar._fn = fn;
    say(text + " Undo is available for a few seconds.");
    undoTimer = window.setTimeout(hideUndo, UNDO_MS);
  }
  function hideUndo() { const bar = $("mpUndo"); window.clearTimeout(undoTimer); if (bar) { bar.classList.add("hidden"); bar.innerHTML = ""; bar._fn = null; } }

  /* ---------------- the overview ---------------- */

  function nextSession() {
    const t = today();
    return sessionStore.all().filter(function (s) { return s.date >= t && !s.doneAt; }).sort(function (a, b) { return a.date + (a.time || "") < b.date + (b.time || "") ? -1 : 1; })[0] || null;
  }
  const KIND_LABELS = { shopping: "Grocery shopping", cooking: "Cooking session", portioning: "Portioning", reminder: "Reminder" };
  function prettyDay(date, opts) { return L.isDate(date) ? new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8)).toLocaleDateString("en-US", opts || { weekday: "short", month: "short", day: "numeric" }) : ""; }
  function timeLabel(t) { if (!L.isTime(t)) return ""; const h = Number(t.slice(0, 2)); return ((h + 11) % 12 + 1) + ":" + t.slice(3) + (h < 12 ? " AM" : " PM"); }
  function sessionWhen(s) { return (s.date === today() ? "Today" : prettyDay(s.date)) + (s.time ? " " + timeLabel(s.time) : ""); }

  // What the overview, and the Health screen's card, show. Read only.
  function overview() {
    const t = today(), day = L.dayPlan(plan(), recipes(), t), lg = logged(t), tg = targets(), ns = nextSession();
    const batches = batchStore.all(), left = L.portionsLeft(batches, t);
    const soon = batches.filter(function (b) { const s = L.batchState(b, t); return s.level === "soon" || s.level === "today" || s.level === "past"; }).length;
    return { date: t, meals: day.items.length, eaten: day.eaten, planned: day.totals, withoutNumbers: day.withoutNumbers, estimated: day.anyEstimated, logged: lg, targets: tg, next: ns, portions: left, useSoon: soon };
  }
  function overviewHtml() {
    const o = overview();
    const nextTxt = o.next ? esc(KIND_LABELS[o.next.kind] || "Prep") + '<small>' + esc(sessionWhen(o.next)) + '</small>' : 'None scheduled<small>Plan one in the Prep Tracker</small>';
    return '<section class="card mp-overview" aria-label="Meal prep today">' +
      '<div class="mp-stat"><span class="mp-stat-k">Today’s meals</span><span class="mp-stat-v">' + (o.meals ? o.eaten + ' of ' + o.meals + ' eaten' : 'None planned') + '</span></div>' +
      '<div class="mp-stat"><span class="mp-stat-k">Planned protein</span><span class="mp-stat-v">' + (o.meals && o.planned.protein ? num(Math.round(o.planned.protein)) + ' g' : '—') + (o.targets && o.targets.protein > 0 ? '<small>target ' + num(o.targets.protein) + ' g</small>' : '') + '</span></div>' +
      '<div class="mp-stat"><span class="mp-stat-k">Next prep session</span><span class="mp-stat-v">' + nextTxt + '</span></div>' +
      '<div class="mp-stat"><span class="mp-stat-k">Prepared portions</span><span class="mp-stat-v">' + o.portions + ' ' + plural(o.portions, 'portion') + ' left' + (o.useSoon ? '<small>' + o.useSoon + ' to use soon</small>' : '') + '</span></div>' +
      '</section>';
  }

  /* ---------------- drawing ---------------- */

  function tabsHtml() {
    return '<div class="mp-tabs" role="tablist" aria-label="Meal prep sections">' + TABS.map(function (t) {
      const on = ui.tab === t[0];
      return '<button type="button" role="tab" class="mp-tab' + (on ? ' is-on' : '') + '" id="mpTab_' + t[0] + '" aria-selected="' + on + '" aria-controls="mpPane" tabindex="' + (on ? 0 : -1) + '" data-mp="mp:tab" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
    }).join("") + '</div>';
  }
  // <details> cards remember whether they are open between redraws: key, default open
  function isOpen(key, dflt) { return key in ui.open ? ui.open[key] : !!dflt; }
  function openAttr(key, dflt) { return isOpen(key, dflt) ? " open" : ""; }

  function render(opts) {
    if (!root) return;
    const o = opts || {}, y = window.pageYOffset;
    let body = "";
    try { body = panes[ui.tab] ? panes[ui.tab].render() : ""; } catch (e) { body = '<div class="card"><p class="field-hint">This tab could not be drawn. Nothing was changed.</p></div>'; if (window.console) console.error("Meal Prep: " + ui.tab, e); }
    root.innerHTML = overviewHtml() + tabsHtml() + '<div id="mpPane" role="tabpanel" aria-labelledby="mpTab_' + ui.tab + '" class="mp-pane">' + body + '</div>';
    if (panes[ui.tab] && panes[ui.tab].after) { try { panes[ui.tab].after(root); } catch (e) { /* the tab's own extras are optional */ } }
    if (!o.keepScroll) window.scrollTo(0, y);
    if (o.focus) { const f = root.querySelector(o.focus); if (f) f.focus({ preventScroll: true }); }
  }
  function refresh(opts) { if (started && panelActive()) render(opts); }
  function panelActive() { const p = $("nutrition-mealprep"); return !!(p && p.classList.contains("active")); }
  function setTab(tab, focus) {
    if (!panes[tab]) return;
    ui.tab = tab; savePrefs({ tab: tab });
    render({ keepScroll: false });
    if (focus) { const b = $("mpTab_" + tab); if (b) b.focus(); }
  }

  /* ---------------- taps ---------------- */

  function onClick(e) {
    if (Date.now() < suppressClickUntil) { e.preventDefault(); return; }
    const u = e.target.closest ? e.target.closest("[data-mp-undo]") : null;
    if (u) { const bar = $("mpUndo"), fn = bar && bar._fn; hideUndo(); if (fn) fn(); return; }
    const el = e.target.closest ? e.target.closest("[data-mp]") : null;
    if (!el || el.tagName === "SELECT" || el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "button") return;
    const parts = el.getAttribute("data-mp").split(":"), pane = parts[0], act = parts.slice(1).join(":");
    if (pane === "mp") { if (act === "tab") setTab(el.getAttribute("data-tab")); return; }
    if (panes[pane] && panes[pane].click) panes[pane].click(act, el, e);
  }
  function onChange(e) {
    const el = e.target.closest ? e.target.closest("[data-mp]") : null;
    if (!el) return;
    const parts = el.getAttribute("data-mp").split(":"), pane = parts[0], act = parts.slice(1).join(":");
    if (panes[pane] && panes[pane].change) panes[pane].change(act, el, e);
  }
  function onInput(e) {
    const el = e.target.closest ? e.target.closest("[data-mp]") : null;
    if (!el) return;
    const parts = el.getAttribute("data-mp").split(":"), pane = parts[0], act = parts.slice(1).join(":");
    if (panes[pane] && panes[pane].input) panes[pane].input(act, el, e);
  }
  function onKeydown(e) {
    const tab = e.target.closest ? e.target.closest(".mp-tab") : null;
    if (tab && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End")) {
      const i = TABS.findIndex(function (t) { return t[0] === ui.tab; });
      const j = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
      e.preventDefault(); setTab(TABS[j][0], true); return;
    }
    const pane = panes[ui.tab];
    if (pane && pane.key) pane.key(e);
  }
  // A <details> that was opened or closed by hand is remembered.
  function onToggle(e) {
    const d = e.target;
    if (d && d.tagName === "DETAILS" && d.getAttribute("data-open-key")) ui.open[d.getAttribute("data-open-key")] = d.open;
  }

  /* ---------------- starting ---------------- */

  // A pane registers when its script loads: { render(): html, click(act, el, e), change, input, key(e), after(root) }
  function register(name, p) { panes[name] = p; }

  function onShow() { if (!started) return; render({ keepScroll: true }); }

  function init() {
    root = $("mpRoot");
    if (!root || started) return;
    batchStore.load(); sessionStore.load(); loadPrefs();
    ui.tab = panes[prefs.tab] ? prefs.tab : "plan";
    started = true;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKeydown);
    root.addEventListener("toggle", onToggle, true);
    const bar = $("mpUndo"); if (bar) bar.addEventListener("click", onClick);
    // Things that change the data from other screens redraw this one if it is showing.
    ["jarvis-nutrition-changed", "jarvis-habits-changed", "jarvis-tasks-changed", "jarvis-calendar-changed"].forEach(function (ev) { document.addEventListener(ev, function () { if (panelActive() && !document.querySelector(".sp-sheet-overlay")) render({ keepScroll: true }); }); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh({ keepScroll: true }); });
    Object.keys(panes).forEach(function (k) { if (panes[k].init) { try { panes[k].init(); } catch (e) { if (window.console) console.error("Meal Prep: " + k + " failed to start", e); } } });
    if (panelActive()) render();
  }

  window.JarvisMealPrep = {
    init: init, onShow: onShow, register: register, overview: overview,
    open: function (tab) { const b = $("navBtnNutrition"); if (b) b.click(); const s = $("nutritionSubNavMealPrep"); if (s) s.click(); if (tab) setTab(tab); },
    kit: {
      L: L, $: $, esc: esc, now: now, today: today, uid: uid, plural: plural, num: num, ui: ui, isOpen: isOpen, openAttr: openAttr,
      N: N, G: G, A: A, recipes: recipes, recipeById: recipeById, plan: plan, routines: routines, logged: logged, targets: targets, commitPlan: commitPlan,
      batches: batchStore, sessions: sessionStore, commitBatches: commitBatches, commitSessions: commitSessions, prefs: function () { return prefs; }, savePrefs: savePrefs,
      toast: toast, say: say, undo: undo, hideUndo: hideUndo, render: render, refresh: refresh, setTab: setTab,
      prettyDay: prettyDay, timeLabel: timeLabel, sessionWhen: sessionWhen, nextSession: nextSession, KIND_LABELS: KIND_LABELS,
      suppressClicks: function (ms) { suppressClickUntil = Date.now() + ms; }
    }
  };
})();
