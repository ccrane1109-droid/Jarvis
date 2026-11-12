/* ==========================================================================
   JARVIS — Learning & Research Hub: the shell (navigation between its sections, the helpers every section
   shares) and the Dashboard.

   The sections are separate files that register themselves here:
     learning-books-ui.js     Books (list, detail)
     learning-research-ui.js  Research (list, detail)
     learning-library-ui.js   Knowledge (searchable library) and the note editor every section uses
     learning-actions-ui.js   Action Center
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
  const TABS = [["dashboard", "Dashboard"], ["books", "Books"], ["research", "Research"], ["knowledge", "Knowledge"], ["actions", "Actions"], ["review", "Review"]];
  const views = {};
  const DEFAULT_FILTERS = { books: { sort: "recent" }, research: { sort: "recent" }, knowledge: { sort: "newest" }, actions: { sort: "date" } };
  // What is open: which section, and (for a detail page) which record. Filters are remembered while the app is open.
  const state = {
    tab: "dashboard", id: "",
    filters: { books: { sort: "recent" }, research: { sort: "recent" }, knowledge: { sort: "newest" }, actions: { sort: "date" } },
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

  /* ---------------- navigation ---------------- */

  function register(name, view) { views[name] = view; }
  function go(tab, id, extra) {
    state.tab = tab; state.id = id || "";
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
      const on = b.getAttribute("data-ln") === state.tab;
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
    host.innerHTML = integrityBanner() + view.html();
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
  // If something stored couldn't be read, say so on every screen: that list is hidden and is never saved over.
  function integrityBanner() {
    const names = { books: "Books", research: "Research", notes: "Notes", actions: "Actions", reviews: "Weekly reviews" };
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
      go(goEl.getAttribute("data-go"), goEl.getAttribute("data-id") || "", note ? { openNote: note, replaceFilters: Object.assign({}, DEFAULT_FILTERS[goEl.getAttribute("data-go")] || {}) } : { openNote: "" });
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
  function savePage(form) {
    const id = form.getAttribute("data-id"), b = store.get("books", id);
    if (!b) return;
    const raw = form.elements.page.value.trim();
    const n = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    const bad = isNaN(n) ? "Enter a page number." : (b.totalPages > 0 && n > b.totalPages) ? "That's past the last page (" + b.totalPages + ")." : "";
    if (bad) { showErrors(form, { page: bad }); return; }
    if (n === b.currentPage) { say("Still on page " + n + "."); return; }
    const today = store.today(), now = Date.now();
    let next = L.withPage(b, n, today, now);
    if ((b.status === "want" || b.status === "paused") && n > b.currentPage) next = Object.assign(next, { status: "reading", startDate: b.startDate || today });
    if (!store.put("books", next)) { saveFailed(); return; }
    const last = next.totalPages > 0 && n >= next.totalPages;
    if (last && next.status === "reading") notice("You reached the last page of " + next.title + ".", "Mark completed", function () { setBookStatus(next.id, "completed"); });
    else say(next.title + ": page " + n + (L.progress(next) !== null ? ", " + L.progress(next) + " percent" : "") + ".");
  }
  function setBookStatus(id, status) {
    const b = store.get("books", id);
    if (!b || b.status === status) return;
    if (!store.put("books", L.withStatus(b, status, store.today(), Date.now()))) { saveFailed(); return; }
    say(b.title + ": " + L.labelOf(L.BOOK_STATUS, status) + ".");
  }
  function setActionStatus(id, status) {
    const a = store.get("actions", id);
    if (!a || a.status === status) return;
    if (!store.put("actions", L.withActionStatus(a, status, store.today(), Date.now()))) { saveFailed(); return; }
    say("Marked " + L.labelOf(L.ACTION_STATUS, status).toLowerCase() + ".");
  }

  const shared = {
    click: function (act, el) {
      if (act === "status-book") { setBookStatus(el.getAttribute("data-id"), el.getAttribute("data-v")); return true; }
      if (act === "status-action") { setActionStatus(el.getAttribute("data-id"), el.getAttribute("data-v")); return true; }
      if (act.indexOf("note-") === 0 || act === "tag-filter") return api.noteClick ? api.noteClick(act, el) : false;
      if (act.indexOf("action-") === 0) return api.actionClick ? api.actionClick(act, el) : false;
      if (act === "clear-filters") { state.filters[state.tab] = Object.assign({}, DEFAULT_FILTERS[state.tab] || {}); render(false); return true; }
      if (act === "quick-add") { const f = api.quickAdd[el.getAttribute("data-kind")]; if (f) f(); return true; }
      return false;
    },
    submit: function (form) {
      if (form.getAttribute("data-form") === "page") { savePage(form); return true; }
      return false;
    }
  };

  /* ---------------- Dashboard ---------------- */

  const dashboard = {
    html: function () {
      const S = store.state(), st = L.stats(S), today = store.today();
      const stat = function (n, label, tab, filters) {
        return '<button type="button" class="ln-stat" data-go="' + tab + '" data-filters=\'' + esc(JSON.stringify(filters || {})) + '\' data-stat="' + label + '"><span class="ln-stat-n">' + n + '</span><span class="ln-stat-l">' + esc(label) + '</span></button>';
      };
      let h = '<h2 class="visually-hidden" data-focus-top>Dashboard</h2>' +
        '<div class="ln-stats">' + stat(st.booksReading, "Books reading", "books", { status: "reading" }) + stat(st.activeResearch, "Active research", "research", { active: true }) +
        stat(st.takeaways, "Key takeaways", "knowledge", { type: "takeaway" }) + stat(st.implemented, "Ideas implemented", "actions", { status: "done" }) + '</div>' +
        '<div class="ln-quick" role="group" aria-label="Add something">' +
        '<button type="button" class="btn btn-secondary" data-act="quick-add" data-kind="book">+ Book</button><button type="button" class="btn btn-secondary" data-act="quick-add" data-kind="research">+ Research</button>' +
        '<button type="button" class="btn btn-secondary" data-act="quick-add" data-kind="note">+ Note</button><button type="button" class="btn btn-secondary" data-act="quick-add" data-kind="action">+ Action</button></div>';

      h += '<div class="ln-cols">';
      const books = L.currentBooks(S);
      h += '<section class="card ln-card" aria-labelledby="lnDashBooks"><div class="card-title-row"><h2 class="card-title" id="lnDashBooks">Current books</h2><button type="button" class="btn-icon" data-go="books">All books</button></div>';
      h += books.length ? '<div class="ln-list">' + books.slice(0, 6).map(function (b) {
        return '<div class="ln-item"><button type="button" class="ln-item-open" data-go="books" data-id="' + esc(b.id) + '">' + coverHtml(b, "ln-cover-sm") +
          '<span class="ln-item-main"><span class="ln-item-title">' + esc(b.title) + '</span><span class="ln-item-sub">' + esc(b.author || "No author") + '</span>' + barHtml(L.progress(b), b.title + ": " + L.progress(b) + "% read") +
          '<span class="ln-item-sub">' + esc(progressText(b) || "No page logged yet") + '</span></span></button>' + pageForm(b) + '</div>';
      }).join("") + '</div>' : '<p class="empty-state-compact">No book in progress. Add one, or set a book on your list to Reading.</p>';
      h += '</section>';

      const res = L.activeResearch(S);
      h += '<section class="card ln-card" aria-labelledby="lnDashRes"><div class="card-title-row"><h2 class="card-title" id="lnDashRes">Active research</h2><button type="button" class="btn-icon" data-go="research">All research</button></div>';
      h += res.length ? '<div class="ln-list">' + res.slice(0, 5).map(function (r) {
        return '<button type="button" class="ln-item ln-item-open ln-item-flat" data-go="research" data-id="' + esc(r.id) + '"><span class="ln-item-main"><span class="ln-item-title">' + esc(r.title) + '</span>' +
          '<span class="ln-badges">' + statusBadge(r.status, L.labelOf(L.RESEARCH_STATUS, r.status)) + prioBadge(r.priority) + (r.sources.length ? badge("neutral", plural(r.sources.length, "source")) : "") + '</span>' +
          (r.question ? '<span class="ln-item-sub">' + esc(snippet(r.question, 110)) + '</span>' : "") + '</span></button>';
      }).join("") + '</div>' : '<p class="empty-state-compact">No research under way. Start a project to keep its question, sources and findings together.</p>';
      h += '</section>';

      const notes = L.recentNotes(S, 5);
      h += '<section class="card ln-card" aria-labelledby="lnDashNotes"><div class="card-title-row"><h2 class="card-title" id="lnDashNotes">Recent notes</h2><button type="button" class="btn-icon" data-go="knowledge">Knowledge library</button></div>';
      h += notes.length ? '<div class="ln-list">' + notes.map(function (n) {
        return '<button type="button" class="ln-item ln-item-open ln-item-flat" data-go="knowledge" data-open-note="' + esc(n.id) + '"><span class="ln-item-main"><span class="ln-badges">' + badge("accent", L.labelOf(L.NOTE_TYPE, n.type)) +
          (n.important ? badge("yellow", "Starred") : "") + '</span><span class="ln-item-title ln-clamp">' + esc(snippet(n.title || n.text, 140)) + '</span><span class="ln-item-sub">' + esc(noteSource(n)) + '</span></span></button>';
      }).join("") + '</div>' : '<p class="empty-state-compact">No notes yet. Capture a takeaway while you read, or a finding while you research.</p>';
      h += '</section>';

      const up = L.upcomingActions(S, 5, today);
      h += '<section class="card ln-card" aria-labelledby="lnDashAct"><div class="card-title-row"><h2 class="card-title" id="lnDashAct">Upcoming learning tasks</h2><button type="button" class="btn-icon" data-go="actions">Action center</button></div>';
      h += up.length ? '<div class="ln-list">' + up.map(function (a) {
        return '<div class="ln-item"><div class="ln-item-main"><span class="ln-item-title">' + esc(snippet(a.lesson, 120)) + '</span><span class="ln-badges">' + statusBadge(a.status, L.labelOf(L.ACTION_STATUS, a.status)) +
          (a.targetDate ? (a.overdue ? badge("red", "Overdue · " + fmtShort(a.targetDate)) : badge("neutral", "Due " + fmtShort(a.targetDate))) : "") + '</span></div>' +
          '<div class="ln-item-btns">' + (a.status === "todo" ? '<button type="button" class="btn btn-secondary" data-act="status-action" data-id="' + esc(a.id) + '" data-v="doing">Start</button>' : "") +
          '<button type="button" class="btn btn-secondary" data-act="status-action" data-id="' + esc(a.id) + '" data-v="done">Implemented</button></div></div>';
      }).join("") + '</div>' : '<p class="empty-state-compact">Nothing waiting. When you learn something worth acting on, add it to the Action Center.</p>';
      h += '</section></div>';
      return h;
    },
    click: function () { return false; }
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
    state.filters[tab] = Object.assign({}, DEFAULT_FILTERS[tab] || {}, f);
  }

  function init() {
    if (started || !L || !store) return;
    const host = $("lnView");
    if (!host) return;
    started = true;
    store.init();
    register("dashboard", dashboard);
    host.addEventListener("click", function (e) { applyFilterPresets(e); onClick(e); });
    host.addEventListener("submit", onSubmit);
    host.addEventListener("input", function (e) {
      if (e.target.hasAttribute("data-filter")) { if (e.target.type === "search") onFilter(e.target); return; }
      const v = views[state.tab]; if (v && v.input) v.input(e.target, e);
    });
    host.addEventListener("change", function (e) {
      if (e.target.hasAttribute("data-filter")) { if (e.target.type !== "search") onFilter(e.target); return; }   // the search box already updated while typing; redrawing again on blur would swallow a tap on what is beside it
      const v = views[state.tab]; if (v && v.change) v.change(e.target, e);
    });
    host.addEventListener("toggle", function (e) {
      const id = e.target && e.target.getAttribute && e.target.getAttribute("data-keep");
      if (id) { if (e.target.open) state.open[id] = true; else delete state.open[id]; }
    }, true);
    Array.prototype.forEach.call(document.querySelectorAll("#panel-learning .ln-sub-nav .sub-nav-btn"), function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-ln"), "", { replaceFilters: state.filters[b.getAttribute("data-ln")] }); });
    });
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
    setBookStatus: setBookStatus, setActionStatus: setActionStatus,
    quickAdd: {}
  };
  window.JarvisLearning = api;
})();
