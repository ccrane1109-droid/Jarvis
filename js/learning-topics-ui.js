/* ==========================================================================
   JARVIS — Learning & Research Hub: connecting ideas.
     - "Related ideas" inside every note (links you made, shared topics, similar wording, with the reason for each)
     - linking notes to each other, from the editor or the note's "More" menu
     - the Topics view in Knowledge (every topic with its notes, books and projects; rename or merge a topic)
     - Collections: gather notes, books and research around a subject, optionally filled by a topic
   The rules are in learning-links-logic.js. Plain tags, manual links and word matching on this device; no AI.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc, LK = window.JarvisLearningLinks;

  function plural(n, a, b) { return A.plural(n, a, b); }
  function today() { return store.today(); }

  /* ---------------- related ideas, shown inside a note ---------------- */

  function reasonText(r) {
    return r.reasons.map(function (x) { return x.kind === "link" ? x.detail : x.kind === "topic" ? "Shares " + x.detail : "Similar words: " + x.detail; }).join(" · ");
  }
  A.relatedHtml = function (n) {
    const S = store.state(), rel = LK.related(n, S, 4), books = LK.booksDiscussing(n, S).slice(0, 4), colls = LK.collectionsOf(n, S.collections);
    if (!rel.length && !books.length && !colls.length) return "";
    let h = '<div class="ln-related">';
    if (rel.length) h += '<p class="ln-h4">Related ideas</p><ul class="ln-rv-list">' + rel.map(function (r) {
      return '<li class="ln-rv-item"><button type="button" class="ln-link-btn ln-link-block" data-go="knowledge" data-open-note="' + esc(r.note.id) + '">' + esc(A.typeLabel(r.note.type) + ": " + A.snippet(r.note.title || r.note.text, 90)) + '</button><span class="ln-item-sub">' + esc(reasonText(r)) + '</span></li>';
    }).join("") + '</ul>';
    if (books.length) h += '<p class="ln-links"><span class="ln-item-sub">Also discussed in</span> ' + books.map(function (b) { return '<button type="button" class="ln-link-btn" data-go="books" data-id="' + esc(b.book.id) + '">' + esc(b.book.title) + '</button>'; }).join(" ") + '</p>';
    if (colls.length) h += '<p class="ln-links"><span class="ln-item-sub">In collections</span> ' + colls.map(function (c) { return '<button type="button" class="ln-link-btn" data-act="coll-open" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>'; }).join(" ") + '</p>';
    return h + '</div>';
  };

  /* ---------------- a list of checkboxes you can narrow by typing ---------------- */

  function pickerHtml(name, label, items, selected) {
    return '<fieldset class="ln-checks-set"><legend>' + esc(label) + '</legend>' +
      '<input type="search" class="ln-pick-search" data-pick aria-label="Type to narrow the list: ' + esc(label) + '" placeholder="Type to narrow the list" autocomplete="off">' +
      '<div class="ln-checks ln-pick-list">' + (items.length ? items.map(function (i) {
        return '<label class="ln-check" data-text="' + esc(i.text.toLowerCase()) + '"><input type="checkbox" name="' + name + '" value="' + esc(i.id) + '" data-multi' + (selected.indexOf(i.id) !== -1 ? " checked" : "") + '><span>' + esc(i.text) + '</span></label>';
      }).join("") : '<p class="field-hint ln-pick-empty">Nothing to choose from yet.</p>') + '</div><p class="ln-err hidden" data-err="' + name + '" role="alert"></p></fieldset>';
  }
  A.pickFilter = function (el, target) {
    if (!target || !target.hasAttribute || !target.hasAttribute("data-pick")) return;
    const q = target.value.trim().toLowerCase();
    Array.prototype.forEach.call(target.closest("fieldset").querySelectorAll(".ln-pick-list .ln-check"), function (l) { l.hidden = !!q && l.getAttribute("data-text").indexOf(q) === -1; });
  };
  function noteItems(excludeId, selected) {
    const list = store.list("notes").filter(function (n) { return n.id !== excludeId; }).sort(function (a, b) {
      const sa = selected.indexOf(a.id) !== -1 ? 0 : 1, sb = selected.indexOf(b.id) !== -1 ? 0 : 1;
      return sa - sb || (b.createdAt || 0) - (a.createdAt || 0);
    }).slice(0, 200);
    return list.map(function (n) { return { id: n.id, text: A.typeLabel(n.type) + ": " + A.snippet(n.title || n.text, 80) }; });
  }
  // The "link to other notes" part of the note editor.
  A.linkPickerHtml = function (note) {
    const sel = note ? note.linkIds || [] : [];
    return pickerHtml("linkIds", "Link to other notes", noteItems(note ? note.id : "", sel), sel);
  };
  A.openLinkSheet = function (note) {
    const sel = note.linkIds || [];
    A.openSheet({
      title: "Link to other notes", body: '<p class="field-hint">Choose notes that belong with this one. Links work both ways, and they show up as related ideas.</p>' + pickerHtml("linkIds", "Notes", noteItems(note.id, sel), sel), submit: "Save links", focus: "[data-pick]",
      onInput: function (t, el) { A.pickFilter(el, t); },
      onSubmit: function (v) {
        const ids = (v.linkIds || []).filter(function (id) { return store.get("notes", id) && id !== note.id; });
        if (!store.patch("notes", note.id, { linkIds: ids })) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(ids.length ? "Links saved." : "Links removed.");
        return { ok: true };
      }
    });
  };

  /* ---------------- adding a note to collections ---------------- */

  A.openCollectSheet = function (note) {
    const colls = store.list("collections");
    const rows = colls.length ? '<fieldset class="ln-checks-set"><legend>Collections</legend><div class="ln-checks">' + colls.map(function (c) {
      const byTopic = c.tag && (note.tags || []).indexOf(c.tag) !== -1, added = (c.noteIds || []).indexOf(note.id) !== -1;
      return '<label class="ln-check"><input type="checkbox" name="collIds" value="' + esc(c.id) + '" data-multi' + (added || byTopic ? " checked" : "") + (byTopic && !added ? " disabled" : "") + '><span>' + esc(c.name) + (byTopic && !added ? ' (included by its topic #' + esc(c.tag) + ')' : "") + '</span></label>';
    }).join("") + '</div></fieldset>' : '<p class="field-hint">You have no collections yet. Make one below.</p>';
    A.openSheet({
      title: "Add to a collection", body: rows + A.fText("newName", "Or start a new collection", "", { max: 80, placeholder: "e.g. Pricing psychology" }), submit: "Save", focus: colls.length ? "" : "#lnf_newName",
      onSubmit: function (v) {
        const picked = v.collIds || [], now = Date.now();
        let ok = true;
        colls.forEach(function (c) {
          // a collection that has this note only through its topic shows a disabled box and is not changed here
          const was = (c.noteIds || []).indexOf(note.id) !== -1, want = picked.indexOf(c.id) !== -1;
          if (was !== want) ok = !!store.put("collections", LK.withMember(c, "notes", note.id, want, now)) && ok;
        });
        const name = (v.newName || "").trim();
        if (name) {
          const r = LK.check({ name: name, noteIds: [note.id] }, { notes: store.list("notes") });
          if (!r.ok) return { ok: false, errors: { newName: r.errors.name } };
          ok = !!store.add("collections", r.value) && ok;
        }
        if (!ok) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say("Collections updated.");
        return { ok: true };
      }
    });
  };

  /* ---------------- Topics ---------------- */

  function topicsResults() {
    const S = store.state(), q = (A.state.filters.knowledge.tq || "").trim().toLowerCase();
    let list = LK.topics(S);
    if (q) list = list.filter(function (t) { return t.tag.indexOf(q.replace(/^#/, "")) !== -1; });
    if (!list.length) return LK.topics(S).length ? '<p class="empty-state">No topics match. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>' : '<div class="empty-state"><p>No topics yet.</p><p class="field-hint">A topic is a tag. Add topics like “habits” or “pricing” when you save a note or flashcard, and they appear here with everything that touches them.</p></div>';
    return '<div class="ln-list">' + list.map(function (t) {
      return '<article class="card ln-card ln-topic"><h3 class="ln-goal-title">#' + esc(t.tag) + '</h3><p class="ln-item-sub">' + esc([plural(t.notes, "note"), t.cards ? plural(t.cards, "flashcard") : ""].filter(Boolean).join(" · ")) + '</p>' +
        (t.books.length ? '<p class="ln-links"><span class="ln-item-sub">Books</span> ' + t.books.slice(0, 6).map(function (b) { return '<button type="button" class="ln-link-btn" data-go="books" data-id="' + esc(b.id) + '">' + esc(b.title) + '</button>'; }).join(" ") + '</p>' : "") +
        (t.research.length ? '<p class="ln-links"><span class="ln-item-sub">Research</span> ' + t.research.slice(0, 6).map(function (r) { return '<button type="button" class="ln-link-btn" data-go="research" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button>'; }).join(" ") + '</p>' : "") +
        '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="topic-open" data-tag="' + esc(t.tag) + '">Open notes</button><button type="button" class="btn btn-secondary" data-act="topic-collection" data-tag="' + esc(t.tag) + '">Make a collection</button><button type="button" class="btn btn-secondary" data-act="topic-rename" data-tag="' + esc(t.tag) + '">Rename</button></div></article>';
    }).join("") + '</div>';
  }
  function topicsCount() { const n = LK.topics(store.state()).length; return plural(n, "topic"); }
  A.kparts.topics = {
    html: function () {
      return A.toolbar("knowledge", [{ name: "tq", kind: "search", label: "Search topics", placeholder: "Search topics" }]) +
        '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(topicsCount()) + '</p><div id="lnResults">' + topicsResults() + '</div>';
    },
    results: topicsResults, count: topicsCount
  };

  A.acts["topic-open"] = function (el) { A.state.kpart = "notes"; A.go("knowledge", "", { replaceFilters: Object.assign({}, A.DEFAULT_FILTERS.knowledge, { tag: el.getAttribute("data-tag") }) }); };
  A.acts["topic-collection"] = function (el) { const t = el.getAttribute("data-tag"); openCollectionForm(null, { name: t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " "), tag: t }); };
  A.acts["topic-rename"] = function (el) {
    const from = el.getAttribute("data-tag"), S = store.state();
    A.openSheet({
      title: "Rename topic #" + from, body: A.fText("to", "New name", from, { max: 30, required: true, hint: "If a topic with that name already exists, the two are merged." }), submit: "Rename", focus: "#lnf_to",
      onSubmit: function (v) {
        const target = L.parseTags([v.to])[0];
        if (!target) return { ok: false, errors: { to: "Type a name for the topic." } };
        if (target === from) return { ok: true };
        const changes = { notes: LK.renameTag(S.notes, from, target), cards: LK.renameTag(S.cards, from, target) };
        const colls = L.live(S.collections).filter(function (c) { return c.tag === from; });
        let ok = true;
        changes.notes.forEach(function (c) { ok = !!store.put("notes", c.after) && ok; });
        changes.cards.forEach(function (c) { ok = !!store.put("cards", c.after) && ok; });
        colls.forEach(function (c) { ok = !!store.put("collections", Object.assign({}, c, { tag: target })) && ok; });
        if (!ok) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.notice("#" + from + " is now #" + target + " on " + plural(changes.notes.length + changes.cards.length, "item") + ".", "Undo", function () {
          changes.notes.forEach(function (c) { store.put("notes", c.before); });
          changes.cards.forEach(function (c) { store.put("cards", c.before); });
          colls.forEach(function (c) { store.put("collections", c); });
        });
        return { ok: true };
      }
    });
  };

  /* ---------------- Collections ---------------- */

  function openCollectionForm(coll, preset) {
    const isNew = !coll, p = preset || {}, tags = L.allTags(store.list("notes").concat(store.list("cards")));
    const c = coll || { name: p.name || "", description: "", tag: p.tag || "" };
    A.openSheet({
      title: isNew ? "New collection" : "Edit collection",
      body: A.fText("name", "Name", c.name, { max: 80, required: true, placeholder: "e.g. Pricing psychology" }) + A.fText("description", "What is it about? (optional)", c.description, { max: 300 }) +
        A.fText("tag", "Topic (optional)", c.tag, { max: 30, list: "lnCollTags", hint: "Every note and flashcard with this topic is included automatically." }) + A.datalist("lnCollTags", tags.map(function (t) { return t.tag; })),
      submit: isNew ? "Create collection" : "Save changes", focus: "#lnf_name",
      onSubmit: function (v) {
        const r = LK.check(Object.assign({}, v, { noteIds: coll ? coll.noteIds : [], bookIds: coll ? coll.bookIds : [], researchIds: coll ? coll.researchIds : [] }), {});
        if (!r.ok) return { ok: false, errors: r.errors };
        const saved = isNew ? store.add("collections", r.value) : store.put("collections", Object.assign({}, coll, r.value));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.state.kpart = "collections";
        A.notice(isNew ? "Collection created." : "Collection updated.", isNew ? "Open" : "", isNew ? function () { A.state.collId = saved.id; A.state.kpart = "collections"; A.go("knowledge", ""); } : null);
        return { ok: true };
      }
    });
  }
  function openItemsSheet(coll) {
    const S = store.state(), notes = noteItems("", coll.noteIds || []);
    A.openSheet({
      title: "Add to “" + A.snippet(coll.name, 40) + "”",
      body: pickerHtml("noteIds", "Notes", notes, coll.noteIds || []) + A.checks("bookIds", L.live(S.books), coll.bookIds || [], "Books") + A.checks("researchIds", L.live(S.research), coll.researchIds || [], "Research projects"),
      submit: "Save", focus: "[data-pick]",
      onInput: function (t, el) { A.pickFilter(el, t); },
      onSubmit: function (v) {
        const shown = notes.map(function (n) { return n.id; });
        const keep = (coll.noteIds || []).filter(function (id) { return shown.indexOf(id) === -1; });
        const r = LK.check({ name: coll.name, description: coll.description, tag: coll.tag, noteIds: keep.concat(v.noteIds || []), bookIds: v.bookIds || [], researchIds: v.researchIds || [] }, { notes: store.list("notes"), books: store.list("books"), research: store.list("research") });
        if (!r.ok) return { ok: false, errors: r.errors };
        if (!store.put("collections", Object.assign({}, coll, r.value))) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say("Collection updated.");
        return { ok: true };
      }
    });
  }

  function collectionsList() {
    const S = store.state(), list = store.list("collections").sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    if (!list.length) return '<div class="empty-state"><p>No collections yet.</p><p class="field-hint">A collection gathers notes, books and research around one subject, like “Pricing psychology”. Give it a topic and it fills itself with every note and flashcard tagged with that topic.</p><button type="button" class="btn btn-primary" data-act="coll-add">Create your first collection</button></div>';
    return '<div class="ln-grid ln-grid-wide">' + list.map(function (c) {
      const x = LK.contents(c, S);
      return '<article class="card ln-card ln-coll"><div class="ln-badges">' + (c.tag ? A.badge("accent", "#" + c.tag) : "") + '</div><h3 class="ln-goal-title">' + esc(c.name) + '</h3>' + (c.description ? '<p class="ln-item-sub">' + esc(c.description) + '</p>' : "") +
        '<p class="ln-item-sub">' + esc([plural(x.notes.length, "note"), plural(x.books.length, "book"), plural(x.research.length, "project")].join(" · ")) + '</p>' +
        '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="coll-open" data-id="' + esc(c.id) + '">Open</button></div></article>';
    }).join("") + '</div>';
  }
  function collectionDetail(id) {
    const c = store.get("collections", id);
    if (!c) return '<div class="ln-head"><button type="button" class="btn-icon" data-act="coll-back">← All collections</button></div><p class="empty-state" data-focus-top>This collection no longer exists.</p>';
    const S = store.state(), x = LK.contents(c, S);
    let h = '<div class="ln-head"><button type="button" class="btn-icon" data-act="coll-back">← All collections</button><div class="ln-head-btns"><button type="button" class="btn btn-secondary" data-act="coll-edit" data-id="' + esc(c.id) + '">Edit</button><button type="button" class="btn btn-secondary ln-danger" data-act="coll-delete" data-id="' + esc(c.id) + '">Delete</button></div></div>' +
      '<section class="card ln-card"><h2 class="ln-h2" data-focus-top>' + esc(c.name) + '</h2>' + (c.description ? '<p class="ln-text">' + esc(c.description) + '</p>' : "") +
      (c.tag ? '<p class="ln-item-sub">Includes every note and flashcard with the topic #' + esc(c.tag) + '.</p>' : '<p class="ln-item-sub">Add notes, books and research by hand, or give it a topic to fill it automatically (Edit).</p>') +
      '<button type="button" class="btn btn-primary" data-act="coll-items" data-id="' + esc(c.id) + '">Add notes, books or research</button></section>';
    h += '<section class="card ln-card" aria-labelledby="lnCollNotes"><div class="card-title-row"><h2 class="card-title" id="lnCollNotes">Notes (' + x.notes.length + ')</h2></div>' +
      (x.notes.length ? '<div class="ln-list">' + x.notes.map(function (e) {
        return '<div class="ln-coll-note">' + A.noteCard(e.note) + (e.via === "added" ? '<button type="button" class="btn btn-secondary ln-coll-remove" data-act="coll-remove" data-id="' + esc(c.id) + '" data-kind="notes" data-item="' + esc(e.note.id) + '">Remove from this collection</button>' : '<p class="ln-item-sub">Included by its topic #' + esc(c.tag) + '</p>') + '</div>';
      }).join("") + '</div>' : '<p class="empty-state-compact">No notes yet.</p>') + '</section>';
    const rows = function (items, kind, tab) {
      return items.length ? '<ul class="ln-sched">' + items.map(function (it) { return '<li class="ln-sched-row"><button type="button" class="ln-link-btn ln-link-block" data-go="' + tab + '" data-id="' + esc(it.id) + '">' + esc(it.title) + '</button><button type="button" class="btn btn-secondary" data-act="coll-remove" data-id="' + esc(c.id) + '" data-kind="' + kind + '" data-item="' + esc(it.id) + '">Remove</button></li>'; }).join("") + '</ul>' : '<p class="empty-state-compact">None yet.</p>';
    };
    h += '<section class="card ln-card" aria-labelledby="lnCollBooks"><div class="card-title-row"><h2 class="card-title" id="lnCollBooks">Books (' + x.books.length + ')</h2></div>' + rows(x.books, "books", "books") + '</section>' +
      '<section class="card ln-card" aria-labelledby="lnCollRes"><div class="card-title-row"><h2 class="card-title" id="lnCollRes">Research (' + x.research.length + ')</h2></div>' + rows(x.research, "research", "research") + '</section>';
    if (x.cards.length) h += '<section class="card ln-card"><div class="card-title-row"><h2 class="card-title">Flashcards with this topic (' + x.cards.length + ')</h2></div><div class="ln-list">' + x.cards.map(function (cd) { return A.cardRow ? A.cardRow(cd) : ""; }).join("") + '</div></section>';
    return h;
  }
  A.kparts.collections = { html: function () { return A.state.collId ? collectionDetail(A.state.collId) : collectionsList(); } };

  A.acts["coll-add"] = function () { openCollectionForm(null, {}); };
  A.acts["coll-open"] = function (el) { A.state.kpart = "collections"; A.state.collId = el.getAttribute("data-id"); A.go("knowledge", ""); };
  A.acts["coll-back"] = function () { A.state.collId = ""; A.render(); };
  A.acts["coll-edit"] = function (el) { const c = store.get("collections", el.getAttribute("data-id")); if (c) openCollectionForm(c); };
  A.acts["coll-items"] = function (el) { const c = store.get("collections", el.getAttribute("data-id")); if (c) openItemsSheet(c); };
  A.acts["coll-remove"] = function (el) {
    const c = store.get("collections", el.getAttribute("data-id"));
    if (!c) return;
    const before = c, next = LK.withMember(c, el.getAttribute("data-kind"), el.getAttribute("data-item"), false, Date.now());
    if (!store.put("collections", next)) { A.saveFailed(); return; }
    A.notice("Removed from the collection.", "Undo", function () { store.put("collections", before); });
  };
  A.acts["coll-delete"] = function (el) {
    const id = el.getAttribute("data-id"), c = store.get("collections", id);
    if (!c) return;
    A.confirmSheet({ title: "Delete this collection?", text: "“" + c.name + "” will be removed. The notes, books and research in it are not deleted. You can undo for a few seconds afterwards.", yes: "Delete collection",
      onYes: function () {
        if (!store.remove("collections", id)) { A.saveFailed(); return; }
        A.state.collId = "";
        A.render();
        A.notice("Collection deleted.", "Undo", function () { store.undoRemove("collections", id); });
      } });
  };
})();
