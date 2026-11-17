/* ==========================================================================
   JARVIS — Learning & Research Hub: Research (the list, a topic's own page, sources, the add/edit forms).
   Findings and notes are kept with the other notes and shown here through their link to the topic.
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
    const moreOpen = !isNew && !!(x.purpose || x.category || x.priority !== "medium" || x.status !== "planned");
    const body =
      A.fText("title", "Topic", x.title, { required: true, max: 200 }) +
      A.fArea("question", "Main question", x.question, { rows: 2, max: 500, placeholder: "What are you trying to find out?" }) +
      '<details class="ln-more"' + (moreOpen ? " open" : "") + '><summary>More details</summary>' +
      (isNew ? A.fSelect("template", "Start from a template (optional)", [["", "No template"]].concat(L.TEMPLATES.map(function (t) { return [t.key, t.label]; })), "", {}) + '<p class="field-hint" id="lnTmplNote">A template suggests a question and a checklist of steps. You can change all of it.</p>' : "") +
      A.fArea("purpose", "Purpose", x.purpose, { rows: 2, max: 1000, placeholder: "Why does this matter? What will you use it for?" }) +
      A.fText("category", "Category", x.category, { max: 60, list: "lnCats" }) + A.datalist("lnCats", L.allCategories(S)) +
      '<div class="ln-two">' + A.fSelect("priority", "Priority", A.opts(L.PRIORITY), x.priority, { required: true }) + A.fSelect("status", "Status", A.opts(L.RESEARCH_STATUS), x.status, { required: true }) + '</div></details>';
    A.openSheet({
      title: isNew ? "New research topic" : "Edit research", body: body, submit: isNew ? "Create topic" : "Save changes",
      onChange: function (t, el) {
        if (t.id !== "lnf_template") return;
        const tm = L.TEMPLATES.filter(function (k) { return k.key === t.value; })[0];
        el.querySelector("#lnTmplNote").textContent = tm ? "Adds a checklist of " + tm.checklist.length + " steps and fills in a question and purpose you can change." : "A template suggests a question and a checklist of steps. You can change all of it.";
        if (!tm) return;
        [["category", tm.category], ["question", tm.question], ["purpose", tm.purpose]].forEach(function (f) { const box = el.querySelector("#lnf_" + f[0]); if (box && !box.value.trim()) box.value = f[1]; });
      },
      onSubmit: function (v) {
        const input = Object.assign({}, v, { conclusion: x.conclusion, completedAt: x.completedAt });
        if (isNew && v.template) input.checklist = L.checklistFromTemplate(v.template, function () { return uid("ck"); });
        else delete input.template;                      // an edit never touches the checklist or the template it came from
        if (!isNew) input.archived = r.archived === true;    // only a completed project stays archived
        const res = L.checkResearch(input, { today: store.today() });
        if (!res.ok) return { ok: false, errors: res.errors };
        let saved;
        if (isNew) saved = store.add("research", Object.assign({}, res.value, { sources: [] }));
        else saved = store.put("research", Object.assign({}, r, res.value));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say((isNew ? "Created " : "Saved ") + saved.title + ".");
        if (isNew) A.notice("Created \u201c" + saved.title + "\u201d.", "Open", function () { A.go("research", saved.id); });
        return { ok: true };
      }
    });
  }

  function openSourceForm(rid, source) {
    const r = store.get("research", rid);
    if (!r) return;
    const isNew = !source, s = source || { title: "", url: "", kind: "article", note: "", state: "unreviewed", credibility: "" };
    const body =
      A.fText("url", "Web address", s.url, { type: "url", required: true, placeholder: "example.com/article" }) +
      A.fText("title", "Title", s.title, { max: 200, hint: "Optional. If you leave it empty the website name is used." }) +
      '<div class="ln-two">' + A.fSelect("kind", "Type", A.opts(L.SOURCE_KIND), s.kind, { required: true }) + A.fSelect("state", "Review status", A.opts(L.SOURCE_STATE), s.state || "unreviewed", {}) + '</div>' +
      A.fArea("note", "Note", s.note, { rows: 2, max: 500, placeholder: "What is this source good for?" }) +
      A.fArea("credibility", "How far can you trust it?", s.credibility || "", { rows: 2, max: 600, placeholder: "Who wrote it? Peer reviewed, sponsored or an opinion piece? How recent? Does it cite its evidence?" });
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

  function setArchived(id, flag) {
    const r = store.get("research", id);
    if (!r) return;
    const before = r, next = L.withArchived(r, flag, Date.now());
    if (next === r) return;
    if (!store.put("research", next)) { A.saveFailed(); return; }
    A.notice(flag ? "Archived. It is hidden from the list unless you choose to show archived projects." : "Moved back out of the archive.", "Undo", function () { store.put("research", before); });
  }
  function putChecklist(r, list) {
    return store.put("research", Object.assign({}, r, { checklist: list }));
  }
  function addChecklistItem(form) {
    const r = store.get("research", form.getAttribute("data-id"));
    if (!r) return;
    const text = form.elements.step.value.trim();
    if (!text) { A.showErrors(form, { step: "Write the step first." }); return; }
    const list = L.cleanChecklist((r.checklist || []).concat([{ id: uid("ck"), text: text, done: false }]), store.today());
    if (list.length === (r.checklist || []).length) { A.showErrors(form, { step: "A checklist can hold up to 60 steps." }); return; }
    if (!putChecklist(r, list)) A.saveFailed();
    else window.setTimeout(function () { const f = document.getElementById("lnCkNew"); if (f) f.focus(); }, 0);
  }
  function editChecklistItem(rid, itemId) {
    const r = store.get("research", rid), item = r && (r.checklist || []).filter(function (x) { return x.id === itemId; })[0];
    if (!item) return;
    A.openSheet({
      title: "Edit step", body: A.fText("text", "Step", item.text, { max: 200, required: true }), submit: "Save", focus: "#lnf_text",
      onSubmit: function (v) {
        const t = (v.text || "").trim();
        if (!t) return { ok: false, errors: { text: "Write the step." } };
        const fresh = store.get("research", rid);
        if (!fresh || !putChecklist(fresh, fresh.checklist.map(function (x) { return x.id === itemId ? Object.assign({}, x, { text: t.slice(0, 200) }) : x; }))) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        return { ok: true };
      }
    });
  }
  function deleteChecklistItem(rid, itemId) {
    const r = store.get("research", rid);
    if (!r) return;
    const before = r;
    if (!putChecklist(r, (r.checklist || []).filter(function (x) { return x.id !== itemId; }))) { A.saveFailed(); return; }
    A.notice("Step removed.", "Undo", function () { const cur = store.get("research", rid); if (cur) putChecklist(cur, before.checklist); });
  }
  function applyTemplate(rid, key) {
    const r = store.get("research", rid);
    if (!r) return;
    const have = {};
    (r.checklist || []).forEach(function (x) { have[x.text.toLowerCase()] = true; });
    const add = L.checklistFromTemplate(key, function () { return uid("ck"); }).filter(function (x) { return !have[x.text.toLowerCase()]; });
    if (!add.length) { A.say("Those steps are already on the checklist."); return; }
    if (!store.put("research", Object.assign({}, r, { checklist: (r.checklist || []).concat(add), template: key }))) { A.saveFailed(); return; }
    A.notice("Added " + A.plural(add.length, "step") + " from the template.", "");
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

  function row(r, S) {
    const notes = L.notesFor(S.notes, "research", r.id).length, cp = L.checklistProgress(r);
    const meta = [L.labelOf(L.RESEARCH_STATUS, r.status), A.plural(r.sources.length, "source"), A.plural(notes, "note")];
    if (r.priority === "high") meta.unshift("High priority");
    if (r.archived) meta.push("Archived");
    return '<li class="ln-brow"><button type="button" class="ln-brow-open" data-go="research" data-id="' + esc(r.id) + '" aria-label="Open ' + esc(r.title) + '"><span class="ln-item-main">' +
      '<span class="ln-item-title">' + esc(r.title) + '</span>' +
      (r.question ? '<span class="ln-item-sub ln-clamp">' + esc(A.snippet(r.question, 160)) + '</span>' : "") +
      (cp.total ? A.barHtml(cp.pct, r.title + ": " + cp.pct + "% of the steps done") : "") +
      '<span class="ln-item-sub">' + esc(meta.join(" · ")) + '</span></span></button></li>';
  }
  function listResults() {
    const S = store.state(), f = A.state.filters.research;
    const list = L.filterResearch(S.research, f);
    if (!list.length) {
      return L.live(S.research).length
        ? '<p class="empty-state">No research matches. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>'
        : '<div class="empty-state"><p>No research topics yet.</p><button type="button" class="btn btn-primary" data-act="add-research">Start your first topic</button></div>';
    }
    return '<ul class="ln-brows">' + list.map(function (r) { return row(r, S); }).join("") + '</ul>';
  }
  function listCount() {
    const n = L.filterResearch(store.state().research, A.state.filters.research).length, total = L.live(store.state().research).length;
    return n === total ? A.plural(total, "topic") : n + " of " + total + " topics";
  }
  function statusChips(S) {
    const live = L.live(S.research).filter(function (r) { return !r.archived; }), f = A.state.filters.research;
    const cur = f.active ? "active" : (f.status || "");
    const n = function (fn) { return live.filter(fn).length; };
    const items = [["", "All", live.length], ["active", "Active", n(function (r) { return r.status === "researching" || r.status === "analyzing"; })], ["planned", "Planned", n(function (r) { return r.status === "planned"; })], ["completed", "Completed", n(function (r) { return r.status === "completed"; })]];
    return '<div class="ln-pills ln-pills-filter" role="group" aria-label="Show research">' + items.map(function (x) {
      return '<button type="button" class="ln-pill" data-act="res-show" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '">' + esc(x[1]) + ' <span class="ln-pill-n">' + x[2] + '</span></button>';
    }).join("") + '</div>';
  }
  function list() {
    const S = store.state(), cats = L.allCategories({ research: S.research });
    return '<h2 class="visually-hidden" data-focus-top>Research</h2>' + statusChips(S) +
      A.toolbar("research", [
        { name: "q", kind: "search", label: "Search research", placeholder: "Search title, question, sources" },
        { name: "priority", kind: "select", label: "Filter by priority", options: [["", "All priorities"]].concat(L.PRIORITY.map(function (x) { return [x.key, x.label]; })) },
        { name: "category", kind: "select", label: "Filter by category", options: [["", "All categories"]].concat(cats.map(function (c) { return [c, c]; })) },
        { name: "archived", kind: "select", label: "Archived topics", options: [["", "Hide archived"], ["show", "Show archived too"], ["only", "Only archived"]] },
        { name: "sort", kind: "select", label: "Sort research", options: [["recent", "Recently updated"], ["priority", "Priority"], ["added", "Recently added"], ["title", "Title A–Z"]] }
      ], { fold: 1 }) +
      '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(listCount()) + '</p><div id="lnResults">' + listResults() + '</div>';
  }

  /* ---------------- a topic's own page ---------------- */

  function sourceRow(r, s) {
    const state = s.state && s.state !== "unreviewed" ? L.labelOf(L.SOURCE_STATE, s.state) : "";
    return '<li class="ln-source"><div class="ln-source-main">' +
      '<a class="ln-link" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + '<span class="visually-hidden"> (opens in a new tab)</span></a>' +
      '<span class="ln-item-sub">' + esc([L.labelOf(L.SOURCE_KIND, s.kind), L.hostOf(s.url), state].filter(Boolean).join(" · ")) + '</span>' + (s.note ? '<span class="ln-item-sub">' + esc(s.note) + '</span>' : "") +
      (s.credibility ? '<span class="ln-item-sub ln-cred">Trust: ' + esc(s.credibility) + '</span>' : "") + '</div>' +
      '<div class="ln-item-btns"><button type="button" class="ln-link-btn" data-act="edit-source" data-id="' + esc(r.id) + '" data-sid="' + esc(s.id) + '" aria-label="Edit source ' + esc(s.title) + '">Edit</button>' +
      '<button type="button" class="ln-link-btn ln-danger" data-act="delete-source" data-id="' + esc(r.id) + '" data-sid="' + esc(s.id) + '" aria-label="Remove source ' + esc(s.title) + '">Remove</button></div></li>';
  }

  function checklistHtml(r) {
    const list = r.checklist || [], cp = L.checklistProgress(r);
    const row = function (x) {
      return '<li class="ln-ck' + (x.done ? " ln-ck-done" : "") + '"><label class="ln-ck-label"><input type="checkbox" data-act="ck-toggle" data-id="' + esc(r.id) + '" data-ck="' + esc(x.id) + '"' + (x.done ? " checked" : "") + '><span class="ln-ck-text">' + esc(x.text) + '</span></label>' +
        (x.done && x.doneAt ? '<span class="ln-item-sub ln-ck-date">' + esc(A.fmtShort(x.doneAt)) + '</span>' : "") +
        '<button type="button" class="btn-icon ln-ck-btn" data-act="ck-edit" data-id="' + esc(r.id) + '" data-ck="' + esc(x.id) + '" aria-label="Edit step ' + esc(x.text) + '">Edit</button>' +
        '<button type="button" class="btn-icon ln-ck-btn ln-danger" data-act="ck-delete" data-id="' + esc(r.id) + '" data-ck="' + esc(x.id) + '" aria-label="Remove step ' + esc(x.text) + '">Remove</button></li>';
    };
    return '<details class="ln-more ln-sec" data-keep="ck_' + esc(r.id) + '"' + (A.state.open["ck_" + r.id] ? " open" : "") + '><summary>Checklist' + (cp.total ? ' (' + cp.done + '/' + cp.total + ')' : "") + '</summary>' +
      (cp.total ? A.barHtml(cp.pct, "Checklist: " + cp.pct + "% done") + '<p class="ln-item-sub">' + cp.pct + '% done' + (cp.done === cp.total && r.status !== "completed" ? ' · every step is done. You can mark the topic completed.' : "") + '</p>' : "") +
      (list.length ? '<ul class="ln-cks">' + list.map(row).join("") + '</ul>' : "") +
      '<form data-form="checklist" data-id="' + esc(r.id) + '" class="ln-ck-add" novalidate><label for="lnCkNew" class="visually-hidden">New step</label><input id="lnCkNew" name="step" type="text" maxlength="200" placeholder="Add a step…" data-fk="step" autocomplete="off"><button type="submit" class="btn btn-secondary">Add step</button><p class="ln-err hidden" data-err="step" role="alert"></p></form>' +
      '<div class="ln-item-btns"><span class="ln-item-sub">Add steps from a template:</span>' +
      L.TEMPLATES.map(function (t) { return '<button type="button" class="ln-link-btn" data-act="ck-template" data-id="' + esc(r.id) + '" data-t="' + t.key + '">' + esc(t.label) + '</button>'; }).join("") + '</div></details>';
  }

  function detail(id) {
    const r = store.get("research", id);
    if (!r) return '<div class="ln-head"><button type="button" class="btn-icon" data-go="research">← Research</button></div><p class="empty-state" data-focus-top>This research topic no longer exists.</p>';
    const S = store.state();
    let h = '<div class="ln-head"><button type="button" class="btn-icon" data-go="research">← Research</button>' +
      '<details class="ln-pop"><summary class="btn btn-secondary ln-more-btn" aria-label="Edit, archive or delete this topic">&#8943;</summary><div class="ln-pop-body"><button type="button" class="btn btn-secondary" data-act="edit-research" data-id="' + esc(r.id) + '">Edit</button>' +
      (r.status === "completed" ? '<button type="button" class="btn btn-secondary" data-act="archive-research" data-id="' + esc(r.id) + '" data-on="' + (r.archived ? "0" : "1") + '">' + (r.archived ? "Unarchive" : "Archive") + '</button>' : "") +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="delete-research" data-id="' + esc(r.id) + '">Delete</button></div></details></div>' +
      '<section class="ln-sec"><h2 class="ln-h2" data-focus-top>' + esc(r.title) + '</h2>' +
      '<div class="ln-badges">' + (r.category ? A.badge("neutral", r.category) : "") + (r.completedAt ? A.badge("green", "Completed " + A.fmtShort(r.completedAt)) : "") + (r.archived ? A.badge("neutral", "Archived") : "") + '</div>' +
      '<label class="visually-hidden" for="lnResStatus">Research status</label><select id="lnResStatus" class="ln-status-sel" data-status-research data-id="' + esc(r.id) + '">' +
      L.RESEARCH_STATUS.map(function (s) { return '<option value="' + s.key + '"' + (r.status === s.key ? " selected" : "") + '>' + esc(s.label) + '</option>'; }).join("") + '</select>' +
      '<p class="ln-text">' + (r.question ? esc(r.question) : '<span class="ln-item-sub">No question yet. Use Edit to add one.</span>') + '</p></section>';

    const notes = L.filterNotes(S.notes, S, { researchId: r.id, sort: "newest" });
    h += '<section class="ln-sec" aria-labelledby="lnRsNotes"><div class="ln-sec-head"><h2 class="ln-label" id="lnRsNotes">Findings and notes (' + notes.length + ')</h2><button type="button" class="ln-link-btn" data-act="add-note" data-type="finding" data-id="' + esc(r.id) + '">+ Finding</button></div>' +
      (notes.length ? '<div class="ln-list">' + notes.map(function (n) { return A.noteCard(n); }).join("") + '</div>' : '<p class="ln-quiet">No findings yet. When a source tells you something, record it with the evidence behind it.</p>') + '</section>';

    h += '<section class="ln-sec" aria-labelledby="lnRsSrc"><div class="ln-sec-head"><h2 class="ln-label" id="lnRsSrc">Sources and links (' + r.sources.length + ')</h2><button type="button" class="ln-link-btn" data-act="add-source" data-id="' + esc(r.id) + '">+ Source</button></div>' +
      (r.sources.length ? '<ul class="ln-sources">' + r.sources.map(function (s) { return sourceRow(r, s); }).join("") + '</ul>' : '<p class="ln-quiet">No sources yet. Add the articles, videos and websites you’re using.</p>') + '</section>';

    const acts = L.actionsFor(S.actions, "research", r.id);
    h += '<details class="ln-more ln-sec" data-keep="rsact_' + esc(r.id) + '"' + (A.state.open["rsact_" + r.id] ? " open" : "") + '><summary>Next steps (' + acts.length + ')</summary>' +
      (acts.length ? '<div class="ln-list">' + acts.map(function (a) { return A.actionRow(a); }).join("") + '</div>' : '<p class="ln-quiet">What will you do with what you’ve found?</p>') +
      '<button type="button" class="btn btn-secondary" data-act="add-action" data-id="' + esc(r.id) + '">+ Add next step</button></details>';

    h += '<details class="ln-more ln-sec" data-keep="rsconc_' + esc(r.id) + '"' + (A.state.open["rsconc_" + r.id] || r.conclusion ? " open" : "") + '><summary>Conclusion' + (r.conclusion ? "" : " (not written)") + '</summary>' +
      '<form data-form="conclusion" data-id="' + esc(r.id) + '" novalidate><div class="form-row"><label for="lnConc" class="visually-hidden">My conclusion</label><textarea id="lnConc" name="conclusion" rows="4" maxlength="5000" placeholder="What do you conclude from what you’ve found? Leave empty until you know." data-fk="conclusion">' + esc(r.conclusion) + '</textarea></div>' +
      '<button type="submit" class="btn btn-secondary">Save conclusion</button><p class="ln-err hidden" data-err="conclusion" role="alert"></p></form></details>';

    h += checklistHtml(r);
    if (r.purpose) h += '<details class="ln-more ln-sec"><summary>Purpose</summary><p class="ln-text">' + esc(r.purpose) + '</p></details>';
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
      else if (act === "res-show") { const v = el.getAttribute("data-v"); A.state.filters.research = Object.assign({}, A.state.filters.research, { status: v === "active" ? "" : v, active: v === "active" }); A.render(); }
      else if (act === "archive-research") setArchived(id, el.getAttribute("data-on") === "1");
      else if (act === "ck-edit") editChecklistItem(id, el.getAttribute("data-ck"));
      else if (act === "ck-delete") deleteChecklistItem(id, el.getAttribute("data-ck"));
      else if (act === "ck-template") applyTemplate(id, el.getAttribute("data-t"));
      else if (act === "add-source") openSourceForm(id, null);
      else if (act === "edit-source") { const r = store.get("research", id); const s = r && r.sources.filter(function (x) { return x.id === el.getAttribute("data-sid"); })[0]; if (s) openSourceForm(id, s); }
      else if (act === "delete-source") deleteSource(id, el.getAttribute("data-sid"));
      else if (act === "add-note") A.editNote(null, { type: el.getAttribute("data-type") || "finding", researchIds: [id] });
      else if (act === "add-action") { const r = store.get("research", id); A.editAction(null, { sourceType: "research", sourceId: id, label: r ? r.title : "" }); }
    },
    change: function (el) {
      if (el.hasAttribute("data-status-research")) { setStatus(el.getAttribute("data-id"), el.value); return; }
      if (el.getAttribute("data-act") !== "ck-toggle") return;
      const r = store.get("research", el.getAttribute("data-id"));
      if (!r) return;
      const had = L.checklistProgress(r);
      if (!store.put("research", L.toggleChecklistItem(r, el.getAttribute("data-ck"), store.today(), Date.now()))) { A.saveFailed(); return; }
      const now = L.checklistProgress(store.get("research", r.id));
      if (now.total && now.done === now.total && had.done < had.total && r.status !== "completed") A.notice("Every step is done. Mark the project completed when you are ready.", "");
    },
    submit: function (form) {
      const k = form.getAttribute("data-form");
      if (k === "conclusion") saveConclusion(form);
      else if (k === "checklist") addChecklistItem(form);
    }
  });
  A.quickAdd.research = function () { openResearchForm(null); };
})();
