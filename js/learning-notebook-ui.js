/* ==========================================================================
   JARVIS — Learning & Research Hub: a book's notebook (the part of a book's page where you write while you read).
   The rules live in learning-notebook-logic.js; this draws them and handles taps. Registered with learning-ui.js through
   window.JarvisLearning (A.acts for taps, A.notebook for what the Books screen needs).

   Writing:   "Add notes" opens one form for a new reading session. It saves by itself a moment after you stop typing, and when
              you close it, switch app or refresh, so closing never loses what you wrote. A new session is its own record; an
              earlier session is only ever changed by opening that session and editing it.
   Reading:   sessions are listed oldest first (a notebook's order) under Notebook, with the same notes gathered by kind under
              Lessons, Quotes and Actions. One search box filters all four. Older notes about the book (saved before the
              notebook existed) are shown with the sessions, unchanged.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning, N = window.JarvisLearningNotebook;
  if (!A || !N) return;
  const L = A.L, store = A.store, esc = A.esc;
  const SAVE_AFTER_MS = 700;
  const TABS = [["notebook", "Notebook"], ["lessons", "Lessons"], ["quotes", "Quotes"], ["actions", "Actions"]];

  // What is shown for the book being looked at; reset when another book is opened.
  const ui = { bookId: "", tab: "notebook", q: "", view: "date" };
  function forBook(id) { if (ui.bookId !== id) { ui.bookId = id; ui.tab = "notebook"; ui.q = ""; ui.view = "date"; } }
  function $(id) { return document.getElementById(id); }
  function model(book) { return N.notebook(book, store.state(), { q: ui.q, view: ui.view }); }
  function longDate(d) { return d ? A.fmtDate(d) : "No date"; }
  function sessionKey(id) { return "bns_" + id; }
  function noteKey(id) { return "note_" + id; }

  /* ---------------- the facts at the top of a book ---------------- */

  function factsHtml(book) {
    const nb = N.notebook(book, store.state(), {});
    const bits = [A.plural(nb.totalSessions, "reading session")];
    if (nb.lastDay) bits.push("Last read " + A.fmtDate(nb.lastDay));
    return '<p class="ln-item-sub bnb-facts">' + esc(bits.join(" · ")) + '</p>';
  }

  /* ---------------- drawing the notebook ---------------- */

  function lines(text, cls) {
    const list = N.items(text);
    return list.length ? '<ul class="bnb-list ' + (cls || "") + '">' + list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>' : "";
  }
  function quoteList(text) { return N.items(text).map(function (t) { return '<blockquote class="ln-quote">' + esc(t) + '</blockquote>'; }).join(""); }

  function isOpen(key) { return !!A.state.open[key] || !!ui.q; }

  function sessionHtml(it) {
    const e = it.record, key = sessionKey(e.id), pv = N.preview(e, 120);
    const sub = [];
    if (it.day) sub.push(A.fmtShort(it.day));
    if (e.pages) sub.push("Pages " + e.pages);
    if (e.chapter && pv) sub.push(pv);
    const title = e.chapter || pv || "Reading session";
    let body = "";
    if (e.notes) body += '<p class="ln-h4">Notes</p><p class="ln-text">' + esc(e.notes) + '</p>';
    if (N.items(e.takeaways).length) body += '<p class="ln-h4">Key takeaways</p>' + lines(e.takeaways);
    if (N.items(e.lessons).length) body += '<p class="ln-h4">Actionable lessons</p>' + lines(e.lessons);
    if (N.items(e.quotes).length) body += '<p class="ln-h4">Quotes</p>' + quoteList(e.quotes);
    if (!body) body = '<p class="ln-quiet">Nothing written in this session yet.</p>';
    return '<details class="ln-note bnb-s' + (e.pinned ? " is-pinned" : "") + '" id="' + key + '" data-keep="' + key + '"' + (isOpen(key) ? " open" : "") + '>' +
      '<summary class="ln-note-sum"><span class="ln-badges">' + A.badge("accent", "Session") + (e.pinned ? A.badge("yellow", "Pinned") : "") + '</span>' +
      '<span class="ln-note-title">' + esc(title) + '</span><span class="ln-item-sub">' + esc(sub.join(" · ")) + '</span></summary>' +
      '<div class="ln-note-body">' + body + '<div class="ln-item-btns ln-note-btns">' +
      '<button type="button" class="btn btn-secondary" data-act="bnb-edit" data-id="' + esc(e.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary" data-act="bnb-pin" data-id="' + esc(e.id) + '" aria-pressed="' + !!e.pinned + '">' + (e.pinned ? "Unpin" : "Pin") + '</button>' +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="bnb-delete" data-id="' + esc(e.id) + '">Delete</button></div></div></details>';
  }
  function itemHtml(it) { return it.kind === "session" ? sessionHtml(it) : A.noteCard(it.record); }

  function groupHtml(g) {
    const head = g.kind === "date" ? longDate(g.key) : g.label;
    return '<section class="bnb-group" aria-label="' + esc(head) + '"><h3 class="bnb-gh">' + esc(head) + (g.kind !== "date" ? ' <span class="ln-pill-n">' + g.items.length + '</span>' : "") + '</h3>' +
      '<div class="ln-list">' + g.items.map(itemHtml).join("") + '</div></section>';
  }

  function emptyHtml(book, nb) {
    if (!nb.totalSessions && !nb.totalNotes) {
      return '<div class="bnb-empty"><p class="ln-quiet">Nothing written about this book yet. After you read, add what you learned. Every session is kept here, in order, in this book’s own notebook.</p>' +
        '<button type="button" class="btn btn-primary" data-act="bnb-add" data-id="' + esc(book.id) + '">Add notes</button></div>';
    }
    return '<p class="ln-quiet">Nothing in this book matches “' + esc(ui.q) + '”. <button type="button" class="ln-link-btn" data-act="bnb-clear">Clear search</button></p>';
  }

  function notebookHtml(book, nb) {
    if (!nb.timeline.length) return emptyHtml(book, nb);
    const all = nb.timeline.map(function (it) { return it.kind === "session" ? sessionKey(it.id) : noteKey(it.id); });
    const allOpen = all.every(function (k) { return isOpen(k); });
    let h = '<div class="bnb-tools"><div class="ln-pills" role="group" aria-label="Group notes by">' + [["date", "By date"], ["chapter", "By chapter"]].map(function (x) {
      return '<button type="button" class="ln-pill" data-act="bnb-view" data-v="' + x[0] + '" aria-pressed="' + (ui.view === x[0]) + '">' + x[1] + '</button>';
    }).join("") + '</div><button type="button" class="ln-link-btn" data-act="bnb-expand" data-v="' + (allOpen ? "0" : "1") + '">' + (allOpen ? "Collapse all" : "Expand all") + '</button></div>';
    if (nb.pinned.length) h += '<section class="bnb-group" aria-label="Pinned"><h3 class="bnb-gh">Pinned <span class="ln-pill-n">' + nb.pinned.length + '</span></h3><div class="ln-list">' + nb.pinned.map(itemHtml).join("") + '</div></section>';
    h += nb.groups.map(groupHtml).join("");
    return h + '<button type="button" class="btn btn-secondary bnb-add-end" data-act="bnb-add" data-id="' + esc(book.id) + '">Add notes</button>';
  }

  function metaLine(x) { return [x.day ? A.fmtShort(x.day) : "", x.chapter].filter(Boolean).join(" · "); }
  function viewBtn(x) { return '<button type="button" class="ln-link-btn" data-act="bnb-open" data-from="' + esc(x.from) + '" data-kind="' + x.kind + '">' + (x.kind === "session" ? "Open session" : "Open note") + '</button>'; }

  function lessonsHtml(nb) {
    if (!nb.lessons.length) return '<p class="ln-quiet">' + (ui.q ? "No key takeaways match." : "The key takeaways you write in each session are gathered here, in the order you read.") + '</p>';
    return '<ul class="bnb-lines">' + nb.lessons.map(function (x) { return '<li class="bnb-line"><p class="ln-text">' + esc(x.text) + '</p><p class="ln-item-sub">' + esc(metaLine(x)) + ' ' + viewBtn(x) + '</p></li>'; }).join("") + '</ul>';
  }
  function quotesHtml(nb) {
    if (!nb.quotes.length) return '<p class="ln-quiet">' + (ui.q ? "No quotes match." : "Quotes you add to a session are gathered here.") + '</p>';
    return '<ul class="bnb-lines">' + nb.quotes.map(function (x) { return '<li class="bnb-line"><blockquote class="ln-quote">' + esc(x.text) + '</blockquote><p class="ln-item-sub">' + esc(metaLine(x)) + ' ' + viewBtn(x) + '</p></li>'; }).join("") + '</ul>';
  }
  function actionsHtml(book, nb) {
    let h = "";
    if (nb.ideas.length) {
      h += '<h3 class="bnb-gh">Ideas to apply <span class="ln-pill-n">' + nb.ideas.length + '</span></h3><ul class="bnb-lines">' + nb.ideas.map(function (x, i) {
        return '<li class="bnb-line"><p class="ln-text">' + esc(x.text) + '</p><p class="ln-item-sub">' + esc(metaLine(x)) + ' ' + viewBtn(x) + '</p>' +
          '<button type="button" class="btn btn-secondary" data-act="bnb-track" data-i="' + i + '">Add to my actions</button></li>';
      }).join("") + '</ul>';
    }
    if (nb.actions.length) h += '<h3 class="bnb-gh">In your actions <span class="ln-pill-n">' + nb.actions.length + '</span></h3><div class="ln-list">' + nb.actions.map(function (a) { return A.actionRow(a); }).join("") + '</div>';
    if (!h) h = '<p class="ln-quiet">' + (ui.q ? "No actions match." : "What will you do differently because of this book? Actionable lessons you write in a session show up here.") + '</p>';
    return h + '<button type="button" class="btn btn-secondary bnb-add-end" data-act="add-action" data-id="' + esc(book.id) + '">+ Action</button>';
  }

  function bodyHtml(book, nb) {
    if (ui.tab === "lessons") return lessonsHtml(nb);
    if (ui.tab === "quotes") return quotesHtml(nb);
    if (ui.tab === "actions") return actionsHtml(book, nb);
    return notebookHtml(book, nb);
  }
  function tabsHtml(nb) {
    return '<div class="ln-pills bnb-tabs" role="group" aria-label="Notebook sections">' + TABS.map(function (t) {
      return '<button type="button" class="ln-pill" data-act="bnb-tab" data-v="' + t[0] + '" aria-pressed="' + (ui.tab === t[0]) + '">' + t[1] + ' <span class="ln-pill-n">' + nb.counts[t[0] === "notebook" ? "notebook" : t[0]] + '</span></button>';
    }).join("") + '</div>';
  }

  // The whole notebook part of a book's page.
  function sectionHtml(book) {
    forBook(book.id);
    const nb = model(book);
    return '<section class="ln-sec bnb" id="bnbRoot" data-book="' + esc(book.id) + '" aria-labelledby="bnbH"><div class="ln-sec-head"><h2 class="ln-label" id="bnbH">Notebook</h2></div>' +
      '<div class="ln-toolbar"><label class="visually-hidden" for="bnbQ">Search this book’s notes</label><input type="search" id="bnbQ" class="ln-search" data-bnb-q data-fk="bnb-q" placeholder="Search this book’s notes" value="' + esc(ui.q) + '" autocomplete="off"></div>' +
      '<p class="visually-hidden" id="bnbLive" role="status" aria-live="polite"></p><div id="bnbTabs">' + tabsHtml(nb) + '</div><div id="bnbBody">' + bodyHtml(book, nb) + '</div></section>';
  }

  // Redraws what changes while the search box keeps its place (typing, tabs, grouping).
  function refresh(say) {
    const book = store.get("books", ui.bookId), tabs = $("bnbTabs"), body = $("bnbBody");
    if (!book || !tabs || !body) { A.render(); return; }
    const nb = model(book);
    tabs.innerHTML = tabsHtml(nb);
    body.innerHTML = bodyHtml(book, nb);
    if (say) { const live = $("bnbLive"); if (live) { live.textContent = ""; window.setTimeout(function () { live.textContent = A.plural(nb.counts[ui.tab === "notebook" ? "notebook" : ui.tab], "result"); }, 30); } }
  }

  /* ---------------- the session form (with autosave) ---------------- */

  function chapterNames(bookId) {
    const seen = {}, out = [];
    N.forBook(store.all("entries"), bookId).forEach(function (e) { const k = e.chapter.toLowerCase(); if (e.chapter && !seen[k]) { seen[k] = true; out.push(e.chapter); } });
    return out;
  }

  // bookId always; id for editing a session that is already in the notebook.
  function openEditor(bookId, id) {
    const book = store.get("books", bookId);
    if (!book) { A.notice("That book isn't there any more.", ""); return; }
    const existing = id ? store.get("entries", id) : null;
    if (id && !existing) { A.notice("That session isn't there any more.", ""); return; }
    const today = store.today();
    const e = existing || { day: today, pages: "", chapter: "", notes: "", takeaways: "", lessons: "", quotes: "" };
    const ed = { id: existing ? existing.id : "", timer: 0, last: existing ? existing : null, form: null, el: null, closed: false };
    const names = chapterNames(bookId);

    const body =
      '<div class="bnb-ed-top"><p class="ln-item-sub bnb-ed-book">' + esc(book.title) + '</p><p class="ln-save" id="bnbSaved" role="status" aria-live="polite">Saved automatically as you write.</p></div>' +
      '<div class="bnb-two">' + A.fText("day", "Date", e.day, { type: "date" }) + A.fText("pages", "Pages read (optional)", e.pages, { max: N.LIMIT.pages, placeholder: "e.g. 45–62" }) + '</div>' +
      A.fText("chapter", "Chapter or section (optional)", e.chapter, { max: N.LIMIT.chapter, list: "bnbChapters" }) + A.datalist("bnbChapters", names) +
      A.fArea("notes", "Main notes", e.notes, { rows: 6, max: N.LIMIT.notes, placeholder: "What did you read? What stood out?" }) +
      A.fArea("takeaways", "Key takeaways", e.takeaways, { rows: 3, max: N.LIMIT.takeaways, hint: "One per line." }) +
      A.fArea("lessons", "Actionable lessons", e.lessons, { rows: 3, max: N.LIMIT.lessons, hint: "What will you do with this? One per line." }) +
      '<details class="ln-more"' + (e.quotes ? " open" : "") + '><summary>Quotes (optional)</summary>' + A.fArea("quotes", "Quotes", e.quotes, { rows: 3, max: N.LIMIT.quotes, hint: "One per line." }) + '</details>';

    function setStatus(text, bad) {
      const s = ed.el ? ed.el.querySelector("#bnbSaved") : null;
      if (s) { s.textContent = text; s.classList.toggle("is-bad", !!bad); }
    }
    // Saves what is in the form now. quiet: don't complain about a date that is not valid yet (the person is still typing).
    function save(quiet) {
      window.clearTimeout(ed.timer); ed.timer = 0;
      if (!ed.form) return { ok: true, saved: false };
      const v = A.formValues(ed.form);
      const r = N.check(Object.assign({ bookId: bookId }, v), { today: store.today(), books: store.list("books") });
      if (!r.ok) { if (!quiet) return { ok: false, errors: r.errors }; setStatus("Not saved yet: " + (r.errors.day || r.errors.bookId), true); return { ok: false, errors: r.errors }; }
      if (N.isEmpty(r.value)) { setStatus(ed.id ? "Nothing to keep here. Closing will remove this session." : "Saved automatically as you write.", false); return { ok: true, saved: false, empty: true }; }
      if (ed.last && N.same(ed.last, r.value)) return { ok: true, saved: false };
      let rec;
      if (ed.id) {
        const cur = store.get("entries", ed.id);
        rec = cur ? store.put("entries", Object.assign({}, cur, r.value)) : null;
      } else rec = store.add("entries", r.value);
      if (!rec) { setStatus(store.error() || "That couldn't be saved.", true); return { ok: false, message: store.error() || "That couldn't be saved." }; }
      ed.id = rec.id; ed.last = rec;
      setStatus("Saved.", false);
      return { ok: true, saved: true };
    }
    function schedule() { window.clearTimeout(ed.timer); ed.timer = window.setTimeout(function () { save(true); }, SAVE_AFTER_MS); }
    function flushOnLeave() { if (!ed.closed && document.hidden !== false) save(true); }
    function onHide() { if (!ed.closed) save(true); }

    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", flushOnLeave);

    A.openSheet({
      title: existing ? "Edit session" : "Add notes", body: body, submit: "Done", noCancel: true, focus: '[name="notes"]',
      onOpen: function (el) { ed.el = el; ed.form = el.querySelector("form"); },
      onInput: function () { schedule(); },
      onChange: function () { schedule(); },
      onSubmit: function () { const r = save(false); return r.ok ? { ok: true } : { ok: false, errors: r.errors || {}, message: r.message }; },
      onClose: function (done) {
        ed.closed = true;
        window.removeEventListener("pagehide", onHide);
        document.removeEventListener("visibilitychange", flushOnLeave);
        const r = save(true);
        if (r.empty && ed.id) {
          // Everything was cleared from a saved session: it goes (with Undo) rather than being kept as an empty page.
          const gone = ed.id;
          if (store.remove("entries", gone)) A.notice("Removed the empty session.", "Undo", function () { store.undoRemove("entries", gone); });
        } else if (ed.id) {
          A.state.open[sessionKey(ed.id)] = true;
          if (done || r.saved) A.say(existing ? "Session saved." : "Added to this book’s notebook.");
          // Started from somewhere else (Overview, the + Add menu): say where it went, with a way to open it.
          if (!(A.state.tab === "books" && A.state.id === bookId) && (done || r.saved)) A.notice("Saved in “" + book.title + "”.", "Open", function () { A.go("books", bookId); });
          const showId = ed.id;
          window.setTimeout(function () { const n = document.getElementById(sessionKey(showId)); if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest", behavior: "auto" }); }, 60);
        }
      }
    });
  }

  /* ---------------- taps ---------------- */

  function togglePin(id) {
    const e = store.get("entries", id);
    if (!e) return;
    if (!store.patch("entries", id, { pinned: e.pinned ? undefined : true })) { A.saveFailed(); return; }
    A.say(e.pinned ? "Unpinned." : "Pinned to the top.");
  }
  function deleteSession(id) {
    const e = store.get("entries", id);
    if (!e) return;
    A.confirmSheet({
      title: "Delete this session?",
      text: "The notes from " + A.fmtDate(e.day) + (e.chapter ? " (" + e.chapter + ")" : "") + " will be removed from this book’s notebook. You can undo for a few seconds afterwards.",
      yes: "Delete session",
      onYes: function () {
        if (!store.remove("entries", id)) { A.saveFailed(); return; }
        A.notice("Session deleted.", "Undo", function () { store.undoRemove("entries", id); });
      }
    });
  }
  function openFrom(kind, id) {
    ui.tab = "notebook"; ui.q = "";
    A.state.open[kind === "session" ? sessionKey(id) : noteKey(id)] = true;
    A.render();
    window.setTimeout(function () {
      const n = document.getElementById(kind === "session" ? sessionKey(id) : "lnnote_" + id);
      if (n) { if (n.scrollIntoView) n.scrollIntoView({ block: "center" }); const s = n.querySelector("summary"); if (s) s.focus({ preventScroll: true }); }
    }, 0);
  }
  function expandAll(on) {
    const book = store.get("books", ui.bookId);
    if (!book) return;
    model(book).timeline.forEach(function (it) {
      const k = it.kind === "session" ? sessionKey(it.id) : noteKey(it.id);
      if (on) A.state.open[k] = true; else delete A.state.open[k];
    });
    const q = ui.q; ui.q = "";                  // while a search is on everything is shown open; collapsing applies once it is cleared
    ui.q = q;
    refresh(false);
  }

  A.acts["bnb-add"] = function (el) { openEditor(el.getAttribute("data-id") || ui.bookId); };
  A.acts["bnb-edit"] = function (el) { openEditor(ui.bookId, el.getAttribute("data-id")); };
  A.acts["bnb-pin"] = function (el) { togglePin(el.getAttribute("data-id")); };
  A.acts["bnb-delete"] = function (el) { deleteSession(el.getAttribute("data-id")); };
  A.acts["bnb-tab"] = function (el) { ui.tab = el.getAttribute("data-v"); refresh(false); };
  A.acts["bnb-view"] = function (el) { ui.view = el.getAttribute("data-v") === "chapter" ? "chapter" : "date"; refresh(false); };
  A.acts["bnb-expand"] = function (el) { expandAll(el.getAttribute("data-v") === "1"); };
  A.acts["bnb-clear"] = function () { ui.q = ""; const q = $("bnbQ"); if (q) { q.value = ""; q.focus(); } refresh(true); };
  A.acts["bnb-open"] = function (el) { openFrom(el.getAttribute("data-kind"), el.getAttribute("data-from")); };
  A.acts["bnb-track"] = function (el) {
    const book = store.get("books", ui.bookId);
    if (!book) return;
    const idea = model(book).ideas[Number(el.getAttribute("data-i"))];
    if (idea) A.editAction(null, { sourceType: "book", sourceId: book.id, label: book.title, lesson: A.snippet(idea.text, 480) });
  };

  // Typing in the search box (the Books screen passes input events here).
  function input(t) {
    if (!t || !t.hasAttribute || !t.hasAttribute("data-bnb-q")) return false;
    ui.q = t.value;
    refresh(true);
    return true;
  }

  // Deleting a book takes its notebook with it (the Undo for the book brings it back): returns the ids removed.
  function removeFor(bookId) {
    const gone = [];
    N.forBook(store.all("entries"), bookId).forEach(function (e) { if (store.remove("entries", e.id)) gone.push(e.id); });
    return gone;
  }
  function restoreFor(ids) { (ids || []).forEach(function (id) { store.undoRemove("entries", id); }); }
  function countFor(bookId) { return N.forBook(store.all("entries"), bookId).length; }

  A.notebook = { sectionHtml: sectionHtml, factsHtml: factsHtml, openEditor: openEditor, input: input, removeFor: removeFor, restoreFor: restoreFor, countFor: countFor };
})();
