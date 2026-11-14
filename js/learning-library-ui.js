/* ==========================================================================
   JARVIS — Learning & Research Hub: the Knowledge library (every note in one searchable place) and the note editor
   and note card that Books and Research use too.

   One kind of record covers takeaways, chapter summaries, quotes, reflections, findings and plain notes. A note can be
   tagged and linked to any number of books and research projects.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;

  const SRS = window.JarvisLearningSRS;
  // The heading over the main text box, by kind of note.
  const TEXT_LABEL = { takeaway: "Takeaway", chapter: "Chapter summary", quote: "Quote", reflection: "Reflection", finding: "Finding", opinion: "My opinion", idea: "Research idea", question: "Question to investigate", note: "Note" };
  const EVIDENCE_LABEL = { finding: "Supporting evidence", opinion: "Why I think this" };
  function typeLabel(t) { return L.labelOf(L.NOTE_TYPE, t) || "Note"; }
  function canRemember(type) { return L.SRS_TYPES.indexOf(type) !== -1; }

  /* ---------------- one note, as a fold-out card ---------------- */

  function noteCard(n) {
    const key = "note_" + n.id, isOpen = !!A.state.open[key], today = store.today();
    const title = n.title || A.snippet(n.text, 100);
    const links = [];
    (n.bookIds || []).forEach(function (id) { const b = store.get("books", id); if (b) links.push('<button type="button" class="ln-link-btn" data-go="books" data-id="' + esc(id) + '">' + esc(b.title) + '</button>'); });
    (n.researchIds || []).forEach(function (id) { const r = store.get("research", id); if (r) links.push('<button type="button" class="ln-link-btn" data-go="research" data-id="' + esc(id) + '">' + esc(r.title) + '</button>'); });
    let src = null;
    if (n.sourceId) (n.researchIds || []).forEach(function (id) { const r = store.get("research", id); const s = r && r.sources.filter(function (x) { return x.id === n.sourceId; })[0]; if (s) src = s; });
    const day = n.day || (n.createdAt ? L.localDate(n.createdAt) : "");
    const due = SRS.isDue(n.srs, today), reviewable = canRemember(n.type);
    const reviewLine = !reviewable ? "" : n.srs && n.srs.on
      ? '<p class="ln-item-sub ln-review-line">Spaced repetition: ' + esc(A.srsLabel(n.srs)) + (n.srs.reviews.length ? " · reviewed " + A.plural(n.srs.reviews.filter(function (r) { return !r.p; }).length, "time") : "") + '</p>'
      : '<p class="ln-item-sub ln-review-line">Not being reviewed.</p>';
    const reviewBtns = !reviewable ? "" : n.srs && n.srs.on
      ? '<button type="button" class="btn btn-secondary" data-act="note-pause" data-id="' + esc(n.id) + '">' + (n.srs.paused ? "Resume reviews" : "Pause reviews") + '</button>' +
        '<button type="button" class="btn btn-secondary" data-act="note-remember" data-id="' + esc(n.id) + '" data-on="0">Stop reviewing</button>'
      : '<button type="button" class="btn btn-secondary" data-act="note-remember" data-id="' + esc(n.id) + '" data-on="1">Remember this</button>';
    return '<details class="ln-note' + (n.title ? "" : " ln-note-plain") + '" id="lnnote_' + esc(n.id) + '" data-keep="' + esc(key) + '"' + (isOpen ? " open" : "") + '>' +
      '<summary class="ln-note-sum"><span class="ln-badges">' + A.badge("accent", typeLabel(n.type)) + (n.important ? A.badge("yellow", "★ Starred") : "") + (n.type === "finding" && !n.evidence ? A.badge("neutral", "No evidence yet") : "") + (due ? A.badge("red", "Review due") : "") + (n.inbox ? A.badge("neutral", "To organize") : "") + '</span>' +
      '<span class="ln-note-title">' + esc(title) + '</span><span class="ln-item-sub">' + esc([day ? A.fmtShort(day) : "", A.noteSource(n)].filter(Boolean).join(" · ")) + '</span></summary>' +
      '<div class="ln-note-body">' +
      (n.type === "quote" ? '<blockquote class="ln-quote">' + esc(n.text) + '</blockquote>' : '<p class="ln-text">' + esc(n.text) + '</p>') +
      (n.evidence ? '<p class="ln-h4">' + esc(EVIDENCE_LABEL[n.type] || "Supporting evidence") + '</p><p class="ln-text">' + esc(n.evidence) + '</p>' : "") +
      (n.page ? '<p class="ln-item-sub">Page or chapter: ' + esc(n.page) + '</p>' : "") +
      (src ? '<p class="ln-item-sub">Source: <a class="ln-link" href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.title) + '<span class="visually-hidden"> (opens in a new tab)</span></a></p>' : "") +
      (n.tags && n.tags.length ? '<div class="ln-chips" role="group" aria-label="Topics">' + n.tags.map(function (t) { return '<button type="button" class="ln-chip" data-act="tag-filter" data-tag="' + esc(t) + '">#' + esc(t) + '</button>'; }).join("") + '</div>' : "") +
      (links.length ? '<p class="ln-links"><span class="ln-item-sub">Linked to</span> ' + links.join(" ") + '</p>' : "") +
      (A.relatedHtml ? A.relatedHtml(n) : "") +
      reviewLine +
      '<div class="ln-item-btns ln-note-btns"><button type="button" class="btn btn-secondary" data-act="note-edit" data-id="' + esc(n.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary" data-act="note-star" data-id="' + esc(n.id) + '" aria-pressed="' + (!!n.important) + '">' + (n.important ? "Unstar" : "Star") + '</button>' +
      (n.inbox ? '<button type="button" class="btn btn-secondary" data-act="note-organized" data-id="' + esc(n.id) + '">Mark organized</button>' : "") +
      '<button type="button" class="btn btn-secondary" data-act="note-action" data-id="' + esc(n.id) + '">Turn into an action</button>' +
      reviewBtns +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="note-delete" data-id="' + esc(n.id) + '">Delete</button></div>' +
      '<details class="ln-more ln-more-act" data-keep="more_' + esc(n.id) + '"' + (A.state.open["more_" + n.id] ? " open" : "") + '><summary>More: link, collect, flashcard</summary><div class="ln-item-btns">' +
      '<button type="button" class="btn btn-secondary" data-act="note-link" data-id="' + esc(n.id) + '">Link to other notes</button>' +
      '<button type="button" class="btn btn-secondary" data-act="note-collect" data-id="' + esc(n.id) + '">Add to a collection</button>' +
      '<button type="button" class="btn btn-secondary" data-act="note-flashcard" data-id="' + esc(n.id) + '">Make a flashcard</button></div></details></div></details>';
  }

  /* ---------------- the editor ---------------- */

  function checks(name, items, selected, label) {
    if (!items.length) return "";
    return '<fieldset class="ln-checks-set"><legend>' + esc(label) + '</legend><div class="ln-checks">' + items.map(function (i) {
      return '<label class="ln-check"><input type="checkbox" name="' + name + '" value="' + esc(i.id) + '" data-multi' + (selected.indexOf(i.id) !== -1 ? " checked" : "") + '><span>' + esc(i.title) + '</span></label>';
    }).join("") + '</div><p class="ln-err hidden" data-err="' + name + '" role="alert"></p></fieldset>';
  }

  function editNote(note, preset) {
    const isNew = !note, p = preset || {};
    const n = note || { type: L.NOTE_TYPE.some(function (t) { return t.key === p.type; }) ? p.type : "takeaway", title: "", text: p.text || "", evidence: "", page: "", tags: p.tags || [], category: "", bookIds: p.bookIds || [], researchIds: p.researchIds || [], sourceId: p.sourceId || "", important: false };
    const S = store.state(), books = store.list("books"), research = store.list("research");
    const topTags = L.allTags(S.notes).slice(0, 8);
    // A new note starts short: its kind and its words. Details (title, topics, links...) open by themselves only when editing a note that has some.
    const moreOpen = !isNew && !!(n.title || n.page || n.category || n.important || (n.bookIds || []).length || (n.researchIds || []).length || (n.tags || []).length || (n.linkIds || []).length);
    const saveTo = isNew ? (n.bookIds || []).map(function (id) { const b = store.get("books", id); return b ? b.title : ""; }).concat((n.researchIds || []).map(function (id) { const r = store.get("research", id); return r ? r.title : ""; })).filter(Boolean) : [];
    const remembered = !!(n.srs && n.srs.on);
    // The two things that matter come first (what kind, and the words); everything else is one tap away.
    const body =
      A.fSelect("type", "Kind of note", A.opts(L.NOTE_TYPE), n.type, { required: true }) +
      A.fArea("text", TEXT_LABEL[n.type] || "Note", n.text, { rows: 5, max: 10000, required: true }) +
      (saveTo.length ? '<p class="ln-item-sub ln-saveto">Saving to ' + esc(saveTo.join(", ")) + '. Change this under More details.</p>' : "") +
      '<div id="lnRememberRow" class="form-row"><label class="ln-check"><input type="checkbox" name="remember"' + (remembered ? " checked" : "") + '><span>Remember this: review it after 1, 3, 7, 14 and 30 days</span></label>' +
      '<p class="field-hint">' + (remembered ? esc(A.srsLabel(n.srs)) + ". Unticking stops the reviews and keeps your history." : "Spaced repetition. You’ll be asked to recall it and can answer Easy, Good, Hard or Forgot.") + '</p></div>' +
      '<div id="lnEvRow">' + A.fArea("evidence", EVIDENCE_LABEL[n.type] || "Supporting evidence", n.evidence, { rows: 3, max: 5000, placeholder: "What backs this up? A figure, a quote, a link…" }) + '</div>' +
      '<details class="ln-more"' + (moreOpen ? " open" : "") + '><summary>More details: title, topics, links</summary>' +
      A.fText("title", "Title", n.title, { max: 200, hint: "Optional. A short heading makes it easier to find." }) +
      A.fText("page", "Page or chapter", n.page, { max: 40, placeholder: "p. 112, Chapter 4…" }) +
      A.fText("tags", "Topics", (n.tags || []).join(", "), { max: 200, placeholder: "habits, sleep, pricing", hint: "Separate topics with commas." }) +
      (topTags.length ? '<div class="ln-chips" role="group" aria-label="Your topics">' + topTags.map(function (t) { return '<button type="button" class="ln-chip" data-sheet-act="tag-add" data-tag="' + esc(t.tag) + '">#' + esc(t.tag) + '</button>'; }).join("") + '</div>' : "") +
      A.fText("category", "Category", n.category, { max: 60, list: "lnCats", hint: "Optional. If empty, the category of the linked book or project is used." }) + A.datalist("lnCats", L.allCategories(S)) +
      checks("bookIds", books, n.bookIds || [], "Link to books") + checks("researchIds", research, n.researchIds || [], "Link to research projects") +
      (!books.length && !research.length ? '<p class="field-hint">Add a book or a research project and you can link notes to it.</p>' : "") +
      '<div id="lnSrcRow" hidden>' + A.fSelect("sourceId", "Source", [["", "No specific source"]], "", {}) + '</div>' +
      (A.linkPickerHtml ? A.linkPickerHtml(note) : "") +
      '<div class="form-row"><label class="ln-check"><input type="checkbox" name="important"' + (n.important ? " checked" : "") + '><span>Mark as important</span></label></div></details>';

    function sync(el) {
      const type = el.querySelector("#lnf_type").value;
      el.querySelector("#lnEvRow").hidden = !EVIDENCE_LABEL[type];
      el.querySelector("#lnRememberRow").hidden = !canRemember(type);
      el.querySelector('label[for="lnf_text"]').firstChild.textContent = TEXT_LABEL[type] || "Note";
      if (EVIDENCE_LABEL[type]) el.querySelector('label[for="lnf_evidence"]').firstChild.textContent = EVIDENCE_LABEL[type];
      // The source menu lists the sources of the linked research projects.
      const ids = Array.prototype.filter.call(el.querySelectorAll('input[name="researchIds"]:checked'), function () { return true; }).map(function (c) { return c.value; });
      const opts = [["", "No specific source"]];
      ids.forEach(function (id) { const r = store.get("research", id); if (r) r.sources.forEach(function (s) { opts.push([s.id, (ids.length > 1 ? r.title + ": " : "") + s.title]); }); });
      const sel = el.querySelector("#lnf_sourceId"), keep = sel.value || n.sourceId || "";
      sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join("");
      sel.value = opts.some(function (o) { return o[0] === keep; }) ? keep : "";
      el.querySelector("#lnSrcRow").hidden = opts.length < 2;
    }
    A.openSheet({
      title: isNew ? "Add a note" : "Edit note", body: body, submit: isNew ? "Save note" : "Save changes", focus: "#lnf_text",
      onOpen: sync,
      onChange: function (t, el) { if (t.id === "lnf_type" || t.name === "researchIds") sync(el); },
      onInput: function (t, el) { if (A.pickFilter) A.pickFilter(el, t); },
      onAct: function (act, btn, el) {
        if (act === "tag-add") {
          const input = el.querySelector("#lnf_tags"), cur = L.parseTags(input.value), t = btn.getAttribute("data-tag");
          if (cur.indexOf(t) === -1) cur.push(t);
          input.value = cur.join(", ");
        }
      },
      onSubmit: function (v) {
        const r = L.checkNote(v, { today: store.today(), books: books, research: research, notes: store.list("notes"), selfId: note ? note.id : "", existingSrs: note ? note.srs : null });
        if (!r.ok) return { ok: false, errors: r.errors };
        const saved = isNew ? store.add("notes", r.value) : store.put("notes", Object.assign({}, note, r.value, { day: note.day || r.value.day }));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(isNew ? "Note saved." : "Note updated.");
        if (isNew) A.notice(saved.srs && saved.srs.on ? "Note saved. First review " + A.fmtShort(saved.srs.due) + "." : "Note saved.", "");
        return { ok: true };
      }
    });
  }

  function deleteNote(id) {
    const n = store.get("notes", id);
    if (!n) return;
    if (!store.remove("notes", id)) { A.saveFailed(); return; }
    A.notice("Note deleted.", "Undo", function () { store.undoRemove("notes", id); });
  }

  function noteClick(act, el) {
    const id = el.getAttribute("data-id");
    if (act === "note-edit") { const n = store.get("notes", id); if (n) editNote(n); return true; }
    if (act === "note-remember") { const n = store.get("notes", id); if (n) { const on = el.getAttribute("data-on") === "1"; if (!store.patch("notes", id, { srs: SRS.setEnabled(n.srs || null, on, store.today()) })) A.saveFailed(); else A.say(on ? "Spaced repetition on. First review " + A.fmtShort(store.get("notes", id).srs.due) + "." : "Reviews stopped."); } return true; }
    if (act === "note-pause") { const n = store.get("notes", id); if (n && n.srs) { const next = n.srs.paused ? SRS.resume(n.srs, store.today()) : SRS.pause(n.srs); if (!store.patch("notes", id, { srs: next })) A.saveFailed(); else A.say(next.paused ? "Reviews paused." : "Reviews resumed."); } return true; }
    if (act === "note-organized") { if (!store.patch("notes", id, { inbox: undefined })) A.saveFailed(); return true; }
    if (act === "note-flashcard") { const n = store.get("notes", id); if (n && A.editCard) A.editCard(null, { question: "", answer: n.text, bookIds: n.bookIds, researchIds: n.researchIds, tags: n.tags, noteId: n.id }); return true; }
    if (act === "note-link") { const n = store.get("notes", id); if (n && A.openLinkSheet) A.openLinkSheet(n); return true; }
    if (act === "note-collect") { const n = store.get("notes", id); if (n && A.openCollectSheet) A.openCollectSheet(n); return true; }
    if (act === "note-star") { const n = store.get("notes", id); if (n && !store.patch("notes", id, { important: !n.important })) A.saveFailed(); return true; }
    if (act === "note-delete") { deleteNote(id); return true; }
    if (act === "note-action") {
      const n = store.get("notes", id);
      if (n) A.editAction(null, { sourceType: "note", sourceId: id, lesson: A.snippet(n.title || n.text, 480) });
      return true;
    }
    if (act === "tag-filter") { A.state.kpart = "notes"; A.go("knowledge", "", { replaceFilters: Object.assign({}, A.DEFAULT_FILTERS.knowledge, { tag: el.getAttribute("data-tag") }) }); return true; }
    return false;
  }

  /* ---------------- the Knowledge library ---------------- */

  function rangeBounds(r, today) {
    if (r === "7") return { from: L.addDays(today, -6), to: today };
    if (r === "30") return { from: L.addDays(today, -29), to: today };
    if (r === "90") return { from: L.addDays(today, -89), to: today };
    if (r === "year") return { from: today.slice(0, 4) + "-01-01", to: today };
    return {};
  }
  function logicFilter() {
    const f = A.state.filters.knowledge, b = rangeBounds(f.range, store.today());
    return { q: f.q, type: f.type, tag: f.tag, category: f.category, bookId: f.book, researchId: f.research, important: f.starred === "1", from: b.from, to: b.to, sort: f.sort };
  }
  function results() {
    const S = store.state(), notes = L.filterNotes(S.notes, S, logicFilter());
    if (!notes.length) {
      return L.live(S.notes).length
        ? '<p class="empty-state">No notes match. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>'
        : '<div class="empty-state"><p>Your library is empty.</p><p class="field-hint">Notes you add to a book, a research project or here all end up in this one searchable place.</p><button type="button" class="btn btn-primary" data-act="add-note-lib">Add your first note</button></div>';
    }
    return '<div class="ln-list">' + notes.map(noteCard).join("") + '</div>';
  }
  function count() {
    const S = store.state(), n = L.filterNotes(S.notes, S, logicFilter()).length, total = L.live(S.notes).length;
    return n === total ? A.plural(total, "note") : n + " of " + total + " notes";
  }
  function notesBody() {
    const S = store.state();
    const tags = L.allTags(S.notes), cats = L.allCategories(S);
    return (A.inboxHtml ? A.inboxHtml() : "") +
      A.toolbar("knowledge", [
        { name: "q", kind: "search", label: "Search all notes", placeholder: "Search your notes" },
        { name: "type", kind: "select", label: "Filter by kind of note", options: [["", "All kinds"]].concat(L.NOTE_TYPE.map(function (t) { return [t.key, t.label]; })) },
        { name: "tag", kind: "select", label: "Filter by topic", options: [["", "All topics"]].concat(tags.map(function (t) { return [t.tag, "#" + t.tag + " (" + t.count + ")"]; })) },
        { name: "category", kind: "select", label: "Filter by category", options: [["", "All categories"]].concat(cats.map(function (c) { return [c, c]; })) },
        { name: "book", kind: "select", label: "Filter by book", options: [["", "All books"]].concat(store.list("books").map(function (b) { return [b.id, b.title]; })) },
        { name: "research", kind: "select", label: "Filter by research project", options: [["", "All projects"]].concat(store.list("research").map(function (r) { return [r.id, r.title]; })) },
        { name: "range", kind: "select", label: "Filter by date", options: [["", "Any date"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["year", "This year"]] },
        { name: "starred", kind: "select", label: "Starred notes", options: [["", "All notes"], ["1", "Starred only"]] },
        { name: "sort", kind: "select", label: "Sort notes", options: [["newest", "Newest first"], ["oldest", "Oldest first"], ["type", "By kind"]] }
      ], { fold: 1 }) +
      '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(count()) + '</p><div id="lnResults">' + results() + '</div>';
  }

  // Knowledge has three views: your notes, your topics, and collections. The last two are in learning-topics-ui.js.
  const PARTS = [["notes", "Notes"], ["topics", "Topics"], ["collections", "Collections"]];
  A.state.kpart = "notes";
  A.kparts = A.kparts || {};
  function view() {
    if (A.state.openNote) A.state.kpart = "notes";
    let part = A.state.kpart;
    if (part !== "notes" && !A.kparts[part]) part = A.state.kpart = "notes";
    const add = part === "collections" ? '<button type="button" class="btn btn-primary" data-act="coll-add">+ New collection</button>' : part === "notes" ? '<button type="button" class="btn btn-primary" data-act="add-note-lib">+ Add note</button>' : "";
    const seg = '<div class="ln-seg ln-seg-parts ln-seg-3" role="group" aria-label="Knowledge views">' + PARTS.map(function (x) {
      return '<button type="button" class="ln-seg-btn" data-act="kpart" data-v="' + x[0] + '" aria-pressed="' + (part === x[0]) + '">' + x[1] + '</button>';
    }).join("") + '</div>';
    return '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Knowledge</h2>' + add + '</div>' + seg + (part === "notes" ? notesBody() : A.kparts[part].html());
  }
  A.acts["kpart"] = function (el) { A.state.kpart = el.getAttribute("data-v"); A.state.collId = ""; A.render(); };
  function activeResults() { const p = A.kparts[A.state.kpart]; return p && p.results ? p.results() : results(); }
  function activeCount() { const p = A.kparts[A.state.kpart]; return p && p.count ? p.count() : count(); }

  A.register("knowledge", {
    html: view,
    results: activeResults,
    count: activeCount,
    after: function (host) {
      const id = A.state.openNote;
      if (!id) return;
      A.state.openNote = "";
      const el = host.querySelector("#lnnote_" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
      if (el) { el.open = true; A.state.open["note_" + id] = true; el.scrollIntoView({ block: "center" }); const s = el.querySelector("summary"); if (s) s.focus({ preventScroll: true }); }
    },
    click: function (act) {
      if (act === "add-note-lib") editNote(null, { type: "takeaway" });
    }
  });
  A.quickAdd.note = function () { editNote(null, { type: "takeaway" }); };
  A.noteCard = noteCard;
  A.checks = checks;
  A.typeLabel = typeLabel;
  A.editNote = editNote;
  A.noteClick = noteClick;
})();
