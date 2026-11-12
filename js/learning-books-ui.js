/* ==========================================================================
   JARVIS — Learning & Research Hub: Books (the list, a book's own page, and the add/edit form).
   Registered with learning-ui.js, which draws it into the Learning panel. The rules live in learning-logic.js.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;

  /* ---------------- cover pictures ---------------- */

  // A chosen picture -> a small JPEG as text (about 300 px tall), so it fits in browser storage and in the backup.
  function resizeCover(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("Choose a picture file (a photo or an image).")); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (!img.width || !img.height) { reject(new Error("That picture couldn't be read.")); return; }
        const scale = Math.min(1, 300 / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const cx = canvas.getContext("2d");
        if (!cx) { reject(new Error("This browser can't resize pictures.")); return; }
        cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        const qualities = [0.82, 0.68, 0.52, 0.4];
        for (let i = 0; i < qualities.length; i++) {
          let data = "";
          try { data = canvas.toDataURL("image/jpeg", qualities[i]); } catch (e) { data = ""; }
          if (L.coverOk(data)) { resolve(data); return; }
        }
        reject(new Error("That picture is too detailed to keep. Choose a smaller one."));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as a picture.")); };
      img.src = url;
    });
  }

  /* ---------------- the add / edit form ---------------- */

  function ratingRow(value) {
    let h = '<fieldset class="ln-rate-set ln-when-completed"><legend>Rating</legend><div class="ln-rate">';
    for (let n = 0; n <= 5; n++) {
      h += '<input type="radio" name="rating" id="lnr_' + n + '" value="' + n + '"' + (Number(value || 0) === n ? " checked" : "") + ' class="visually-hidden">' +
        '<label for="lnr_' + n + '" class="ln-rate-l">' + (n === 0 ? "None" : n + '<span aria-hidden="true"> ★</span><span class="visually-hidden"> star' + (n > 1 ? "s" : "") + '</span>') + '</label>';
    }
    return h + '</div><p class="ln-err hidden" data-err="rating" role="alert"></p></fieldset>';
  }

  function openBookForm(book, then) {
    const S = store.state(), isNew = !book;
    const b = book || { title: "", author: "", category: "", totalPages: 0, currentPage: 0, status: "reading", startDate: "", endDate: "", rating: 0, cover: "" };
    const cats = L.allCategories(S);
    const moreOpen = !!(b.startDate || b.endDate || b.cover);
    let cover = b.cover || "";
    const body =
      A.fText("title", "Title", b.title, { required: true, max: 200 }) +
      A.fText("author", "Author", b.author, { max: 120 }) +
      A.fText("category", "Category", b.category, { max: 60, list: "lnCats", placeholder: "Business, Faith, Health…" }) + A.datalist("lnCats", cats) +
      '<div class="ln-two">' + A.fText("totalPages", "Total pages", b.totalPages || "", { type: "number", mode: "numeric", min: 1 }) +
      A.fText("currentPage", "Current page", b.currentPage || "", { type: "number", mode: "numeric", min: 0 }) + '</div>' +
      A.fSelect("status", "Status", A.opts(L.BOOK_STATUS), b.status, { required: true }) +
      ratingRow(b.rating) +
      '<details class="ln-more"' + (moreOpen ? " open" : "") + '><summary>Dates and cover picture</summary>' +
      '<div class="ln-two">' + A.fText("startDate", "Started", b.startDate, { type: "date" }) + '<div class="ln-when-completed">' + A.fText("endDate", "Finished", b.endDate, { type: "date" }) + '</div></div>' +
      '<div class="form-row"><label for="lnCoverFile">Cover picture</label><div class="ln-cover-pick">' +
      '<div id="lnCoverPrev">' + (cover ? '<img class="ln-cover ln-cover-sm" src="' + cover + '" alt="Current cover" width="60" height="90">' : '<span class="ln-item-sub">No picture</span>') + '</div>' +
      '<input type="file" id="lnCoverFile" accept="image/*"><button type="button" class="btn btn-secondary" data-sheet-act="cover-clear"' + (cover ? "" : " hidden") + ' id="lnCoverClear">Remove picture</button></div>' +
      '<input type="hidden" name="cover" id="lnf_cover" value="' + esc(cover) + '"><p class="field-hint">The picture is shrunk to a small size and kept on this device and in your backup.</p>' +
      '<p class="ln-err hidden" data-err="cover" role="alert"></p></div></details>';

    function syncWhen(el) {
      const st = el.querySelector("#lnf_status").value;
      Array.prototype.forEach.call(el.querySelectorAll(".ln-when-completed"), function (n) { n.hidden = st !== "completed"; });
    }
    A.openSheet({
      title: isNew ? "Add a book" : "Edit book", body: body, submit: isNew ? "Add book" : "Save changes",
      onOpen: function (el) { syncWhen(el); },
      onChange: function (target, el) {
        if (target.id === "lnf_status") syncWhen(el);
        if (target.id === "lnCoverFile" && target.files && target.files[0]) {
          const err = el.querySelector('[data-err="cover"]');
          err.classList.add("hidden");
          resizeCover(target.files[0]).then(function (data) {
            cover = data;
            el.querySelector("#lnf_cover").value = data;
            el.querySelector("#lnCoverPrev").innerHTML = '<img class="ln-cover ln-cover-sm" src="' + data + '" alt="New cover">';
            el.querySelector("#lnCoverClear").hidden = false;
          }).catch(function (e) { err.textContent = e.message; err.classList.remove("hidden"); });
          target.value = "";
        }
      },
      onAct: function (act, btn, el) {
        if (act === "cover-clear") {
          cover = ""; el.querySelector("#lnf_cover").value = "";
          el.querySelector("#lnCoverPrev").innerHTML = '<span class="ln-item-sub">No picture</span>';
          btn.hidden = true;
        }
      },
      onSubmit: function (v) {
        const today = store.today(), now = Date.now();
        const r = L.checkBook(v, { today: today });
        if (!r.ok) return { ok: false, errors: r.errors };
        const val = r.value;
        let saved = null;
        if (isNew) {
          saved = store.add("books", Object.assign({}, val, { log: val.currentPage > 0 ? [{ d: today, p: val.currentPage }] : [] }));
        } else {
          let next = Object.assign({}, book, val);
          if (val.currentPage !== book.currentPage) next = L.withPage(next, val.currentPage, today, now);
          saved = store.put("books", next);
        }
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say((isNew ? "Added " : "Saved ") + saved.title + ".");
        if (isNew) A.notice("Added “" + saved.title + "”.", "Open", function () { A.go("books", saved.id); });
        if (then) then(saved);
        return { ok: true };
      }
    });
  }

  /* ---------------- delete ---------------- */

  function deleteBook(id) {
    const b = store.get("books", id);
    if (!b) return;
    const linked = L.notesFor(store.list("notes"), "book", id).length;
    A.confirmSheet({
      title: "Delete this book?",
      text: "“" + b.title + "” will be removed." + (linked ? " Its " + A.plural(linked, "note") + " stay in your Knowledge library, no longer linked to the book." : "") + " You can undo for a few seconds afterwards.",
      yes: "Delete book",
      onYes: function () {
        if (!store.remove("books", id)) { A.saveFailed(); return; }
        const changes = store.unlinkFrom("book", id, b.title);
        if (A.state.tab === "books" && A.state.id === id) A.go("books", "", { noScroll: true });
        A.notice("Deleted “" + b.title + "”.", "Undo", function () { store.undoRemove("books", id); store.relink(changes); });
      }
    });
  }

  function setRating(id, n) {
    const b = store.get("books", id);
    if (!b) return;
    const next = b.rating === n ? 0 : n;      // tapping the same star again clears it
    if (!store.patch("books", id, { rating: next })) { A.saveFailed(); return; }
    A.say(next ? "Rated " + next + " out of 5." : "Rating cleared.");
  }

  /* ---------------- the list ---------------- */

  function bookCard(b) {
    const p = L.progress(b);
    return '<article class="ln-book">' +
      '<button type="button" class="ln-book-open" data-go="books" data-id="' + esc(b.id) + '" aria-label="Open ' + esc(b.title) + '">' + A.coverHtml(b) +
      '<span class="ln-item-main"><span class="ln-item-title">' + esc(b.title) + '</span><span class="ln-item-sub">' + esc(b.author || "No author") + '</span>' +
      '<span class="ln-badges">' + A.statusBadge(b.status, L.labelOf(L.BOOK_STATUS, b.status)) + (b.category ? A.badge("neutral", b.category) : "") + '</span>' +
      A.barHtml(p, b.title + ": " + p + "% read") + (A.progressText(b) ? '<span class="ln-item-sub">' + esc(A.progressText(b)) + '</span>' : "") +
      (b.status === "completed" && b.rating ? A.starsHtml(b.rating) : "") + '</span></button>' +
      (b.status === "reading" ? A.pageForm(b) : "") + '</article>';
  }

  function listResults() {
    const S = store.state(), f = A.state.filters.books;
    const list = L.filterBooks(S.books, f);
    if (!list.length) {
      return L.live(S.books).length
        ? '<p class="empty-state">No books match. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>'
        : '<div class="empty-state"><p>No books yet.</p><p class="field-hint">Add the book you’re reading and update the page as you go. Progress, dates and notes are kept for you.</p><button type="button" class="btn btn-primary" data-act="add-book">Add your first book</button></div>';
    }
    return '<div class="ln-grid">' + list.map(bookCard).join("") + '</div>';
  }
  function listCount() {
    const n = L.filterBooks(store.state().books, A.state.filters.books).length, total = L.live(store.state().books).length;
    return n === total ? A.plural(total, "book") : n + " of " + total + " books";
  }
  function list() {
    const S = store.state(), cats = L.allCategories({ books: S.books });
    const f = A.state.filters.books;
    return '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Books</h2><button type="button" class="btn btn-primary" data-act="add-book">+ Add book</button></div>' +
      A.toolbar("books", [
        { name: "q", kind: "search", label: "Search books", placeholder: "Search title, author, category" },
        { name: "status", kind: "select", label: "Filter by status", options: [["", "All statuses"]].concat(L.BOOK_STATUS.map(function (x) { return [x.key, x.label]; })) },
        { name: "category", kind: "select", label: "Filter by category", options: [["", "All categories"]].concat(cats.map(function (c) { return [c, c]; })) },
        { name: "sort", kind: "select", label: "Sort books", options: [["recent", "Recently updated"], ["added", "Recently added"], ["title", "Title A–Z"], ["progress", "Most progress"], ["rating", "Top rated"]] }
      ]) + '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(listCount()) + '</p><div id="lnResults">' + listResults() + '</div>';
  }

  /* ---------------- a book's own page ---------------- */

  function detail(id) {
    const b = store.get("books", id);
    if (!b) return '<div class="ln-head"><button type="button" class="btn-icon" data-go="books">← All books</button></div><p class="empty-state" data-focus-top>This book no longer exists.</p>';
    const S = store.state(), p = L.progress(b), left = L.pagesLeft(b);
    const statusBtns = L.BOOK_STATUS.map(function (s) {
      return '<button type="button" class="ln-seg-btn" data-act="status-book" data-id="' + esc(b.id) + '" data-v="' + s.key + '" aria-pressed="' + (b.status === s.key) + '">' + esc(s.label) + '</button>';
    }).join("");
    const facts = [];
    if (b.startDate) facts.push("Started " + A.fmtDate(b.startDate));
    if (b.endDate) facts.push("Finished " + A.fmtDate(b.endDate));
    if (left !== null && b.status !== "completed") facts.push(A.plural(left, "page") + " left");

    let h = '<div class="ln-head"><button type="button" class="btn-icon" data-go="books">← All books</button>' +
      '<div class="ln-head-btns"><button type="button" class="btn btn-secondary" data-act="edit-book" data-id="' + esc(b.id) + '">Edit</button><button type="button" class="btn btn-secondary ln-danger" data-act="delete-book" data-id="' + esc(b.id) + '">Delete</button></div></div>' +
      '<section class="card ln-card ln-book-head"><div class="ln-book-top">' + A.coverHtml(b, "ln-cover-lg") + '<div class="ln-item-main"><h2 class="ln-h2" data-focus-top>' + esc(b.title) + '</h2>' +
      '<p class="ln-item-sub">' + esc(b.author || "No author") + '</p><div class="ln-badges">' + (b.category ? A.badge("neutral", b.category) : "") + A.statusBadge(b.status, L.labelOf(L.BOOK_STATUS, b.status)) + '</div></div></div>' +
      '<div class="ln-seg" role="group" aria-label="Reading status">' + statusBtns + '</div>' +
      (p !== null ? A.barHtml(p, "Progress: " + p + "% read") : "") +
      '<p class="ln-big">' + (A.progressText(b) ? esc(A.progressText(b)) : "No page logged yet") + (p === null ? ' <span class="ln-item-sub">Add the total pages (Edit) to see a progress bar.</span>' : "") + '</p>' +
      (facts.length ? '<p class="ln-item-sub">' + esc(facts.join(" · ")) + '</p>' : "") +
      (b.status !== "completed" ? A.pageForm(b, "ln-page-lg") : "") +
      (b.status === "completed" ? '<div class="ln-rate-quick" role="group" aria-label="Your rating">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" class="ln-star-btn' + (b.rating >= n ? " on" : "") + '" data-act="rate" data-id="' + esc(b.id) + '" data-v="' + n + '" aria-pressed="' + (b.rating === n) + '" aria-label="' + n + ' star' + (n > 1 ? "s" : "") + '">★</button>';
      }).join("") + '<span class="ln-item-sub">' + (b.rating ? b.rating + " out of 5" : "Tap a star to rate it") + '</span></div>' : "") +
      '</section>';

    // Notes: takeaways, chapter summaries, quotes, reflections (and anything else linked), grouped by kind.
    const notes = L.filterNotes(S.notes, S, { bookId: b.id, sort: "newest" });
    h += '<section class="card ln-card" aria-labelledby="lnBkNotes"><div class="card-title-row"><h2 class="card-title" id="lnBkNotes">Notes (' + notes.length + ')</h2></div>' +
      '<div class="ln-quick" role="group" aria-label="Add a note to this book">' +
      [["takeaway", "+ Takeaway"], ["chapter", "+ Chapter summary"], ["quote", "+ Quote"], ["reflection", "+ Reflection"]].map(function (x) {
        return '<button type="button" class="btn btn-secondary" data-act="add-note" data-type="' + x[0] + '" data-id="' + esc(b.id) + '">' + x[1] + '</button>';
      }).join("") + '</div>';
    if (!notes.length) h += '<p class="empty-state-compact">No notes for this book yet. Add a takeaway, a chapter summary, a quote you want to keep, or your own reflection.</p>';
    else L.NOTE_TYPE.forEach(function (t) {
      const group = notes.filter(function (n) { return n.type === t.key; });
      if (!group.length) return;
      h += '<h3 class="ln-h3">' + esc(t.label) + (group.length > 1 || t.key === "takeaway" ? "s" : "") + ' <span class="ln-item-sub">' + group.length + '</span></h3><div class="ln-list">' + group.map(function (n) { return A.noteCard(n); }).join("") + '</div>';
    });
    h += '</section>';

    // Action steps for this book.
    const acts = L.actionsFor(S.actions, "book", b.id);
    h += '<section class="card ln-card" aria-labelledby="lnBkActs"><div class="card-title-row"><h2 class="card-title" id="lnBkActs">Action steps (' + acts.length + ')</h2><button type="button" class="btn btn-secondary" data-act="add-action" data-id="' + esc(b.id) + '">+ Add action</button></div>' +
      (acts.length ? '<div class="ln-list">' + acts.map(function (a) { return A.actionRow(a); }).join("") + '</div>' : '<p class="empty-state-compact">What will you do differently because of this book? Add the first step.</p>') + '</section>';

    // The page updates that progress and the weekly pages-read figure are counted from.
    const log = (b.log || []).slice(-8).reverse();
    h += '<section class="card ln-card" aria-labelledby="lnBkLog"><div class="card-title-row"><h2 class="card-title" id="lnBkLog">Reading log</h2></div>' +
      (log.length ? '<ul class="ln-log">' + log.map(function (e) { return '<li><span>' + esc(A.fmtDate(e.d)) + '</span><span>page ' + e.p + '</span></li>'; }).join("") + '</ul><p class="field-hint">Pages read each week are counted from these page updates only. Pages before your first update aren’t counted.</p>'
        : '<p class="empty-state-compact">No page updates yet. Update the page above and each update is recorded here.</p>') + '</section>';
    return h;
  }

  /* ---------------- the section ---------------- */

  A.register("books", {
    html: function () { return A.state.id ? detail(A.state.id) : list(); },
    results: listResults,
    count: listCount,
    click: function (act, el) {
      const id = el.getAttribute("data-id");
      if (act === "add-book") openBookForm(null);
      else if (act === "edit-book") { const b = store.get("books", id); if (b) openBookForm(b); }
      else if (act === "delete-book") deleteBook(id);
      else if (act === "rate") setRating(id, Number(el.getAttribute("data-v")));
      else if (act === "add-note") A.editNote(null, { type: el.getAttribute("data-type"), bookIds: [id] });
      else if (act === "add-action") { const b = store.get("books", id); A.editAction(null, { sourceType: "book", sourceId: id, label: b ? b.title : "" }); }
    }
  });
  A.quickAdd.book = function () { openBookForm(null); };
  A.openBookForm = openBookForm;
  A.resizeCover = resizeCover;
})();
