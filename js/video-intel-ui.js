/* ==========================================================================
   JARVIS — Video Lab (Marketing > Video Lab): the Library screen.

   The rules are in video-intel-logic.js. This file draws them and passes taps to them.

   What is here now: your videos (one per post, per platform), added by hand or from an idea in the Idea Library, each with a
   content pillar, optional campaign, purpose, structure, hook and script, and (once it is out) its published date and link.
   Evaluations, results and reports come in later updates; nothing on this screen pretends to be them.

   Pillars are read from Marketing > Settings (JarvisContentIntel.getPillars) and are never written here. The Idea Library is read
   through JarvisContentIntel.getIdeas; ideas are linked by id, not copied.

   Deleting is not asked about: it happens, and an Undo bar stays for a few seconds (the record is kept as a tombstone, so the
   delete also reaches your other devices).
   ========================================================================== */

(function () {
  "use strict";

  const V = window.JarvisVideoIntel;
  const UNDO_MS = 8000;

  let store = V ? V.emptyStore() : null;
  let started = false;
  let undo = null;                 // { fn, timer }
  let sheet = null;                // { kind: "video" | "campaigns", mode, id, opener }
  let editingCampaign = null;      // id of the campaign being edited in the campaigns sheet
  const filters = { query: "", platform: "", status: "", campaignId: "", pillar: "", sort: "recent" };

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function today() { return core().todayISODate(); }
  function intel() { return window.JarvisContentIntel || null; }
  function pillars() { const c = intel(); return c && typeof c.getPillars === "function" ? c.getPillars() : []; }
  function ideas() { const c = intel(); return c && typeof c.getIdeas === "function" ? c.getIdeas() : []; }
  function ideaById(id) { return ideas().filter(function (i) { return i.id === id; })[0] || null; }
  function ctx(extra) { return Object.assign({ now: Date.now(), today: today(), pillars: pillars(), campaigns: V.campaigns(store) }, extra || {}); }
  function announce(text) { const el = $("vlLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }

  /* ---------------- storage ---------------- */

  function load() {
    store = V.normalizeStore(core().loadJSON(V.KEY, null));
    const purged = V.purgeTombstones(store, Date.now());
    if (purged.videos.length !== store.videos.length || purged.campaigns.length !== store.campaigns.length) {
      store = purged;
      core().saveJSON(V.KEY, store);
    }
  }
  // Saves a new store. If the phone can't store it (full), nothing changes and false is returned.
  function commit(next) {
    const prev = store;
    store = next;
    if (core().saveJSON(V.KEY, next)) return true;
    store = prev;
    announce("Couldn't save: this phone's storage may be full.");
    return false;
  }

  /* ---------------- wording ---------------- */

  function fmtDate(iso) {
    if (!V.isDate(iso)) return "";
    const p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", p[0] === Number(today().slice(0, 4)) ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtTime(t) {
    if (!V.isTime(t)) return "";
    const p = t.split(":").map(Number);
    return new Date(2000, 0, 1, p[0], p[1]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const STATUS_BADGE = { planned: "badge-neutral", evaluated: "badge-accent", published: "badge-green", measured: "badge-green", analyzed: "badge-green" };
  function badge(cls, text) { return '<span class="badge ' + cls + '">' + esc(text) + '</span>'; }

  /* ---------------- the Library ---------------- */

  function skeleton() {
    const root = $("vlRoot");
    root.innerHTML =
      '<section class="card vl-intro" aria-labelledby="vlIntroTitle">' +
        '<h2 class="card-title" id="vlIntroTitle">Your videos</h2>' +
        '<p class="vl-hint">Follow each video from plan to results. Evaluations, results and reports are coming in later updates.</p>' +
        '<div class="vl-toolbar"><button type="button" class="btn btn-primary" data-vl="add">Add video</button>' +
        '<button type="button" class="btn btn-secondary" data-vl="campaigns">Campaigns</button></div>' +
      '</section>' +
      '<section class="card" aria-label="Find videos">' +
        '<div class="form-row"><label class="visually-hidden" for="vlSearch">Search videos</label>' +
        '<input type="search" id="vlSearch" placeholder="Search titles, hooks, scripts, notes" maxlength="80" autocomplete="off"></div>' +
        '<div class="mkt-filters">' +
          '<label class="visually-hidden" for="vlFPlatform">Platform</label><select id="vlFPlatform"></select>' +
          '<label class="visually-hidden" for="vlFStatus">Status</label><select id="vlFStatus"></select>' +
          '<label class="visually-hidden" for="vlFCampaign">Campaign</label><select id="vlFCampaign"></select>' +
          '<label class="visually-hidden" for="vlFPillar">Content pillar</label><select id="vlFPillar"></select>' +
          '<label class="visually-hidden" for="vlFSort">Sort</label><select id="vlFSort"></select>' +
        '</div>' +
        '<p class="vl-hint" id="vlCount" role="status"></p>' +
      '</section>' +
      '<div id="vlList"></div>';
  }

  // The Undo bar and the spoken updates sit at the top level of the page (like the dialog), not inside the panel, so an open
  // dialog never covers the bar and a screen reader still hears them while a dialog is open.
  function buildChrome() {
    if (!$("vlLive")) {
      const live = document.createElement("div");
      live.className = "visually-hidden"; live.id = "vlLive"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);
    }
    if (!$("vlUndo")) {
      const bar = document.createElement("div");
      bar.className = "vl-undo vl-scope hidden"; bar.id = "vlUndo"; bar.setAttribute("role", "status");
      bar.addEventListener("click", onClick);
      document.body.appendChild(bar);
    }
  }

  function fillSelect(id, first, options, keep) {
    const sel = $(id);
    const prev = keep === undefined ? sel.value : keep;
    sel.innerHTML = '<option value="">' + esc(first) + '</option>' + options.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join("");
    sel.value = options.some(function (o) { return o.value === prev; }) ? prev : "";
    return sel.value;
  }

  // The filter dropdowns that depend on your data (campaigns, pillars) are rebuilt whenever they could have changed.
  function refreshFilters() {
    fillSelect("vlFPlatform", "All platforms", V.PLATFORMS.map(function (p) { return { value: p.value, label: p.label }; }), filters.platform);
    fillSelect("vlFStatus", "All statuses", V.STATUSES, filters.status);
    filters.campaignId = fillSelect("vlFCampaign", "All campaigns", V.campaigns(store).map(function (c) { return { value: c.id, label: c.name }; }), filters.campaignId);
    const names = pillars().slice();
    V.videos(store).forEach(function (v) { v.pillars.forEach(function (p) { if (names.indexOf(p) === -1) names.push(p); }); });
    filters.pillar = fillSelect("vlFPillar", "All pillars", names.map(function (p) { return { value: p, label: p }; }), filters.pillar);
    const sort = $("vlFSort");
    sort.innerHTML = '<option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A to Z</option>';
    sort.value = filters.sort;
  }

  function cardHtml(v) {
    const status = V.statusOf(v, store);
    const camp = V.campaignName(store, v.campaignId);
    const badges = [badge("badge-accent", V.labelOf(V.PLATFORMS, v.platform, v.platform))];
    v.pillars.forEach(function (p) { badges.push(badge("badge-neutral", p)); });
    badges.push(badge(STATUS_BADGE[status] || "badge-neutral", V.labelOf(V.STATUSES, status)));
    if (camp) badges.push(badge("badge-neutral", camp));
    const age = V.ageText(v, today());
    if (age) badges.push(badge("badge-neutral", age));

    const when = [];
    if (v.publishedDate) when.push("Published " + fmtDate(v.publishedDate) + (v.publishedTime ? " at " + fmtTime(v.publishedTime) : ""));
    else if (v.plannedDate) when.push("Planned " + fmtDate(v.plannedDate));
    if (v.durationSec !== null) when.push(v.durationSec + " sec");
    const plan = [];
    if (v.objective.primary) plan.push("Purpose: " + V.labelOf(V.OBJECTIVES, v.objective.primary, v.objective.primary));
    if (v.structure) plan.push("Structure: " + V.labelOf(V.STRUCTURES, v.structure, v.structure));

    const idea = v.ideaId ? ideaById(v.ideaId) : null;
    const parsed = v.url ? V.parsePostUrl(v.url) : null;
    return '<article class="card vl-card" data-card="' + esc(v.id) + '">' +
      '<h3 class="vl-title" tabindex="-1">' + esc(v.title) + '</h3>' +
      '<div class="mkt-badges">' + badges.join("") + '</div>' +
      (when.length ? '<p class="vl-line">' + esc(when.join(" · ")) + '</p>' : "") +
      (plan.length ? '<p class="vl-line">' + esc(plan.join(" · ")) + '</p>' : "") +
      (v.hook ? '<p class="vl-hook">' + esc(v.hook) + '</p>' : "") +
      (idea ? '<p class="vl-line">From idea: <button type="button" class="vl-link" data-vl="idea" data-idea="' + esc(idea.id) + '">' + esc(idea.title) + '</button></p>' : "") +
      '<div class="vl-actions">' +
        '<button type="button" class="btn btn-secondary" data-vl="edit" data-id="' + esc(v.id) + '" aria-label="Edit ' + esc(v.title) + '">Edit</button>' +
        (parsed ? '<a class="btn btn-secondary" href="' + esc(parsed.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open the post for ' + esc(v.title) + ' (opens a new tab)">Open post</a>' : "") +
        '<button type="button" class="btn btn-secondary" data-vl="delete" data-id="' + esc(v.id) + '" aria-label="Delete ' + esc(v.title) + '">Delete</button>' +
      '</div></article>';
  }

  function renderList() {
    const all = V.videos(store);
    const list = V.filterVideos(store, filters);
    const box = $("vlList");
    if (!all.length) {
      box.innerHTML = '<div class="card"><p class="vl-empty">No videos yet. Tap <strong>Add video</strong> to plan your first one, or choose <strong>Add to Video Lab</strong> on an idea in Saved Library.</p></div>';
      $("vlCount").textContent = "";
      return;
    }
    $("vlCount").textContent = list.length === all.length ? plural(all.length, "video") : list.length + " of " + plural(all.length, "video") + " match";
    box.innerHTML = list.length ? list.map(cardHtml).join("") : '<div class="card"><p class="vl-empty">No videos match. Clear the search or a filter to see more.</p></div>';
  }

  function refresh() { refreshFilters(); renderList(); }

  /* ---------------- undo ---------------- */

  function hideUndo() { const bar = $("vlUndo"); if (undo && undo.timer) window.clearTimeout(undo.timer); undo = null; if (bar) { bar.classList.add("hidden"); bar.textContent = ""; } }
  function showUndo(text, fn) {
    hideUndo();
    const bar = $("vlUndo");
    bar.innerHTML = '<span class="vl-undo-text">' + esc(text) + '</span><button type="button" class="btn btn-secondary" data-vl="undo">Undo</button>';
    bar.classList.remove("hidden");
    undo = { fn: fn, timer: window.setTimeout(hideUndo, UNDO_MS) };
  }

  /* ---------------- the sheet (a dialog) ---------------- */

  function focusables() {
    const root = $("vlSheet");
    return Array.prototype.slice.call(root.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).filter(function (el) {
      return !el.disabled && el.offsetParent !== null && !el.closest("details:not([open]) > :not(summary)");
    });
  }
  // Listens on the whole page while a dialog is open, so Escape and Tab still work if focus ever slips outside it.
  function onSheetKey(e) {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const inside = $("vlSheet").contains(document.activeElement);
    if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function buildSheet() {
    if ($("vlSheet")) return;
    const o = document.createElement("div");
    o.className = "modal-overlay sheet-overlay vl-scope hidden";
    o.id = "vlSheet";
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-labelledby", "vlSheetTitle");
    o.innerHTML = '<div class="modal-box sheet-box vl-sheet"><div class="sheet-handle" aria-hidden="true"></div>' +
      '<div class="vl-sheet-head"><h2 id="vlSheetTitle" tabindex="-1"></h2><button type="button" class="btn btn-secondary" data-vl="close">Close</button></div>' +
      '<div id="vlSheetBody"></div></div>';
    // Tapping the dim background does nothing (so a half-written script is not lost) and must not pull focus out of the dialog.
    o.addEventListener("mousedown", function (e) { if (e.target === o) e.preventDefault(); });
    o.addEventListener("click", onClick);
    o.addEventListener("submit", onSubmit);
    o.addEventListener("change", onChange);
    document.body.appendChild(o);
  }
  function openSheet(next, title, html, focusId) {
    buildSheet();
    sheet = next;
    sheet.opener = sheet.opener || document.activeElement;
    $("vlSheetTitle").textContent = title;
    $("vlSheetBody").innerHTML = html;
    $("vlSheet").classList.remove("hidden");
    document.body.classList.add("vl-sheet-open");
    document.addEventListener("keydown", onSheetKey, true);
    const target = (focusId && $(focusId)) || $("vlSheetTitle");
    window.setTimeout(function () { target.focus(); }, 0);
  }
  function closeSheet(focusCardId) {
    const o = $("vlSheet");
    if (!o || o.classList.contains("hidden")) return;
    o.classList.add("hidden");
    document.body.classList.remove("vl-sheet-open");
    document.removeEventListener("keydown", onSheetKey, true);
    const opener = sheet && sheet.opener;
    sheet = null; editingCampaign = null;
    const card = focusCardId && document.querySelector('[data-card="' + focusCardId + '"] .vl-title');
    window.setTimeout(function () {
      if (card) card.focus();
      else if (opener && document.body.contains(opener) && typeof opener.focus === "function") opener.focus();
      else { const add = document.querySelector('#vlRoot [data-vl="add"]'); if (add) add.focus(); }
    }, 0);
  }

  /* ---------------- the video form ---------------- */

  const FIELDS = {   // error key -> [input id, message id]
    title: ["vlfTitle", "vlfTitleErr"], platform: ["vlfPlatformFirst", "vlfPlatformErr"], pillars: ["vlfPillar", "vlfPillarErr"], campaignId: ["vlfCampaign", "vlfCampaignErr"],
    newCampaign: ["vlfNewCampaign", "vlfNewCampaignErr"], objective: ["vlfObjective", "vlfObjectiveErr"], structure: ["vlfStructure", "vlfStructureErr"],
    structureNote: ["vlfStructureNote", "vlfStructureNoteErr"], hook: ["vlfHook", "vlfHookErr"], script: ["vlfScript", "vlfScriptErr"], durationSec: ["vlfLen", "vlfLenErr"],
    plannedDate: ["vlfPlanned", "vlfPlannedErr"], notes: ["vlfNotes", "vlfNotesErr"], publishedDate: ["vlfPubDate", "vlfPubDateErr"], publishedTime: ["vlfPubTime", "vlfPubTimeErr"], url: ["vlfUrl", "vlfUrlErr"]
  };
  function errSlot(key) { return '<p class="vl-err" id="' + FIELDS[key][1] + '"></p>'; }
  function options(list, selected, first) {
    return (first === undefined ? "" : '<option value="">' + esc(first) + '</option>') + list.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === selected ? " selected" : "") + '>' + esc(o.label) + '</option>'; }).join("");
  }
  function checks(name, list, selected, disabled) {
    return list.map(function (o, i) {
      const on = selected.indexOf(o.value) !== -1, off = disabled && disabled.indexOf(o.value) !== -1;
      return '<label class="mkt-check vl-check"><input type="checkbox" name="' + name + '" value="' + esc(o.value) + '"' + (on && !off ? " checked" : "") + (off ? " disabled" : "") + (i === 0 ? ' id="' + name + 'First"' : "") + '> ' + esc(o.label) + (off ? " (already in the Video Lab)" : "") + '</label>';
    }).join("");
  }
  function pillarChoices(selected) {   // your pillars, plus any a video already has that are no longer in Settings
    const names = pillars().slice();
    selected.forEach(function (p) { if (names.indexOf(p) === -1) names.push(p); });
    return names.map(function (p) { return { value: p, label: pillars().indexOf(p) === -1 ? p + " (no longer in Settings)" : p }; });
  }
  function alsoHtml(main, selected) {
    const list = pillarChoices(selected).filter(function (p) { return p.value !== main; });
    return list.length ? checks("vlfAlsoBox", list, selected) : '<p class="vl-hint">Your only pillar is the main one.</p>';
  }
  function selectedValues(name) { return Array.prototype.slice.call(document.querySelectorAll('#vlForm input[name="' + name + '"]:checked')).map(function (b) { return b.value; }); }

  function videoFormHtml(mode, v, pre) {
    const val = v || {};
    const main = (val.pillars && val.pillars[0]) || "";
    const also = (val.pillars || []).slice(1);
    const hasPlan = !!(val.objective && val.objective.primary || val.structure || val.hook || val.script || val.durationSec || val.plannedDate || val.notes);
    const hasPub = !!(val.publishedDate || val.url);
    const campaigns = V.campaigns(store);
    const ideaList = ideas();
    const nothing = !pillars().length;
    return '<form class="vl-form" id="vlForm" novalidate>' +
      '<p class="vl-errsum" id="vlErrSum" role="alert" tabindex="-1" hidden></p>' +
      (nothing ? '<p class="vl-err vl-err-on">You have no content pillars yet. Add them in Marketing, then Settings, and come back.</p>' : "") +
      (mode === "add" && ideaList.length ?
        '<div class="form-row"><label for="vlfIdea">Start from an idea (optional)</label><select id="vlfIdea">' +
        '<option value="">None, start blank</option>' + ideaList.map(function (i) { return '<option value="' + esc(i.id) + '"' + (val.ideaId === i.id ? " selected" : "") + '>' + esc(i.title) + '</option>'; }).join("") +
        '</select><p class="vl-hint">Fills in the form from your Idea Library. You can change anything.</p></div>' : "") +
      '<div class="form-row"><label for="vlfTitle">Title</label><input type="text" id="vlfTitle" maxlength="120" autocomplete="off" value="' + esc(val.title || "") + '">' + errSlot("title") + '</div>' +
      (mode === "add" ?
        '<fieldset class="vl-group"><legend>Platforms</legend><p class="vl-hint">One video is made for each platform you tick, because each platform reports its own numbers.</p>' +
        '<div id="vlfPlatforms">' + checks("vlfPlatform", V.PLATFORMS, pre && pre.platforms || [], pre && pre.used || []) + '</div>' + errSlot("platform") + '</fieldset>' :
        '<p class="vl-line">Platform: <strong>' + esc(V.labelOf(V.PLATFORMS, val.platform, val.platform)) + '</strong> (fixed, because its numbers belong to that platform)</p>') +
      '<div class="form-row"><label for="vlfPillar">Main content pillar</label><select id="vlfPillar">' + options(pillarChoices([main].concat(also).filter(Boolean)), main, "Choose a pillar") + '</select>' + errSlot("pillars") + '</div>' +
      '<fieldset class="vl-group"><legend>Also fits (optional)</legend><div id="vlfAlso">' + alsoHtml(main, also) + '</div></fieldset>' +
      '<div class="form-row"><label for="vlfCampaign">Campaign (optional)</label><select id="vlfCampaign">' + options(campaigns.map(function (c) { return { value: c.id, label: c.name }; }), val.campaignId || "", "No campaign") + '</select>' + errSlot("campaignId") + '</div>' +
      '<div class="form-row"><label for="vlfNewCampaign">Or start a new campaign (optional)</label><input type="text" id="vlfNewCampaign" maxlength="60" autocomplete="off" placeholder="Campaign name">' + errSlot("newCampaign") + '</div>' +
      '<details class="mkt-details vl-more"' + (hasPlan ? " open" : "") + '><summary>Plan details: purpose, structure, hook, script</summary>' +
        '<div class="form-row"><label for="vlfObjective">Main purpose</label><select id="vlfObjective">' + options(V.OBJECTIVES, val.objective && val.objective.primary || "", "Not chosen yet") + '</select>' + errSlot("objective") + '</div>' +
        '<fieldset class="vl-group"><legend>Secondary purposes (optional)</legend>' + checks("vlfSecondary", V.OBJECTIVES, val.objective && val.objective.secondary || []) + '</fieldset>' +
        '<div class="form-row"><label for="vlfStructure">Structure</label><select id="vlfStructure">' + options(V.STRUCTURES, val.structure || "", "Not chosen yet") + '</select>' + errSlot("structure") + '</div>' +
        '<div class="form-row"><label for="vlfStructureNote">Structure note (optional)</label><input type="text" id="vlfStructureNote" maxlength="120" autocomplete="off" value="' + esc(val.structureNote || "") + '">' + errSlot("structureNote") + '</div>' +
        '<div class="form-row"><label for="vlfHook">Hook (the opening line)</label><input type="text" id="vlfHook" maxlength="300" autocomplete="off" value="' + esc(val.hook || "") + '">' + errSlot("hook") + '</div>' +
        '<div class="form-row"><label for="vlfScript">Script</label><textarea id="vlfScript" rows="7" maxlength="8000">' + esc(val.script || "") + '</textarea>' + errSlot("script") + '</div>' +
        '<div class="form-row two-col"><div><label for="vlfLen">Length (seconds)</label><input type="number" id="vlfLen" inputmode="decimal" min="1" max="1800" step="any" value="' + (val.durationSec === null || val.durationSec === undefined ? "" : esc(String(val.durationSec))) + '">' + errSlot("durationSec") + '</div>' +
        '<div><label for="vlfPlanned">Planned date</label><input type="date" id="vlfPlanned" value="' + esc(val.plannedDate || "") + '">' + errSlot("plannedDate") + '</div></div>' +
        '<div class="form-row"><label for="vlfNotes">Notes</label><textarea id="vlfNotes" rows="3" maxlength="1000">' + esc(val.notes || "") + '</textarea>' + errSlot("notes") + '</div>' +
      '</details>' +
      '<details class="mkt-details vl-more"' + (hasPub ? " open" : "") + '><summary>Already published? Add the date and link</summary>' +
        '<p class="vl-hint">Only for a video that is out. With several platforms ticked, add these to each video afterwards.</p>' +
        '<div class="form-row two-col"><div><label for="vlfPubDate">Published date</label><input type="date" id="vlfPubDate" value="' + esc(val.publishedDate || "") + '">' + errSlot("publishedDate") + '</div>' +
        '<div><label for="vlfPubTime">Time (optional)</label><input type="time" id="vlfPubTime" value="' + esc(val.publishedTime || "") + '">' + errSlot("publishedTime") + '</div></div>' +
        '<div class="form-row"><label for="vlfUrl">Link to the post</label><input type="url" id="vlfUrl" inputmode="url" autocomplete="off" autocapitalize="off" placeholder="https://" value="' + esc(val.url || "") + '">' + errSlot("url") + '</div>' +
      '</details>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary"' + (nothing ? " disabled" : "") + '>' + (mode === "add" ? "Add video" : "Save changes") + '</button>' +
      '<button type="button" class="btn btn-secondary" data-vl="close">Cancel</button></div>' +
      '</form>';
  }

  function readForm() {
    const g = function (id) { const el = $(id); return el ? el.value : ""; };
    const main = g("vlfPillar");
    return {
      title: g("vlfTitle"), pillars: [main].concat(selectedValues("vlfAlsoBox")).filter(Boolean), campaignId: g("vlfCampaign") || null,
      objective: { primary: g("vlfObjective"), secondary: selectedValues("vlfSecondary") }, structure: g("vlfStructure"), structureNote: g("vlfStructureNote"),
      hook: g("vlfHook"), script: g("vlfScript"), durationSec: g("vlfLen"), plannedDate: g("vlfPlanned"), notes: g("vlfNotes"),
      publishedDate: g("vlfPubDate"), publishedTime: g("vlfPubTime"), url: g("vlfUrl"), ideaId: g("vlfIdea") || (sheet && sheet.ideaId) || null
    };
  }

  function clearErrors() {
    Object.keys(FIELDS).forEach(function (k) {
      const input = $(FIELDS[k][0]), msg = $(FIELDS[k][1]);
      if (msg) { msg.textContent = ""; msg.classList.remove("vl-err-on"); }
      if (input) { input.removeAttribute("aria-invalid"); input.removeAttribute("aria-describedby"); }
    });
    const sum = $("vlErrSum"); if (sum) { sum.hidden = true; sum.textContent = ""; }
  }
  function showErrors(errors) {
    clearErrors();
    let firstInput = null;
    Object.keys(errors).forEach(function (k) {
      const f = FIELDS[k];
      if (!f) return;
      const input = $(f[0]), msg = $(f[1]);
      if (msg) { msg.textContent = errors[k]; msg.classList.add("vl-err-on"); }
      if (input) {
        input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", f[1]);
        const det = input.closest("details"); if (det) det.open = true;
        // the first one you can see, top to bottom (not the first one that happened to be checked)
        if (!firstInput || (firstInput.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING)) firstInput = input;
      }
    });
    const sum = $("vlErrSum");
    const n = Object.keys(errors).length;
    sum.textContent = errors._ ? errors._ : "Please fix " + plural(n, "thing") + " below, then save again.";
    sum.hidden = false;
    (firstInput || sum).focus();
  }

  function openAdd(opts) {
    if (!started) return false;
    const idea = opts && opts.ideaId ? ideaById(opts.ideaId) : null;
    const pre = idea ? V.prefillFromIdea(idea, { pillars: pillars() }) : { platforms: [], pillars: [] };
    pre.used = idea ? V.platformsUsed(store, idea.id) : [];
    const val = idea ? { ideaId: idea.id, title: pre.title, hook: pre.hook, script: pre.script, pillars: pre.pillars, plannedDate: pre.plannedDate } : {};
    openSheet({ kind: "video", mode: "add", ideaId: idea ? idea.id : null, opener: opts && opts.opener }, "Add a video", videoFormHtml("add", val, pre), "vlfTitle");
    return true;
  }
  function openEdit(id) {
    const v = V.videoById(store, id);
    if (!v) return;
    openSheet({ kind: "video", mode: "edit", id: id, ideaId: v.ideaId }, "Edit video", videoFormHtml("edit", v), "vlfTitle");
  }

  // Choosing an idea fills the form from it; platforms the idea already has a video for are switched off.
  function applyIdea(id) {
    const idea = id ? ideaById(id) : null;
    if (sheet) sheet.ideaId = idea ? idea.id : null;
    const set = function (el, v) { if (el) el.value = v; };
    if (idea) {
      const pre = V.prefillFromIdea(idea, { pillars: pillars() });
      const used = V.platformsUsed(store, idea.id);
      set($("vlfTitle"), pre.title); set($("vlfHook"), pre.hook); set($("vlfScript"), pre.script); set($("vlfPlanned"), pre.plannedDate);
      set($("vlfPillar"), pre.pillars[0] || "");
      $("vlfAlso").innerHTML = alsoHtml(pre.pillars[0] || "", []);
      $("vlfPlatforms").innerHTML = checks("vlfPlatform", V.PLATFORMS, pre.platforms, used);
      if (pre.hook || pre.script || pre.plannedDate) { const d = document.querySelector("#vlForm details"); if (d) d.open = true; }
    } else {
      $("vlfPlatforms").innerHTML = checks("vlfPlatform", V.PLATFORMS, [], []);
    }
  }

  function saveVideoForm() {
    const input = readForm();
    clearErrors();
    // A new campaign typed in the form: reuse a campaign of that name if there is one, otherwise make it (only if everything else is valid).
    const newName = (($("vlfNewCampaign") || {}).value || "").trim();
    let work = store, campaignId = input.campaignId;
    if (newName) {
      const same = V.campaigns(store).filter(function (c) { return c.name.toLowerCase() === newName.toLowerCase(); })[0];
      if (same) campaignId = same.id;
      else {
        const made = V.addCampaign(store, { name: newName }, ctx());
        if (!made.ok) return showErrors({ newCampaign: made.errors.name || "Couldn't make that campaign." });
        work = made.store; campaignId = made.campaign.id;
      }
      input.campaignId = campaignId;
    }
    const c = ctx({ campaigns: V.campaigns(work) });
    if (sheet.mode === "add") {
      const platforms = selectedValues("vlfPlatform");
      const res = V.makeVideos(input, platforms, c);
      if (!res.ok) return showErrors(res.errors);
      if (!commit(V.addVideos(work, res.videos))) return showErrors({ _: "Couldn't save. This phone's storage may be full." });
      refresh();
      closeSheet(res.videos[0].id);
      announce(res.videos.length === 1 ? "Added " + res.videos[0].title + "." : "Added " + plural(res.videos.length, "video") + ".");
    } else {
      const res = V.updateVideo(work, sheet.id, input, c);
      if (!res.ok) return showErrors(res.errors);
      if (!commit(res.store)) return showErrors({ _: "Couldn't save. This phone's storage may be full." });
      refresh();
      closeSheet(sheet.id);
      announce("Saved " + res.video.title + ".");
    }
  }

  /* ---------------- campaigns ---------------- */

  function campaignRowHtml(c) {
    const dates = [c.startDate ? fmtDate(c.startDate) : "", c.endDate ? fmtDate(c.endDate) : ""].filter(Boolean).join(" to ");
    return '<li class="vl-camp"><div class="vl-camp-main"><strong>' + esc(c.name) + '</strong>' +
      '<span class="vl-line">' + esc([plural(V.videoCountIn(store, c.id), "video"), dates].filter(Boolean).join(" · ")) + '</span>' +
      (c.goal ? '<span class="vl-line">' + esc(c.goal) + '</span>' : "") + '</div>' +
      '<div class="vl-actions"><button type="button" class="btn btn-secondary" data-vl="camp-edit" data-id="' + esc(c.id) + '" aria-label="Edit ' + esc(c.name) + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary" data-vl="camp-delete" data-id="' + esc(c.id) + '" aria-label="Delete ' + esc(c.name) + '">Delete</button></div></li>';
  }
  function campaignsHtml() {
    const cur = editingCampaign ? V.campaignById(store, editingCampaign) : null;
    const list = V.campaigns(store);
    return '<form class="vl-form" id="vlCampForm" novalidate>' +
      '<h3 class="vl-sub">' + (cur ? "Edit campaign" : "New campaign") + '</h3>' +
      '<p class="vl-errsum" id="vlCampErr" role="alert" tabindex="-1" hidden></p>' +
      '<div class="form-row"><label for="vlcName">Name</label><input type="text" id="vlcName" maxlength="60" autocomplete="off" value="' + esc(cur ? cur.name : "") + '"></div>' +
      '<div class="form-row"><label for="vlcGoal">Goal (optional)</label><input type="text" id="vlcGoal" maxlength="200" autocomplete="off" value="' + esc(cur ? cur.goal : "") + '"></div>' +
      '<div class="form-row two-col"><div><label for="vlcStart">Starts</label><input type="date" id="vlcStart" value="' + esc(cur ? cur.startDate : "") + '"></div>' +
      '<div><label for="vlcEnd">Ends</label><input type="date" id="vlcEnd" value="' + esc(cur ? cur.endDate : "") + '"></div></div>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary">' + (cur ? "Save campaign" : "Add campaign") + '</button>' +
      (cur ? '<button type="button" class="btn btn-secondary" data-vl="camp-cancel">Cancel edit</button>' : "") + '</div></form>' +
      '<h3 class="vl-sub">Your campaigns</h3>' +
      (list.length ? '<ul class="vl-camp-list">' + list.map(campaignRowHtml).join("") + '</ul>' : '<p class="vl-empty">No campaigns yet. A campaign groups videos that push the same thing, like a product drop.</p>');
  }
  function openCampaigns(opener) {
    if (!started) return;
    editingCampaign = null;
    openSheet({ kind: "campaigns", opener: opener }, "Campaigns", campaignsHtml(), "vlcName");
  }
  function rerenderCampaigns(focusId) {
    $("vlSheetBody").innerHTML = campaignsHtml();
    const t = $(focusId || "vlcName"); if (t) t.focus();
  }
  function saveCampaignForm() {
    const input = { name: $("vlcName").value, goal: $("vlcGoal").value, startDate: $("vlcStart").value, endDate: $("vlcEnd").value };
    const res = editingCampaign ? V.updateCampaign(store, editingCampaign, input, ctx()) : V.addCampaign(store, input, ctx());
    const bar = $("vlCampErr");
    if (!res.ok) {
      bar.textContent = Object.keys(res.errors).map(function (k) { return res.errors[k]; }).join(" ");
      bar.hidden = false; bar.focus();
      return;
    }
    if (!commit(res.store)) { bar.textContent = "Couldn't save. This phone's storage may be full."; bar.hidden = false; bar.focus(); return; }
    const was = editingCampaign;
    editingCampaign = null;
    refresh();
    rerenderCampaigns("vlcName");
    announce((was ? "Saved " : "Added ") + res.campaign.name + ".");
  }

  /* ---------------- events ---------------- */

  function deleteVideo(id) {
    const v = V.videoById(store, id);
    if (!v) return;
    const at = Date.now();
    if (!commit(V.removeVideo(store, id, at))) return;
    refresh();
    const add = document.querySelector('#vlRoot [data-vl="add"]'); if (add) add.focus();
    showUndo('Deleted "' + v.title + '".', function () {
      if (commit(V.restoreVideo(store, id, Date.now()))) { refresh(); announce("Restored " + v.title + "."); }
    });
  }
  function deleteCampaign(id) {
    const c = V.campaignById(store, id);
    if (!c) return;
    if (!commit(V.removeCampaign(store, id, Date.now()))) return;
    refresh();
    rerenderCampaigns("vlcName");
    showUndo('Deleted the campaign "' + c.name + '". Its videos keep their other details.', function () {
      if (commit(V.restoreCampaign(store, id, Date.now()))) { refresh(); if (sheet && sheet.kind === "campaigns") rerenderCampaigns(); announce("Restored " + c.name + "."); }
    });
  }

  function onClick(e) {
    const t = e.target.closest("[data-vl]");
    if (!t) return;
    const act = t.getAttribute("data-vl"), id = t.getAttribute("data-id");
    if (act === "add") openAdd({ opener: t });
    else if (act === "campaigns") openCampaigns(t);
    else if (act === "close") closeSheet();
    else if (act === "edit") { sheet = null; openEdit(id); if (sheet) sheet.opener = t; }
    else if (act === "delete") deleteVideo(id);
    else if (act === "idea") { const c = intel(); if (c && typeof c.openIdea === "function") c.openIdea(t.getAttribute("data-idea")); }
    else if (act === "undo") { const u = undo; hideUndo(); if (u) u.fn(); }
    else if (act === "camp-edit") { editingCampaign = id; rerenderCampaigns("vlcName"); }
    else if (act === "camp-cancel") { editingCampaign = null; rerenderCampaigns("vlcName"); }
    else if (act === "camp-delete") deleteCampaign(id);
  }
  function onSubmit(e) {
    if (e.target.id === "vlForm") { e.preventDefault(); saveVideoForm(); }
    else if (e.target.id === "vlCampForm") { e.preventDefault(); saveCampaignForm(); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === "vlfIdea") applyIdea(t.value);
    else if (t.id === "vlfPillar") { const keep = selectedValues("vlfAlsoBox").filter(function (p) { return p !== t.value; }); $("vlfAlso").innerHTML = alsoHtml(t.value, keep); }
  }
  function onFilter(e) {
    const t = e.target;
    const map = { vlSearch: "query", vlFPlatform: "platform", vlFStatus: "status", vlFCampaign: "campaignId", vlFPillar: "pillar", vlFSort: "sort" };
    if (!map[t.id]) return;
    filters[map[t.id]] = t.value;
    renderList();
  }

  /* ---------------- start ---------------- */

  function init() {
    if (started) return;
    const root = $("vlRoot");
    if (!root || !V || !core()) return;
    load();
    skeleton();
    buildChrome();
    refresh();
    root.addEventListener("click", onClick);
    root.addEventListener("input", onFilter);
    root.addEventListener("change", onFilter);
    const tab = $("mktSubNavVideoLab");
    if (tab) tab.addEventListener("click", function () { if (started) refresh(); });
    started = true;
  }

  // From an idea in the Idea Library: go to the Video Lab and open the Add form with the idea's details.
  function addFromIdea(ideaId) {
    if (!started || !ideaById(ideaId)) return false;
    const nav = $("navBtnMarketing"); if (nav) nav.click();
    const tab = $("mktSubNavVideoLab"); if (tab) tab.click();
    return openAdd({ ideaId: ideaId });
  }

  window.JarvisVideoLab = {
    init: init,
    addFromIdea: addFromIdea,
    getVideos: function () { return store ? V.videos(store).slice() : []; }
  };
})();
