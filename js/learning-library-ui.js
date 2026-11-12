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

  const TYPE_LABEL = { takeaway: "Takeaway", chapter: "Chapter summary", quote: "Quote", reflection: "Reflection", finding: "Finding", note: "Note" };

  /* ---------------- one note, as a fold-out card ---------------- */

  function noteCard(n) {
    const S = store.state(), key = "note_" + n.id, isOpen = !!A.state.open[key];
    const title = n.title || A.snippet(n.text, 100);
    const links = [];
    (n.bookIds || []).forEach(function (id) { const b = store.get("books", id); if (b) links.push('<button type="button" class="ln-link-btn" data-go="books" data-id="' + esc(id) + '">' + esc(b.title) + '</button>'); });
    (n.researchIds || []).forEach(function (id) { const r = store.get("research", id); if (r) links.push('<button type="button" class="ln-link-btn" data-go="research" data-id="' + esc(id) + '">' + esc(r.title) + '</button>'); });
    let src = null;
    if (n.sourceId) (n.researchIds || []).forEach(function (id) { const r = store.get("research", id); const s = r && r.sources.filter(function (x) { return x.id === n.sourceId; })[0]; if (s) src = s; });
    const day = n.day || (n.createdAt ? L.localDate(n.createdAt) : "");
    return '<details class="ln-note' + (n.title ? "" : " ln-note-plain") + '" id="lnnote_' + esc(n.id) + '" data-keep="' + esc(key) + '"' + (isOpen ? " open" : "") + '>' +
      '<summary class="ln-note-sum"><span class="ln-badges">' + A.badge("accent", TYPE_LABEL[n.type] || "Note") + (n.important ? A.badge("yellow", "★ Starred") : "") + '</span>' +
      '<span class="ln-note-title">' + esc(title) + '</span><span class="ln-item-sub">' + esc([day ? A.fmtShort(day) : "", A.noteSource(n)].filter(Boolean).join(" · ")) + '</span></summary>' +
      '<div class="ln-note-body">' +
      (n.type === "quote" ? '<blockquote class="ln-quote">' + esc(n.text) + '</blockquote>' : '<p class="ln-text">' + esc(n.text) + '</p>') +
      (n.evidence ? '<p class="ln-h4">Supporting evidence</p><p class="ln-text">' + esc(n.evidence) + '</p>' : "") +
      (n.page ? '<p class="ln-item-sub">Page or chapter: ' + esc(n.page) + '</p>' : "") +
      (src ? '<p class="ln-item-sub">Source: <a class="ln-link" href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.title) + '<span class="visually-hidden"> (opens in a new tab)</span></a></p>' : "") +
      (n.tags && n.tags.length ? '<div class="ln-chips" role="group" aria-label="Topics">' + n.tags.map(function (t) { return '<button type="button" class="ln-chip" data-act="tag-filter" data-tag="' + esc(t) + '">#' + esc(t) + '</button>'; }).join("") + '</div>' : "") +
      (links.length ? '<p class="ln-links"><span class="ln-item-sub">Linked to</span> ' + links.join(" ") + '</p>' : "") +
      '<div class="ln-item-btns ln-note-btns"><button type="button" class="btn btn-secondary" data-act="note-edit" data-id="' + esc(n.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary" data-act="note-star" data-id="' + esc(n.id) + '" aria-pressed="' + (!!n.important) + '">' + (n.important ? "Unstar" : "Star") + '</button>' +
      '<button type="button" class="btn btn-secondary" data-act="note-action" data-id="' + esc(n.id) + '">Turn into an action</button>' +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="note-delete" data-id="' + esc(n.id) + '">Delete</button></div></div></details>';
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
    const body =
      A.fSelect("type", "Kind of note", A.opts(L.NOTE_TYPE), n.type, { required: true }) +
      A.fText("title", "Title", n.title, { max: 200, hint: "Optional. A short heading makes it easier to find." }) +
      A.fArea("text", TYPE_LABEL[n.type] || "Note", n.text, { rows: 5, max: 10000, required: true }) +
      '<div id="lnEvRow">' + A.fArea("evidence", "Supporting evidence", n.evidence, { rows: 3, max: 5000, placeholder: "What backs this finding up? A figure, a quote, a link…" }) + '</div>' +
      A.fText("page", "Page or chapter", n.page, { max: 40, placeholder: "p. 112, Chapter 4…" }) +
      A.fText("tags", "Topics", (n.tags || []).join(", "), { max: 200, placeholder: "habits, sleep, pricing", hint: "Separate topics with commas." }) +
      (topTags.length ? '<div class="ln-chips" role="group" aria-label="Your topics">' + topTags.map(function (t) { return '<button type="button" class="ln-chip" data-sheet-act="tag-add" data-tag="' + esc(t.tag) + '">#' + esc(t.tag) + '</button>'; }).join("") + '</div>' : "") +
      A.fText("category", "Category", n.category, { max: 60, list: "lnCats", hint: "Optional. If empty, the category of the linked book or project is used." }) + A.datalist("lnCats", L.allCategories(S)) +
      checks("bookIds", books, n.bookIds || [], "Link to books") + checks("researchIds", research, n.researchIds || [], "Link to research projects") +
      (!books.length && !research.length ? '<p class="field-hint">Add a book or a research project and you can link notes to it.</p>' : "") +
      '<div id="lnSrcRow" hidden>' + A.fSelect("sourceId", "Source", [["", "No specific source"]], "", {}) + '</div>' +
      '<div class="form-row"><label class="ln-check"><input type="checkbox" name="important"' + (n.important ? " checked" : "") + '><span>Mark as important</span></label></div>';

    function sync(el) {
      const type = el.querySelector("#lnf_type").value;
      el.querySelector("#lnEvRow").hidden = type !== "finding";
      el.querySelector('label[for="lnf_text"]').firstChild.textContent = TYPE_LABEL[type] || "Note";
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
      onAct: function (act, btn, el) {
        if (act === "tag-add") {
          const input = el.querySelector("#lnf_tags"), cur = L.parseTags(input.value), t = btn.getAttribute("data-tag");
          if (cur.indexOf(t) === -1) cur.push(t);
          input.value = cur.join(", ");
        }
      },
      onSubmit: function (v) {
        const r = L.checkNote(v, { today: store.today(), books: books, research: research });
        if (!r.ok) return { ok: false, errors: r.errors };
        const saved = isNew ? store.add("notes", r.value) : store.put("notes", Object.assign({}, note, r.value, { day: note.day || r.value.day }));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(isNew ? "Note saved." : "Note updated.");
        if (isNew) A.notice("Note saved.", "");
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
    if (act === "note-star") { const n = store.get("notes", id); if (n && !store.patch("notes", id, { important: !n.important })) A.saveFailed(); return true; }
    if (act === "note-delete") { deleteNote(id); return true; }
    if (act === "note-action") {
      const n = store.get("notes", id);
      if (n) A.editAction(null, { sourceType: "note", sourceId: id, lesson: A.snippet(n.title || n.text, 480) });
      return true;
    }
    if (act === "tag-filter") { A.go("knowledge", "", { replaceFilters: Object.assign({}, A.DEFAULT_FILTERS.knowledge, { tag: el.getAttribute("data-tag") }) }); return true; }
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
  function view() {
    const S = store.state();
    const tags = L.allTags(S.notes), cats = L.allCategories(S);
    return '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Knowledge</h2><button type="button" class="btn btn-primary" data-act="add-note-lib">+ Add note</button></div>' +
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

  A.register("knowledge", {
    html: view,
    results: results,
    count: count,
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
  A.editNote = editNote;
  A.noteClick = noteClick;
})();
