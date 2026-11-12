/* ==========================================================================
   JARVIS — Learning & Research Hub: Research (the list, a project's own page, sources, the add/edit forms).
   Findings and notes are kept in the Knowledge library's records and shown here through their link to the project.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;

  function uid(p) { return window.JarvisCore.uid(p); }

  /* ---------------- forms ---------------- */

  function openResearchForm(r) {
    const isNew = !r, S = store.state();
    const x = r || { title: "", category: "", question: "", purpose: "", priority: "medium", status: "planned", conclusion: "", completedAt: "" };
    const body =
      A.fText("title", "Title", x.title, { required: true, max: 200 }) +
      A.fArea("question", "Main research question", x.question, { rows: 2, max: 500, placeholder: "What are you trying to find out?" }) +
      A.fArea("purpose", "Purpose", x.purpose, { rows: 2, max: 1000, placeholder: "Why does this matter? What will you use it for?" }) +
      A.fText("category", "Category", x.category, { max: 60, list: "lnCats" }) + A.datalist("lnCats", L.allCategories(S)) +
      '<div class="ln-two">' + A.fSelect("priority", "Priority", A.opts(L.PRIORITY), x.priority, { required: true }) + A.fSelect("status", "Status", A.opts(L.RESEARCH_STATUS), x.status, { required: true }) + '</div>';
    A.openSheet({
      title: isNew ? "New research project" : "Edit research", body: body, submit: isNew ? "Create project" : "Save changes",
      onSubmit: function (v) {
        const res = L.checkResearch(Object.assign({}, v, { conclusion: x.conclusion, completedAt: x.completedAt }), { today: store.today() });
        if (!res.ok) return { ok: false, errors: res.errors };
        let saved;
        if (isNew) saved = store.add("research", Object.assign({}, res.value, { sources: [] }));
        else saved = store.put("research", Object.assign({}, r, res.value));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say((isNew ? "Created " : "Saved ") + saved.title + ".");
        if (isNew) A.notice("Created “" + saved.title + "”.", "Open", function () { A.go("research", saved.id); });
        return { ok: true };
      }
    });
  }

  function openSourceForm(rid, source) {
    const r = store.get("research", rid);
    if (!r) return;
    const isNew = !source, s = source || { title: "", url: "", kind: "article", note: "" };
    const body =
      A.fText("url", "Web address", s.url, { type: "url", required: true, placeholder: "example.com/article" }) +
      A.fText("title", "Title", s.title, { max: 200, hint: "Optional. If you leave it empty the website name is used." }) +
      A.fSelect("kind", "Type", A.opts(L.SOURCE_KIND), s.kind, { required: true }) +
      A.fArea("note", "Note", s.note, { rows: 2, max: 500, placeholder: "What is this source good for?" });
    A.openSheet({
      title: isNew ? "Add a source" : "Edit source", body: body, submit: isNew ? "Add source" : "Save source", focus: "#lnf_url",
      onSubmit: function (v) {
        const res = L.checkSource(v);
        if (!res.ok) return { ok: false, errors: res.errors };
        const fresh = store.get("research", rid);
        if (!fresh) return { ok: false, errors: {}, message: "This project no longer exists." };
        const sources = isNew ? fresh.sources.concat([Object.assign({ id: uid("src"), addedAt: Date.now() }, res.value)])
          : fresh.sources.map(function (x2) { return x2.id === source.id ? Object.assign({}, x2, res.value) : x2; });
        if (!store.put("research", Object.assign({}, fresh, { sources: sources }))) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(isNew ? "Source added." : "Source saved.");
        return { ok: true };
      }
    });
  }

  function deleteSource(rid, sid) {
    const r = store.get("research", rid);
    if (!r) return;
    const s = r.sources.filter(function (x) { return x.id === sid; })[0];
    if (!s) return;
    const before = r;
    if (!store.put("research", Object.assign({}, r, { sources: r.sources.filter(function (x) { return x.id !== sid; }) }))) { A.saveFailed(); return; }
    A.notice("Removed the source “" + A.snippet(s.title, 40) + "”.", "Undo", function () {
      const cur = store.get("research", rid);
      if (cur) store.put("research", Object.assign({}, cur, { sources: before.sources }));
    });
  }

  function deleteResearch(id) {
    const r = store.get("research", id);
    if (!r) return;
    const linked = L.notesFor(store.list("notes"), "research", id).length;
    A.confirmSheet({
      title: "Delete this research project?",
      text: "“" + r.title + "” and its " + A.plural(r.sources.length, "source") + " will be removed." + (linked ? " Its " + A.plural(linked, "note") + " stay in your Knowledge library, no longer linked to the project." : "") + " You can undo for a few seconds afterwards.",
      yes: "Delete project",
      onYes: function () {
        if (!store.remove("research", id)) { A.saveFailed(); return; }
        const changes = store.unlinkFrom("research", id, r.title);
        if (A.state.tab === "research" && A.state.id === id) A.go("research", "", { noScroll: true });
        A.notice("Deleted “" + r.title + "”.", "Undo", function () { store.undoRemove("research", id); store.relink(changes); });
      }
    });
  }

  function setStatus(id, status) {
    const r = store.get("research", id);
    if (!r || r.status === status) return;
    if (!store.put("research", L.withResearchStatus(r, status, store.today(), Date.now()))) { A.saveFailed(); return; }
    A.say(r.title + ": " + L.labelOf(L.RESEARCH_STATUS, status) + ".");
  }

  function saveConclusion(form) {
    const id = form.getAttribute("data-id"), r = store.get("research", id);
    if (!r) return;
    const text = form.elements.conclusion.value;
    const res = L.checkResearch({ title: r.title, category: r.category, question: r.question, purpose: r.purpose, priority: r.priority, status: r.status, conclusion: text, completedAt: r.completedAt }, { today: store.today() });
    if (!res.ok) { A.showErrors(form, res.errors); return; }
    if (res.value.conclusion === r.conclusion) { A.say("Conclusion unchanged."); return; }
    if (!store.put("research", Object.assign({}, r, { conclusion: res.value.conclusion }))) { A.saveFailed(); return; }
    A.say("Conclusion saved.");
    A.notice("Conclusion saved.", "");
  }

  /* ---------------- the list ---------------- */

  function card(r, S) {
    const notes = L.notesFor(S.notes, "research", r.id).length, acts = L.actionsFor(S.actions, "research", r.id).length;
    return '<article class="ln-card-item"><button type="button" class="ln-item ln-item-open ln-item-flat ln-res-open" data-go="research" data-id="' + esc(r.id) + '" aria-label="Open ' + esc(r.title) + '"><span class="ln-item-main">' +
      '<span class="ln-item-title">' + esc(r.title) + '</span><span class="ln-badges">' + A.statusBadge(r.status, L.labelOf(L.RESEARCH_STATUS, r.status)) + A.prioBadge(r.priority) + (r.category ? A.badge("neutral", r.category) : "") + '</span>' +
      (r.question ? '<span class="ln-item-sub ln-clamp">' + esc(A.snippet(r.question, 160)) + '</span>' : '<span class="ln-item-sub">No research question yet</span>') +
      '<span class="ln-item-sub">' + esc([A.plural(r.sources.length, "source"), A.plural(notes, "note"), A.plural(acts, "action")].join(" · ")) + '</span></span></button></article>';
  }
  function listResults() {
    const S = store.state(), f = A.state.filters.research;
    const list = L.filterResearch(S.research, f);
    if (!list.length) {
      return L.live(S.research).length
        ? '<p class="empty-state">No research matches. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>'
        : '<div class="empty-state"><p>No research projects yet.</p><p class="field-hint">A project keeps one question together with its sources, findings and your conclusion.</p><button type="button" class="btn btn-primary" data-act="add-research">Start your first project</button></div>';
    }
    return '<div class="ln-grid ln-grid-wide">' + list.map(function (r) { return card(r, S); }).join("") + '</div>';
  }
  function listCount() {
    const n = L.filterResearch(store.state().research, A.state.filters.research).length, total = L.live(store.state().research).length;
    return n === total ? A.plural(total, "project") : n + " of " + total + " projects";
  }
  function list() {
    const S = store.state(), cats = L.allCategories({ research: S.research });
    return '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Research</h2><button type="button" class="btn btn-primary" data-act="add-research">+ New research</button></div>' +
      A.toolbar("research", [
        { name: "q", kind: "search", label: "Search research", placeholder: "Search title, question, sources" },
        { name: "status", kind: "select", label: "Filter by status", options: [["", "All statuses"]].concat(L.RESEARCH_STATUS.map(function (x) { return [x.key, x.label]; })) },
        { name: "priority", kind: "select", label: "Filter by priority", options: [["", "All priorities"]].concat(L.PRIORITY.map(function (x) { return [x.key, x.label]; })) },
        { name: "category", kind: "select", label: "Filter by category", options: [["", "All categories"]].concat(cats.map(function (c) { return [c, c]; })) },
        { name: "sort", kind: "select", label: "Sort research", options: [["recent", "Recently updated"], ["priority", "Priority"], ["added", "Recently added"], ["title", "Title A–Z"]] }
      ]) + (A.state.filters.research.active ? '<p class="ln-item-sub">Showing active research only (researching or analyzing).</p>' : "") +
      '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(listCount()) + '</p><div id="lnResults">' + listResults() + '</div>';
  }

  /* ---------------- a project's own page ---------------- */

  function sourceRow(r, s) {
    return '<li class="ln-source"><div class="ln-source-main"><span class="ln-badges">' + A.badge("neutral", L.labelOf(L.SOURCE_KIND, s.kind)) + '</span>' +
      '<a class="ln-link" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + '<span class="visually-hidden"> (opens in a new tab)</span></a>' +
      '<span class="ln-item-sub">' + esc(L.hostOf(s.url)) + '</span>' + (s.note ? '<span class="ln-item-sub">' + esc(s.note) + '</span>' : "") + '</div>' +
      '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="edit-source" data-id="' + esc(r.id) + '" data-sid="' + esc(s.id) + '" aria-label="Edit source ' + esc(s.title) + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="delete-source" data-id="' + esc(r.id) + '" data-sid="' + esc(s.id) + '" aria-label="Remove source ' + esc(s.title) + '">Remove</button></div></li>';
  }

  function detail(id) {
    const r = store.get("research", id);
    if (!r) return '<div class="ln-head"><button type="button" class="btn-icon" data-go="research">← All research</button></div><p class="empty-state" data-focus-top>This research project no longer exists.</p>';
    const S = store.state();
    const statusBtns = L.RESEARCH_STATUS.map(function (s) {
      return '<button type="button" class="ln-seg-btn" data-act="status-research" data-id="' + esc(r.id) + '" data-v="' + s.key + '" aria-pressed="' + (r.status === s.key) + '">' + esc(s.label) + '</button>';
    }).join("");
    let h = '<div class="ln-head"><button type="button" class="btn-icon" data-go="research">← All research</button>' +
      '<div class="ln-head-btns"><button type="button" class="btn btn-secondary" data-act="edit-research" data-id="' + esc(r.id) + '">Edit</button><button type="button" class="btn btn-secondary ln-danger" data-act="delete-research" data-id="' + esc(r.id) + '">Delete</button></div></div>' +
      '<section class="card ln-card"><h2 class="ln-h2" data-focus-top>' + esc(r.title) + '</h2><div class="ln-badges">' + A.statusBadge(r.status, L.labelOf(L.RESEARCH_STATUS, r.status)) + A.prioBadge(r.priority) + (r.category ? A.badge("neutral", r.category) : "") +
      (r.completedAt ? A.badge("green", "Completed " + A.fmtShort(r.completedAt)) : "") + '</div>' +
      '<div class="ln-seg" role="group" aria-label="Research status">' + statusBtns + '</div>' +
      '<h3 class="ln-h3">Main question</h3><p class="ln-text">' + (r.question ? esc(r.question) : '<span class="ln-item-sub">Not written yet. Use Edit to add it.</span>') + '</p>' +
      '<h3 class="ln-h3">Purpose</h3><p class="ln-text">' + (r.purpose ? esc(r.purpose) : '<span class="ln-item-sub">Not written yet.</span>') + '</p></section>';

    h += '<section class="card ln-card" aria-labelledby="lnRsSrc"><div class="card-title-row"><h2 class="card-title" id="lnRsSrc">Sources (' + r.sources.length + ')</h2><button type="button" class="btn btn-secondary" data-act="add-source" data-id="' + esc(r.id) + '">+ Add source</button></div>' +
      (r.sources.length ? '<ul class="ln-sources">' + r.sources.map(function (s) { return sourceRow(r, s); }).join("") + '</ul>' : '<p class="empty-state-compact">No sources yet. Add the articles, videos and websites you’re using.</p>') + '</section>';

    const notes = L.filterNotes(S.notes, S, { researchId: r.id, sort: "newest" });
    h += '<section class="card ln-card" aria-labelledby="lnRsNotes"><div class="card-title-row"><h2 class="card-title" id="lnRsNotes">Findings and notes (' + notes.length + ')</h2></div>' +
      '<div class="ln-quick" role="group" aria-label="Add to this project"><button type="button" class="btn btn-secondary" data-act="add-note" data-type="finding" data-id="' + esc(r.id) + '">+ Finding</button>' +
      '<button type="button" class="btn btn-secondary" data-act="add-note" data-type="note" data-id="' + esc(r.id) + '">+ Note</button></div>' +
      (notes.length ? '<div class="ln-list">' + notes.map(function (n) { return A.noteCard(n); }).join("") + '</div>' : '<p class="empty-state-compact">No findings yet. When a source tells you something, record it as a finding with the evidence behind it.</p>') + '</section>';

    h += '<section class="card ln-card" aria-labelledby="lnRsConc"><div class="card-title-row"><h2 class="card-title" id="lnRsConc">My conclusion</h2></div>' +
      '<form data-form="conclusion" data-id="' + esc(r.id) + '" novalidate><div class="form-row"><label for="lnConc" class="visually-hidden">My conclusion</label><textarea id="lnConc" name="conclusion" rows="4" maxlength="5000" placeholder="What do you conclude from what you’ve found? Leave empty until you know." data-fk="conclusion">' + esc(r.conclusion) + '</textarea></div>' +
      '<button type="submit" class="btn btn-secondary">Save conclusion</button><p class="ln-err hidden" data-err="conclusion" role="alert"></p></form></section>';

    const acts = L.actionsFor(S.actions, "research", r.id);
    h += '<section class="card ln-card" aria-labelledby="lnRsActs"><div class="card-title-row"><h2 class="card-title" id="lnRsActs">Next steps (' + acts.length + ')</h2><button type="button" class="btn btn-secondary" data-act="add-action" data-id="' + esc(r.id) + '">+ Add next step</button></div>' +
      (acts.length ? '<div class="ln-list">' + acts.map(function (a) { return A.actionRow(a); }).join("") + '</div>' : '<p class="empty-state-compact">What will you do with what you’ve found? Add the next step.</p>') + '</section>';
    return h;
  }

  A.register("research", {
    html: function () { return A.state.id ? detail(A.state.id) : list(); },
    results: listResults,
    count: listCount,
    click: function (act, el) {
      const id = el.getAttribute("data-id");
      if (act === "add-research") openResearchForm(null);
      else if (act === "edit-research") { const r = store.get("research", id); if (r) openResearchForm(r); }
      else if (act === "delete-research") deleteResearch(id);
      else if (act === "status-research") setStatus(id, el.getAttribute("data-v"));
      else if (act === "add-source") openSourceForm(id, null);
      else if (act === "edit-source") { const r = store.get("research", id); const s = r && r.sources.filter(function (x) { return x.id === el.getAttribute("data-sid"); })[0]; if (s) openSourceForm(id, s); }
      else if (act === "delete-source") deleteSource(id, el.getAttribute("data-sid"));
      else if (act === "add-note") A.editNote(null, { type: el.getAttribute("data-type"), researchIds: [id] });
      else if (act === "add-action") { const r = store.get("research", id); A.editAction(null, { sourceType: "research", sourceId: id, label: r ? r.title : "" }); }
    },
    submit: function (form) {
      if (form.getAttribute("data-form") === "conclusion") saveConclusion(form);
    }
  });
  A.quickAdd.research = function () { openResearchForm(null); };
})();
