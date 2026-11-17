/* ==========================================================================
   JARVIS — Learning & Research Hub: the shell (the four tabs, the + Add and More menus, the helpers every
   screen shares).

   Four tabs: Overview, Books, Research, Notes. Everything else is still here, one step further in:
     Notes tab        Notes | Flashcards | Actions
     More menu (...)  Learning goals, Weekly review, Topics, Collections, Review schedule, Review history
   The screens are separate files that register themselves here:
     learning-overview-ui.js  Overview and the Log reading form
     learning-books-ui.js     Books (list, detail)
     learning-reading-ui.js   Books > History, the reading timer
     learning-research-ui.js  Research (list, detail)
     learning-library-ui.js   Notes (searchable list) and the note editor every screen uses
     learning-study-ui.js     Flashcards and reviews
     learning-actions-ui.js   Actions
     learning-goals-ui.js     Learning goals
     learning-review-ui.js    Weekly Learning Review
   A section is { html(), after(host), click(act, el, ev), input(el), change(el), submit(form, ev) } and is drawn into
   #lnView; one click/submit listener here hands events to the open section. All the rules (what counts as progress, how
   the weekly figures are worked out, what is a valid book) are in learning-logic.js; the saving is in learning-store.js.

   Every number on these screens is counted from the records you entered. Nothing is estimated or filled in.
   ========================================================================== */

(function () {
  "use strict";

  const L = window.JarvisLearningLogic;
  const store = window.JarvisLearningStore;
  const views = {};
  // The four tabs. Each screen belongs to one of them (a screen is named by its view: "knowledge" is the Notes list, "study" the Flashcards).
  const PARENT = { overview: "overview", goals: "overview", review: "overview", books: "books", research: "research", knowledge: "notes", study: "notes", actions: "notes" };
  const HOME = { overview: "overview", books: "books", research: "research", notes: "knowledge" };
  const ALIAS = { dashboard: "overview", notes: "knowledge" };
  // The words for a book's status (the stored values don't change).
  const BOOK_WORDS = { want: "To read", reading: "Reading", completed: "Finished", paused: "Paused" };
  const NOTES_SEG = [["knowledge", "Notes"], ["study", "Flashcards"], ["actions", "Actions"]];
  const DEFAULT_FILTERS = { books: { sort: "recent" }, research: { sort: "recent" }, knowledge: { sort: "newest" }, actions: { sort: "date" }, study: { sort: "newest" } };
  // What is open: which section, and (for a detail page) which record. Filters are remembered while the app is open.
  const state = {
    tab: "overview", id: "",
    filters: { books: { sort: "recent" }, research: { sort: "recent" }, knowledge: { sort: "newest" }, actions: { sort: "date" }, study: { sort: "newest" } },
    week: "", openNote: "", open: {}
  };
  function filtersActive(tab) {
    const f = state.filters[tab] || {}, d = DEFAULT_FILTERS[tab] || {};
    return Object.keys(f).some(function (k) { return f[k] !== "" && f[k] !== undefined && f[k] !== false && f[k] !== d[k]; });
  }
  let started = false, shown = false, sheet = null, undoTimer = null, renderQueued = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.JarvisCore.escapeHtml(s == null ? "" : String(s)); }

  /* ---------------- small display helpers ---------------- */

  function fmtDate(d) {
    if (!L.isDate(d)) return "";
    return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtShort(d) { return L.isDate(d) ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function snippet(text, n) { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; }

  function badge(cls, text) { return '<span class="badge badge-' + cls + '">' + esc(text) + '</span>'; }
  const STATUS_BADGE = { want: "neutral", reading: "accent", completed: "green", paused: "yellow", planned: "neutral", researching: "accent", analyzing: "yellow", todo: "neutral", doing: "accent", done: "green" };
  function statusBadge(status, label) { return badge(STATUS_BADGE[status] || "neutral", label); }
  function prioBadge(p) { return badge(p === "high" ? "red" : p === "medium" ? "yellow" : "neutral", L.labelOf(L.PRIORITY, p) + " priority"); }

  function hue(text) { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360; return h; }
  function initials(title) { const w = String(title || "?").replace(/[^A-Za-z0-9À-￿ ]+/g, " ").trim().split(/\s+/).filter(Boolean); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : "")).toUpperCase(); }
  // A book's cover: the picture you gave it, or a plain tile with its initials.
  function coverHtml(book, cls) {
    if (book.cover && L.coverOk(book.cover)) return '<img class="ln-cover ' + (cls || "") + '" src="' + book.cover + '" alt="" width="60" height="90">';
    return '<div class="ln-cover ln-cover-ph ' + (cls || "") + '" style="--h:' + hue(book.title || "") + '" aria-hidden="true">' + esc(initials(book.title)) + '</div>';
  }
  // A progress bar. pct null = unknown, so no bar is drawn.
  function barHtml(pct, label) {
    if (pct === null || pct === undefined) return "";
    return '<div class="ln-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' + esc(label || "Progress") + '"><span style="width:' + pct + '%"></span></div>';
  }
  function starsHtml(n) {
    if (!n) return "";
    return '<span class="ln-stars" role="img" aria-label="' + n + ' out of 5 stars">' + "★".repeat(n) + '<span class="ln-stars-off">' + "★".repeat(5 - n) + '</span></span>';
  }
  function progressText(b) {
    const p = L.progress(b);
    return p === null ? (b.currentPage > 0 ? "Page " + b.currentPage : "") : "Page " + b.currentPage + " of " + b.totalPages + " · " + p + "%";
  }

  // The words for a review schedule: "Due today", "Overdue by 3 days", "Next review Nov 14 (in 5 days)", "Paused", "Not in the schedule".
  function srsLabel(state) {
    const S = window.JarvisLearningSRS, w = S.when(state, store.today());
    if (w.kind === "off") return "Not in the review schedule";
    if (w.kind === "paused") return "Reviews paused";
    if (w.kind === "overdue") return "Overdue by " + plural(w.days, "day");
    if (w.kind === "today") return "Due today";
    return "Next review " + fmtShort(state.due) + " (in " + plural(w.days, "day") + ")";
  }
  // A small bar chart: items [{ label, value, title }]. Heights are relative to the biggest value; a zero is an empty slot, never a guess.
  function bars(items, aria, unit) {
    const max = items.reduce(function (m, x) { return Math.max(m, x.value); }, 0);
    return '<ul class="ln-bars" aria-label="' + esc(aria) + '">' + items.map(function (x) {
      const h = max > 0 && x.value > 0 ? Math.max(4, Math.round(x.value / max * 100)) : 0;
      return '<li class="ln-bars-col"><span class="ln-bars-track" aria-hidden="true"><span class="ln-bars-fill" style="height:' + h + '%"></span></span><span class="ln-bars-l" aria-hidden="true">' + esc(x.label) + '</span><span class="visually-hidden">' + esc(x.title || (x.label + ": " + x.value + (unit ? " " + unit : ""))) + '</span></li>';
    }).join("") + '</ul>';
  }

  function ctx() {
    return { today: store.today(), books: store.list("books"), research: store.list("research"), notes: store.list("notes"), actions: store.list("actions") };
  }
  function bookTitle(id) { const b = store.get("books", id); return b ? b.title : ""; }
  function researchTitle(id) { const r = store.get("research", id); return r ? r.title : ""; }

  /* ---------------- messages ---------------- */

  function say(text) { const e = $("lnLive"); if (e) { e.textContent = ""; window.setTimeout(function () { e.textContent = text || ""; }, 30); } }
  // A bar at the bottom with a message and (optionally) one button, for undoing a delete or following up.
  function notice(text, label, fn) {
    const bar = $("lnUndo");
    if (!bar) return;
    window.clearTimeout(undoTimer);
    bar.innerHTML = '<span class="ln-undo-text">' + esc(text) + '</span>' + (label ? '<button type="button" class="btn btn-secondary" data-ln-undo>' + esc(label) + '</button>' : "");
    bar.classList.remove("hidden");
    bar._fn = fn || null;
    say(text);
    undoTimer = window.setTimeout(function () { bar.classList.add("hidden"); bar._fn = null; }, 9000);
  }
  function hideNotice() { const bar = $("lnUndo"); if (bar) { bar.classList.add("hidden"); bar._fn = null; } window.clearTimeout(undoTimer); }
  function saveFailed() { notice(store.error() || "That couldn't be saved.", ""); }

  /* ---------------- form fields (used in sheets and in the sections) ---------------- */

  function rowHtml(name, label, control, o) {
    o = o || {};
    return '<div class="form-row' + (o.cls ? " " + o.cls : "") + '"><label for="lnf_' + name + '">' + esc(label) + (o.required ? ' <span class="ln-req" aria-hidden="true">*</span>' : "") + '</label>' + control +
      (o.hint ? '<p class="field-hint" id="lnh_' + name + '">' + esc(o.hint) + '</p>' : "") + '<p class="ln-err hidden" data-err="' + name + '" role="alert"></p></div>';
  }
  function fText(name, label, value, o) {
    o = o || {};
    return rowHtml(name, label, '<input type="' + (o.type || "text") + '" id="lnf_' + name + '" name="' + name + '" value="' + esc(value) + '"' + (o.max ? ' maxlength="' + o.max + '"' : "") +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") + (o.list ? ' list="' + o.list + '"' : "") + (o.mode ? ' inputmode="' + o.mode + '"' : "") + (o.min !== undefined ? ' min="' + o.min + '"' : "") +
      (o.hint ? ' aria-describedby="lnh_' + name + '"' : "") + ' autocomplete="off"' + (o.type === "url" ? ' autocapitalize="none" spellcheck="false"' : "") + '>', o);
  }
  function fArea(name, label, value, o) {
    o = o || {};
    return rowHtml(name, label, '<textarea id="lnf_' + name + '" name="' + name + '" rows="' + (o.rows || 4) + '"' + (o.max ? ' maxlength="' + o.max + '"' : "") + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") + (o.hint ? ' aria-describedby="lnh_' + name + '"' : "") + '>' + esc(value) + '</textarea>', o);
  }
  function fSelect(name, label, options, value, o) {
    return rowHtml(name, label, '<select id="lnf_' + name + '" name="' + name + '">' + options.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === value ? " selected" : "") + '>' + esc(x[1]) + '</option>'; }).join("") + '</select>', o);
  }
  function opts(list, blank) { return (blank ? [["", blank]] : []).concat(list.map(function (x) { return [x.key, x.label]; })); }
  function datalist(id, values) { return '<datalist id="' + id + '">' + values.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join("") + '</datalist>'; }

  // The search / filter / sort row at the top of a list. fields: [{ name, label, kind: "search" | "select", options, placeholder }]
  // Each control writes its value into state.filters[tab][name] (see onFilter). With opts.fold = n, the first n controls
  // stay in view and the rest fold away under "Filters" (which says how many are in use).
  function toolbar(tab, fields, opts) {
    const f = state.filters[tab] || {}, fold = opts && opts.fold ? opts.fold : fields.length;
    const one = function (x) {
      if (x.kind === "search") {
        return '<div class="ln-search"><label class="visually-hidden" for="lnq_' + tab + '">' + esc(x.label) + '</label><input type="search" id="lnq_' + tab + '" data-filter="' + x.name + '" data-fk="f_' + x.name + '" value="' + esc(f[x.name] || "") + '" placeholder="' + esc(x.placeholder || x.label) + '" autocomplete="off" autocapitalize="none" spellcheck="false"></div>';
      }
      return '<div class="ln-filter"><label class="visually-hidden" for="lnsel_' + tab + '_' + x.name + '">' + esc(x.label) + '</label><select id="lnsel_' + tab + '_' + x.name + '" data-filter="' + x.name + '" data-fk="f_' + x.name + '">' +
        x.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(f[x.name] || "") === o[0] ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select></div>';
    };
    let h = '<div class="ln-toolbar">' + fields.slice(0, fold).map(one).join("");
    if (fold < fields.length) {
      const folded = fields.slice(fold), used = folded.filter(function (x) { return x.name !== "sort" && f[x.name] && f[x.name] !== (DEFAULT_FILTERS[tab] || {})[x.name]; }).length;
      h += '<details class="ln-fold" data-keep="fold_' + tab + '"' + (state.open["fold_" + tab] || used ? " open" : "") + '><summary class="btn btn-secondary">Filters' + (used ? ' <span class="badge badge-accent">' + used + '</span>' : "") + '</summary><div class="ln-fold-body">' + folded.map(one).join("") + '</div></details>';
    }
    h += '<button type="button" class="btn btn-secondary ln-clear" data-act="clear-filters"' + (filtersActive(tab) ? "" : " hidden") + '>Clear filters</button>';
    return h + '</div>';
  }
  // A search or filter changed. Typing in the search box only redraws the results (so the box keeps its place);
  // a menu redraws the whole screen.
  function onFilter(el) {
    const name = el.getAttribute("data-filter"), tab = state.tab;
    state.filters[tab] = Object.assign({}, state.filters[tab]);
    state.filters[tab][name] = el.value;
    const view = views[tab], box = $("lnResults");
    if (el.type === "search" && view && view.results && box) {
      box.innerHTML = view.results();
      const c = $("lnResultCount");
      if (c && view.count) c.textContent = view.count();
      const clear = document.querySelector("#lnView .ln-clear");
      if (clear) clear.hidden = !filtersActive(tab);
    } else render(false);
  }

  // The values in a form, by field name: text as text, single checkboxes as true/false, checkboxes with data-multi as lists.
  function formValues(form) {
    const out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === "checkbox") {
        if (el.hasAttribute("data-multi")) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); } else out[el.name] = el.checked;
      } else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
    });
    return out;
  }
  function showErrors(root, errors, message) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-err]"), function (p) { p.textContent = ""; p.classList.add("hidden"); });
    const general = root.querySelector("[data-err-general]");
    if (general) { general.textContent = message || ""; general.classList.toggle("hidden", !message); }
    let first = null;
    Object.keys(errors || {}).forEach(function (k) {
      const p = root.querySelector('[data-err="' + k + '"]');
      if (p) { p.textContent = errors[k]; p.classList.remove("hidden"); }
      const f = root.querySelector('[name="' + k + '"]');
      if (f) { f.setAttribute("aria-invalid", "true"); if (!first) first = f; }
    });
    if (first) first.focus(); else if (message && general) general.focus();
  }

  /* ---------------- sheets: a form over the page ---------------- */

  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).filter(function (e) { return !e.disabled && e.offsetParent !== null; });
  }
  function onSheetKey(e) {
    if (!sheet) return;
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = focusables(sheet.el);
    if (!f.length) return;
    const at = f.indexOf(document.activeElement);
    if (e.shiftKey && (at <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (at === -1 || at === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  // A selector that finds the same button again after the screen has been redrawn (so focus can go back to it).
  function selectorFor(el) {
    if (!el || !el.getAttribute) return "";
    if (el.id) return "#" + el.id;
    let sel = el.tagName.toLowerCase(), any = false;
    ["data-act", "data-kind", "data-id", "data-type", "data-sid", "data-v", "data-go", "data-fk"].forEach(function (a) {
      const v = el.getAttribute(a);
      if (v !== null) { sel += "[" + a + '="' + v.replace(/"/g, '\\"') + '"]'; any = true; }
    });
    return any ? sel : "";
  }
  // o: { title, body (html), submit (label), wide, onSubmit(values, form) -> { ok: true } | { ok: false, errors, message }, onOpen(el), danger }
  function openSheet(o) {
    closeSheet();
    const el = document.createElement("div");
    el.className = "modal-overlay sheet-overlay ln-sheet-overlay";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "lnSheetTitle");
    el.innerHTML = '<div class="modal-box sheet-box ln-sheet"><div class="sheet-handle" aria-hidden="true"></div><h2 id="lnSheetTitle" class="ln-sheet-title" tabindex="-1">' + esc(o.title) + '</h2>' +
      '<form id="lnSheetForm" novalidate>' + (o.body || "") + '<p class="ln-err hidden" data-err-general role="alert" tabindex="-1"></p>' +
      '<div class="form-actions ln-sheet-actions">' + (o.submit ? '<button type="submit" class="btn ' + (o.danger ? "btn-danger" : "btn-primary") + '">' + esc(o.submit) + '</button>' : "") +
      '<button type="button" class="btn btn-secondary" data-ln-cancel>' + (o.submit ? "Cancel" : "Close") + '</button></div></form></div>';
    sheet = { el: el, opener: document.activeElement, sig: selectorFor(document.activeElement), o: o };
    document.body.appendChild(el);
    document.body.classList.add("ln-sheet-open");
    document.addEventListener("keydown", onSheetKey, true);
    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-ln-cancel]")) { closeSheet(); return; }
      const act = e.target.closest("[data-sheet-act]");
      if (act && o.onAct) o.onAct(act.getAttribute("data-sheet-act"), act, el);
    });
    el.addEventListener("change", function (e) { if (o.onChange) o.onChange(e.target, el); });
    el.addEventListener("input", function (e) { if (o.onInput) o.onInput(e.target, el); });
    el.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!o.onSubmit) { closeSheet(); return; }
      const form = e.target;
      Array.prototype.forEach.call(form.querySelectorAll("[aria-invalid]"), function (f) { f.removeAttribute("aria-invalid"); });
      const r = o.onSubmit(formValues(form), form);
      if (r && r.ok) closeSheet(true);
      else showErrors(el, r && r.errors, r && r.message);
    });
    if (o.onOpen) o.onOpen(el);
    window.setTimeout(function () {
      const first = o.focus ? el.querySelector(o.focus) : el.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea, select");
      (first || el.querySelector("#lnSheetTitle")).focus();
    }, 0);
    return el;
  }
  function closeSheet(saved) {
    if (!sheet) return;
    const s = sheet; sheet = null;
    document.removeEventListener("keydown", onSheetKey, true);
    document.body.classList.remove("ln-sheet-open");
    s.el.remove();
    if (s.o.onClose) s.o.onClose(!!saved);
    if (shown) render(false);          // what was saved while the form was open shows now
    window.setTimeout(function () {
      let back = s.opener;
      if (!(back && document.body.contains(back))) back = s.sig ? document.querySelector("#lnView " + s.sig) : null;
      if (!back) back = document.querySelector("#lnView [data-focus-top]");
      if (back && back.focus) { if (back.hasAttribute("data-focus-top")) back.setAttribute("tabindex", "-1"); back.focus(); }
    }, 0);
  }
  // A yes/no question in a sheet. onYes(values) may return nothing.
  function confirmSheet(o) {
    openSheet({ title: o.title, body: '<p>' + esc(o.text) + '</p>' + (o.extra || ""), submit: o.yes, danger: o.danger !== false, focus: ".btn-secondary", onSubmit: function (v) { o.onYes(v); return { ok: true }; } });
  }

  /* ---------------- the + Add and More menus ---------------- */

  // A list of choices in a sheet. rows: [{ key, label, minor }]. The sheet closes, then pick(key) runs.
  function openMenu(title, rows, pick, opener) {
    openSheet({
      title: title,
      body: '<div class="ln-menu" role="group" aria-label="' + esc(title) + '">' + rows.map(function (r) {
        return '<button type="button" class="ln-menu-item' + (r.minor ? " ln-menu-minor" : "") + '" data-sheet-act="' + esc(r.key) + '">' + esc(r.label) + '</button>';
      }).join("") + '</div>',
      focus: ".ln-menu-item",
      onAct: function (act) { closeSheet(); window.setTimeout(function () { pick(act); }, 0); }
    });
  }
  // What a new note should be attached to by default: the book or research project you have open.
  function contextPreset() {
    if (state.tab === "books" && state.id) return { bookIds: [state.id] };
    if (state.tab === "research" && state.id) return { researchIds: [state.id] };
    return {};
  }
  function openAddMenu() {
    openMenu("Add", [{ key: "book", label: "Book" }, { key: "research", label: "Research topic" }, { key: "note", label: "Note" }, { key: "card", label: "Flashcard", minor: true }, { key: "action", label: "Action idea", minor: true }], function (k) {
      const f = api.quickAdd[k];
      if (f) f();
    });
  }
  function openMoreMenu() {
    openMenu("More", [{ key: "goals", label: "Learning goals" }, { key: "review", label: "Weekly review" }, { key: "topics", label: "Topics" }, { key: "collections", label: "Collections" }, { key: "schedule", label: "Review schedule" }, { key: "history", label: "Review history" }], function (k) {
      if (k === "goals" || k === "review") go(k);
      else if (k === "topics" || k === "collections") { state.kpart = k; state.collId = ""; go("knowledge"); }
      else go("study", "", { part: k });
    });
  }

  /* ---------------- navigation ---------------- */

  function register(name, view) { views[name] = view; }
  function go(tab, id, extra) {
    tab = ALIAS[tab] || tab;
    state.tab = tab; state.id = id || "";
    if (state.study) state.study.part = extra && extra.part ? extra.part : (tab === "study" ? "cards" : state.study.part);
    if (extra && extra.openNote !== undefined) state.openNote = extra.openNote;
    if (extra && extra.filters) state.filters[tab] = Object.assign({}, state.filters[tab], extra.filters);
    if (extra && extra.replaceFilters) state.filters[tab] = extra.replaceFilters;
    render(true);
    if (extra && extra.noScroll) return;
    const panel = $("panel-learning");
    if (panel && panel.scrollIntoView && !(extra && extra.keepScroll)) window.scrollTo(0, 0);
  }

  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll("#panel-learning .ln-sub-nav .sub-nav-btn"), function (b) {
      const on = b.getAttribute("data-ln") === PARENT[state.tab];
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  // Draws the open section. Whatever had focus (if it says what it is with data-fk) gets it back afterwards.
  function render(focusTop) {
    const host = $("lnView");
    if (!host) return;
    const view = views[state.tab];
    if (!view) { host.innerHTML = ""; return; }
    const a = document.activeElement;
    const fk = !focusTop && a && host.contains(a) ? a.getAttribute("data-fk") : "";
    let sel = null;
    if (fk && a && typeof a.selectionStart === "number") sel = [a.selectionStart, a.selectionEnd];
    const back = backFor();
    host.innerHTML = integrityBanner() + (back ? '<div class="ln-back"><button type="button" class="btn-icon" data-act="ln-back">← ' + esc(back.label) + '</button></div>' : "") + view.html();
    syncTabs();
    if (view.after) view.after(host);
    if (fk) {
      const n = host.querySelector('[data-fk="' + fk + '"]');
      if (n) { n.focus(); if (sel && typeof n.setSelectionRange === "function") try { n.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
    } else if (focusTop) {
      const h = host.querySelector("[data-focus-top]");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    }
  }
  // Screens one step in from a tab (reached from the More menu) get a way back.
  function backFor() {
    if (state.tab === "goals" || state.tab === "review") return { label: "Overview", fn: function () { go("overview"); } };
    if (state.tab === "knowledge" && !state.openNote && !state.collId && (state.kpart === "topics" || state.kpart === "collections")) return { label: "Notes", fn: function () { state.kpart = "notes"; go("knowledge"); } };
    if (state.tab === "study" && state.study && !state.study.session && (state.study.part === "schedule" || state.study.part === "history")) return { label: "Flashcards", fn: function () { go("study", "", { part: "cards" }); } };
    return null;
  }
  // The small row that switches between the three parts of the Notes tab. Hidden while a review session is on.
  function notesSeg(active) {
    return '<div class="ln-pills" role="group" aria-label="Notes sections">' + NOTES_SEG.map(function (x) {
      return '<button type="button" class="ln-pill" data-go="' + x[0] + '" aria-pressed="' + (x[0] === active) + '">' + x[1] + '</button>';
    }).join("") + '</div>';
  }
  // If something stored couldn't be read, say so on every screen: that list is hidden and is never saved over.
  function integrityBanner() {
    const names = { books: "Books", research: "Research", notes: "Notes", actions: "Actions", reviews: "Weekly reviews", cards: "Flashcards", goals: "Goals", sessions: "Reading time", collections: "Collections" };
    const bad = store.KINDS.filter(function (k) { return store.blocked(k); });
    if (!bad.length) return "";
    return '<div class="ln-warn" role="alert"><strong>Some saved ' + esc(bad.map(function (k) { return names[k]; }).join(", ")) + ' could not be read.</strong> ' +
      'They are not shown, and nothing will be saved over them, so changes to ' + (bad.length > 1 ? "those lists" : "that list") + ' will not be kept until this is sorted out. Your other data is unaffected. ' + esc(store.blocked(bad[0])) + '</div>';
  }
  function renderSoon() {
    if (renderQueued || !shown || sheet) return;
    renderQueued = true;
    window.setTimeout(function () { renderQueued = false; if (shown) render(false); }, 0);
  }

  function onClick(e) {
    const goEl = e.target.closest("[data-go]");
    if (goEl) {
      e.preventDefault();
      const note = goEl.getAttribute("data-open-note") || "";
      if (goEl.getAttribute("data-go") === "knowledge") { state.kpart = "notes"; state.collId = ""; }
      const part = goEl.getAttribute("data-part");
      go(goEl.getAttribute("data-go"), goEl.getAttribute("data-id") || "", note ? { openNote: note, replaceFilters: Object.assign({}, DEFAULT_FILTERS[goEl.getAttribute("data-go")] || {}) } : (part ? { openNote: "", part: part } : { openNote: "" }));
      return;
    }
    const actEl = e.target.closest("[data-act]");
    if (!actEl) return;
    const act = actEl.getAttribute("data-act");
    if (shared.click(act, actEl, e)) return;
    const view = views[state.tab];
    if (view && view.click) view.click(act, actEl, e);
  }
  function onSubmit(e) {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    if (shared.submit(form)) return;
    const view = views[state.tab];
    if (view && view.submit) view.submit(form, e);
  }

  /* ---------------- things more than one section does ---------------- */

  // The quick "what page are you on?" form, on the Dashboard and the Books screens.
  function pageForm(b, cls) {
    return '<form class="ln-page-form ' + (cls || "") + '" data-form="page" data-id="' + esc(b.id) + '" novalidate>' +
      '<label class="visually-hidden" for="lnp_' + esc(b.id) + '">Current page of ' + esc(b.title) + '</label>' +
      '<input type="number" id="lnp_' + esc(b.id) + '" name="page" inputmode="numeric" min="0"' + (b.totalPages > 0 ? ' max="' + b.totalPages + '"' : "") + ' value="' + b.currentPage + '" data-fk="page_' + esc(b.id) + '">' +
      '<button type="submit" class="btn btn-secondary">Update page</button><p class="ln-err hidden" data-err="page" role="alert"></p></form>';
  }
  // A page number typed by hand -> { n } or { error }. Used by the page boxes and by the reading timer's "page you reached".
  function checkPage(b, raw) {
    const t = String(raw == null ? "" : raw).trim();
    const n = /^\d{1,6}$/.test(t) ? Number(t) : NaN;
    if (isNaN(n)) return { error: "Enter a page number." };
    if (b.totalPages > 0 && n > b.totalPages) return { error: "That's past the last page (" + b.totalPages + ")." };
    return { n: n };
  }
  // Records a new current page for a book through the one path every page update takes, so each page is counted once.
  // -> { ok, same, book } ; ok is false only when the save failed.
  function applyPage(b, n) {
    if (n === b.currentPage) return { ok: true, same: true, book: b };
    const today = store.today(), now = Date.now();
    let next = L.withPage(b, n, today, now);
    if ((b.status === "want" || b.status === "paused") && n > b.currentPage) next = Object.assign(next, { status: "reading", startDate: b.startDate || today });
    if (!store.put("books", next)) return { ok: false, book: b };
    return { ok: true, book: next };
  }
  function savePage(form) {
    const id = form.getAttribute("data-id"), b = store.get("books", id);
    if (!b) return;
    const c = checkPage(b, form.elements.page.value);
    if (c.error) { showErrors(form, { page: c.error }); return; }
    const n = c.n, res = applyPage(b, n);
    if (res.same) { say("Still on page " + n + "."); return; }
    if (!res.ok) { saveFailed(); return; }
    const next = res.book;
    const last = next.totalPages > 0 && n >= next.totalPages;
    if (last && next.status === "reading") notice("You reached the last page of " + next.title + ".", "Mark completed", function () { setBookStatus(next.id, "completed"); });
    else say(next.title + ": page " + n + (L.progress(next) !== null ? ", " + L.progress(next) + " percent" : "") + ".");
  }
  // One-tap progress: "+10" adds that many pages to where you are (never past the last page), through the same page log as typing a number.
  function quickPagesHtml(b) {
    if (b.status === "completed") return "";
    return '<div class="ln-quickpages" role="group" aria-label="Add pages to ' + esc(b.title) + '"><span class="ln-quickpages-l">Add pages</span>' +
      [5, 10, 25].map(function (k) { return '<button type="button" class="btn btn-secondary" data-act="page-add" data-id="' + esc(b.id) + '" data-n="' + k + '" aria-label="Add ' + k + ' pages to ' + esc(b.title) + '">+' + k + '</button>'; }).join("") + '</div>';
  }
  function quickPages(id, k) {
    const b = store.get("books", id);
    if (!b || !(k > 0)) return;
    let n = b.currentPage + k;
    if (b.totalPages > 0 && n > b.totalPages) n = b.totalPages;
    if (n === b.currentPage) { say("Already on the last page."); return; }
    const before = b, res = applyPage(b, n);
    if (!res.ok) { saveFailed(); return; }
    const next = res.book;
    if (next.totalPages > 0 && n >= next.totalPages && next.status === "reading") notice("You reached the last page of " + next.title + ".", "Mark completed", function () { setBookStatus(next.id, "completed"); });
    else notice(next.title + ": page " + n + " (+" + (n - before.currentPage) + ").", "Undo", function () { store.put("books", before); });
  }
  function setBookStatus(id, status) {
    const b = store.get("books", id);
    if (!b || b.status === status) return;
    if (!store.put("books", L.withStatus(b, status, store.today(), Date.now()))) { saveFailed(); return; }
    say(b.title + ": " + (BOOK_WORDS[status] || status) + ".");
  }
  function setActionStatus(id, status) {
    const a = store.get("actions", id);
    if (!a || a.status === status) return;
    if (!store.put("actions", L.withActionStatus(a, status, store.today(), Date.now()))) { saveFailed(); return; }
    say("Marked " + L.labelOf(L.ACTION_STATUS, status).toLowerCase() + ".");
  }

  const shared = {
    click: function (act, el) {
      if (api.acts[act]) { api.acts[act](el, act); return true; }
      if (act === "page-add") { quickPages(el.getAttribute("data-id"), Number(el.getAttribute("data-n"))); return true; }
      if (act === "status-book") { setBookStatus(el.getAttribute("data-id"), el.getAttribute("data-v")); return true; }
      if (act === "status-action") { setActionStatus(el.getAttribute("data-id"), el.getAttribute("data-v")); return true; }
      if (act.indexOf("note-") === 0 || act === "tag-filter") return api.noteClick ? api.noteClick(act, el) : false;
      if (act.indexOf("action-") === 0) return api.actionClick ? api.actionClick(act, el) : false;
      if (act === "clear-filters") { state.filters[state.tab] = Object.assign({}, DEFAULT_FILTERS[state.tab] || {}); render(false); return true; }
      if (act === "quick-add") { const f = api.quickAdd[el.getAttribute("data-kind")]; if (f) f(); return true; }
      if (act === "ln-back") { const b = backFor(); if (b) b.fn(); return true; }
      return false;
    },
    submit: function (form) {
      if (form.getAttribute("data-form") === "page") { savePage(form); return true; }
      return false;
    }
  };

  // Where a note came from, in words: its book(s), project(s).
  function noteSource(n) {
    const parts = [];
    (n.bookIds || []).forEach(function (id) { const t = bookTitle(id); if (t) parts.push(t); });
    (n.researchIds || []).forEach(function (id) { const t = researchTitle(id); if (t) parts.push(t); });
    return parts.join(" · ") || "Not linked to a book or project";
  }

  /* ---------------- start ---------------- */

  function applyFilterPresets(e) {
    // Tapping a dashboard number opens that list already filtered; this reads the preset from the button.
    const el = e.target.closest("[data-filters]");
    if (!el || !el.getAttribute("data-go")) return;
    let f = {};
    try { f = JSON.parse(el.getAttribute("data-filters")) || {}; } catch (x) { f = {}; }
    const tab = el.getAttribute("data-go");
    if (tab === "knowledge") state.kpart = "notes";
    state.filters[tab] = Object.assign({}, DEFAULT_FILTERS[tab] || {}, f);
  }

  function init() {
    if (started || !L || !store) return;
    const host = $("lnView");
    if (!host) return;
    started = true;
    store.init();
    host.addEventListener("click", function (e) { applyFilterPresets(e); onClick(e); });
    host.addEventListener("submit", onSubmit);
    host.addEventListener("input", function (e) {
      if (e.target.hasAttribute("data-filter")) { if (e.target.type === "search") onFilter(e.target); return; }
      const v = views[state.tab]; if (v && v.input) v.input(e.target, e);
    });
    host.addEventListener("change", function (e) {
      if (e.target.hasAttribute("data-status-book")) { setBookStatus(e.target.getAttribute("data-id"), e.target.value); return; }
      if (e.target.hasAttribute("data-status-action")) { setActionStatus(e.target.getAttribute("data-id"), e.target.value); return; }
      if (e.target.hasAttribute("data-filter")) { if (e.target.type !== "search") onFilter(e.target); return; }   // the search box already updated while typing; redrawing again on blur would swallow a tap on what is beside it
      const v = views[state.tab]; if (v && v.change) v.change(e.target, e);
    });
    host.addEventListener("toggle", function (e) {
      const id = e.target && e.target.getAttribute && e.target.getAttribute("data-keep");
      if (id) { if (e.target.open) state.open[id] = true; else delete state.open[id]; }
    }, true);
    Array.prototype.forEach.call(document.querySelectorAll("#panel-learning .ln-sub-nav .sub-nav-btn"), function (b) {
      b.addEventListener("click", function () {
        const name = b.getAttribute("data-ln");
        let to = HOME[name];
        if (name === "notes" && state.study && state.study.session) to = "study";      // a review in progress is where the Notes tab opens
        if (name === "notes") { state.kpart = "notes"; state.collId = ""; }
        go(to, "", { replaceFilters: state.filters[to] });
      });
    });
    const add = $("lnAdd"), more = $("lnMore");
    if (add) add.addEventListener("click", openAddMenu);
    if (more) more.addEventListener("click", openMoreMenu);
    const bar = $("lnUndo");
    if (bar) bar.addEventListener("click", function (e) {
      if (!e.target.closest("[data-ln-undo]")) return;
      const fn = bar._fn; hideNotice();
      if (fn) fn();
    });
    store.subscribe(function () { renderSoon(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet) hideNotice(); });
  }

  function onShow() {
    if (!started) init();
    if (!started) return;
    shown = true;
    render(false);
  }
  function onHide() { shown = false; }

  const api = {
    init: init, onShow: onShow, onHide: onHide, register: register, go: go, render: function () { render(false); },
    esc: esc, L: L, store: store, state: state, ctx: ctx,
    fmtDate: fmtDate, fmtShort: fmtShort, plural: plural, snippet: snippet, badge: badge, statusBadge: statusBadge, prioBadge: prioBadge,
    coverHtml: coverHtml, barHtml: barHtml, starsHtml: starsHtml, progressText: progressText, pageForm: pageForm, noteSource: noteSource,
    say: say, notice: notice, saveFailed: saveFailed,
    fText: fText, fArea: fArea, fSelect: fSelect, rowHtml: rowHtml, opts: opts, datalist: datalist, formValues: formValues, showErrors: showErrors,
    toolbar: toolbar, filtersActive: filtersActive, DEFAULT_FILTERS: DEFAULT_FILTERS,
    openSheet: openSheet, closeSheet: closeSheet, confirmSheet: confirmSheet,
    setBookStatus: setBookStatus, setActionStatus: setActionStatus, checkPage: checkPage, applyPage: applyPage, quickPagesHtml: quickPagesHtml, srsLabel: srsLabel, bars: bars,
    BOOK_WORDS: BOOK_WORDS, notesSeg: notesSeg, contextPreset: contextPreset, openMenu: openMenu, openAddMenu: openAddMenu, openMoreMenu: openMoreMenu,
    quickAdd: {}, acts: {}
  };
  window.JarvisLearning = api;
})();
