/* ==========================================================================
   JARVIS — Learning & Research Hub: the Overview, and the one-step "Log reading" form.

   The Overview answers three questions and nothing else: what am I reading and where am I, what is due for review today,
   and what have I done lately. Three numbers sit on top (books being read, pages read today, notes saved).
   Every figure and line comes from your records (see learning-overview-logic.js); nothing is typed in or estimated.

   Log reading saves a page and/or minutes in one go, through the same paths the old page box and timer form used:
   the page goes into the book's page log (so each page is counted once) and the minutes into a reading-time record.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning, O = window.JarvisLearningOverview, R = window.JarvisLearningReading;
  if (!A || !O || !R) return;
  const L = A.L, store = A.store, esc = A.esc;

  /* ---------------- Log reading ---------------- */

  // Books you can log reading for: the ones you are reading, then paused, then the to-read list.
  function logBooks() {
    const rank = { reading: 0, paused: 1, want: 2 };
    return L.live(store.list("books")).filter(function (b) { return rank[b.status] !== undefined; })
      .sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((b.updatedAt || 0) - (a.updatedAt || 0)); });
  }
  function pageHint(b) { return "Now on page " + b.currentPage + (b.totalPages > 0 ? " of " + b.totalPages : "") + "."; }

  function openLogReading(bookId) {
    const books = logBooks();
    if (!books.length) {
      A.notice("Add a book first, then you can log your reading.", "Add a book", function () { A.quickAdd.book(); });
      return;
    }
    const target = (bookId && books.filter(function (b) { return b.id === bookId; })[0]) || O.logTarget(store.state()) || books[0];
    const body =
      A.fSelect("bookId", "Book", books.map(function (b) { return [b.id, b.title]; }), target.id, {}) +
      A.fText("page", "Page you’re on now", String(target.currentPage), { type: "number", mode: "numeric", min: 0, hint: pageHint(target) }) +
      '<div class="ln-chips ln-plus" role="group" aria-label="Add pages">' + [5, 10, 25].map(function (n) {
        return '<button type="button" class="ln-chip" data-sheet-act="plus" data-n="' + n + '" aria-label="Add ' + n + ' pages">+' + n + '</button>';
      }).join("") + '</div>' +
      A.fText("minutes", "Minutes read (optional)", "", { type: "number", mode: "numeric", min: 1 }) +
      '<p class="ln-item-sub"><button type="button" class="ln-link-btn" data-sheet-act="timer">Use the timer instead</button></p>';
    A.openSheet({
      title: "Log reading", body: body, submit: "Save", focus: "#lnf_page",
      onChange: function (t, el) {
        if (t.id !== "lnf_bookId") return;
        const b = store.get("books", t.value);
        if (!b) return;
        el.querySelector("#lnf_page").value = String(b.currentPage);
        el.querySelector("#lnh_page").textContent = pageHint(b);
      },
      onAct: function (act, btn, el) {
        const b = store.get("books", el.querySelector("#lnf_bookId").value);
        if (act === "plus" && b) {
          const input = el.querySelector("#lnf_page");
          let n = (String(input.value).trim() === "" ? b.currentPage : Number(input.value) || 0) + Number(btn.getAttribute("data-n"));
          if (b.totalPages > 0 && n > b.totalPages) n = b.totalPages;
          input.value = String(n);
        } else if (act === "timer" && b) {
          A.closeSheet();
          window.setTimeout(function () { if (A.startTimer) A.startTimer(b.id); }, 0);
        }
      },
      onSubmit: function (v) {
        const b = store.get("books", v.bookId), today = store.today();
        if (!b) return { ok: false, errors: { bookId: "Choose a book." } };
        let pageN = null, sessionValue = null;
        const rawPage = String(v.page == null ? "" : v.page).trim();
        if (rawPage !== "") {
          const c = A.checkPage(b, rawPage);
          if (c.error) return { ok: false, errors: { page: c.error } };
          if (c.n !== b.currentPage) pageN = c.n;
        }
        const rawMin = String(v.minutes == null ? "" : v.minutes).trim();
        if (rawMin !== "") {
          const r = R.check({ minutes: rawMin, day: today, bookId: b.id, note: "" }, { today: today, books: L.live(store.list("books")) });
          if (!r.ok) return { ok: false, errors: { minutes: r.errors.minutes || "Enter the minutes as a number." } };
          sessionValue = r.value;
        }
        if (pageN === null && !sessionValue) return { ok: false, errors: { page: "Enter the page you reached or the minutes you read." } };

        let after = b;
        if (pageN !== null) {
          const res = A.applyPage(b, pageN);
          if (!res.ok) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
          after = res.book;
        }
        let session = null;
        if (sessionValue) {
          session = store.add("sessions", sessionValue);
          if (!session) {
            if (pageN !== null) store.put("books", b);                      // keep the two saves together: if the minutes failed, the page goes back
            A.saveFailed();
            return { ok: false, errors: {}, message: store.error() };
          }
        }
        const gained = pageN !== null ? pageN - b.currentPage : 0;
        const parts = [];
        if (pageN !== null) parts.push(gained > 0 ? "+" + A.plural(gained, "page") + " to page " + pageN : "now on page " + pageN);
        if (session) parts.push(R.minutesText(session.minutes));
        const msg = b.title + ": " + parts.join(" · ") + ".";
        const last = pageN !== null && after.totalPages > 0 && pageN >= after.totalPages && after.status === "reading";
        if (last) A.notice(msg + " That’s the last page.", "Mark completed", function () { A.setBookStatus(after.id, "completed"); });
        else A.notice(msg, "Undo", function () {
          if (pageN !== null) store.put("books", b);
          if (session) store.remove("sessions", session.id);
        });
        A.say("Logged. " + msg);
        return { ok: true };
      }
    });
  }
  A.openLogReading = openLogReading;
  A.acts["log-reading"] = function (el) { openLogReading(el && el.getAttribute ? el.getAttribute("data-id") || "" : ""); };

  /* ---------------- the Overview ---------------- */

  function fig(n, label, attrs) {
    return '<button type="button" class="ln-fig" ' + attrs + ' data-stat="' + esc(label) + '"><span class="ln-fig-n">' + n + '</span><span class="ln-fig-l">' + esc(label) + '</span></button>';
  }
  // A line that opens something: { go: { tab, id } } from the activity list, or a note/flashcard that is due.
  function goAttrs(go) {
    if (go.tab === "knowledge" && go.id) return 'data-go="knowledge" data-open-note="' + esc(go.id) + '"';
    return 'data-go="' + esc(go.tab) + '"' + (go.id ? ' data-id="' + esc(go.id) + '"' : "");
  }
  function row(text, sub, attrs) {
    return '<li><button type="button" class="ln-row-btn" ' + attrs + '><span class="ln-row-t">' + esc(text) + '</span>' + (sub ? '<span class="ln-row-s">' + esc(sub) + '</span>' : "") + '</button></li>';
  }

  function readingSection(S) {
    const cur = L.currentBooks(S), target = O.logTarget(S), timer = A.timerHtml ? A.timerHtml() : "";
    if (!target && !timer) return "";
    let h = '<section class="ln-sec ln-now" aria-labelledby="lnNowH"><h2 class="ln-label" id="lnNowH">Currently reading</h2>';
    if (cur.length) {
      const b = cur[0], p = L.progress(b);
      h += '<button type="button" class="ln-now-book" data-go="books" data-id="' + esc(b.id) + '" aria-label="Open ' + esc(b.title) + '">' + A.coverHtml(b, "ln-cover-sm") +
        '<span class="ln-now-main"><span class="ln-item-title">' + esc(b.title) + '</span><span class="ln-item-sub">' + esc(b.author || "No author") + '</span></span></button>' +
        A.barHtml(p, b.title + ": " + p + "% read") + '<p class="ln-item-sub ln-now-pages">' + esc(A.progressText(b) || "No page logged yet") + '</p>';
    } else if (target) {
      h += '<p class="ln-quiet">No book in progress.</p>';
    }
    if (timer) h += '<div class="ln-now-timer">' + timer + '</div>';
    if (target) h += '<div class="ln-now-btns"><button type="button" class="btn btn-primary" data-act="log-reading" data-id="' + esc((cur[0] || target).id) + '">Log reading</button>' +
      (A.notebook ? '<button type="button" class="btn btn-secondary" data-act="bnb-add" data-id="' + esc((cur[0] || target).id) + '">Add notes</button>' : "") +
      (cur.length > 1 ? '<button type="button" class="ln-link-btn" data-go="books" data-filters=\'{"status":"reading"}\'>' + (cur.length - 1) + ' more in progress</button>' : "") + '</div>';
    return h + '</section>';
  }

  function reviewSection(S, today) {
    const rv = O.review(S, today, 3);
    if (!rv.scheduled) return "";
    let h = '<section class="ln-sec" aria-labelledby="lnRevH"><div class="ln-sec-head"><h2 class="ln-label" id="lnRevH">Today’s review</h2>' + (rv.due ? '<span class="ln-count-pill">' + rv.due + ' due</span>' : "") + '</div>';
    if (!rv.due) return h + '<p class="ln-quiet">Nothing due today' + (rv.nextDue ? ". Next review " + esc(A.fmtShort(rv.nextDue)) + "." : ".") + '</p></section>';
    h += '<ul class="ln-rows">' + rv.items.map(function (x) {
      return row(x.title, x.card ? "Flashcard" : "Note", x.card ? 'data-go="study"' : 'data-go="knowledge" data-open-note="' + esc(x.id) + '"');
    }).join("") + '</ul>';
    if (rv.due > rv.items.length) h += '<p class="ln-quiet">and ' + (rv.due - rv.items.length) + ' more</p>';
    return h + '<button type="button" class="btn btn-primary" data-act="study-start-due">Start review</button></section>';
  }

  function activitySection(S, today) {
    const list = O.activity(S, today, 6);
    if (!list.length) return "";
    return '<section class="ln-sec" aria-labelledby="lnActH"><h2 class="ln-label" id="lnActH">Recent activity</h2><ul class="ln-rows">' + list.map(function (x) {
      return row(x.text, O.whenWords(x.day, today) || A.fmtShort(x.day), goAttrs(x.go));
    }).join("") + '</ul></section>';
  }

  A.register("overview", {
    html: function () {
      const S = store.state(), today = store.today(), F = O.figures(S, today);
      const nothing = !L.live(S.books).length && !L.live(S.research).length && !L.live(S.notes).length;
      let h = '<h2 class="visually-hidden" data-focus-top>Overview</h2><div class="ln-figs">' +
        fig(F.activeBooks, "Active books", 'data-go="books" data-filters=\'{"status":"reading"}\'') +
        fig(F.pagesToday, "Pages today", 'data-act="reading-open"') +
        fig(F.notesSaved, "Notes saved", 'data-go="knowledge"') + '</div>';
      if (nothing) return h + '<p class="ln-empty">Nothing here yet. Tap <strong>+ Add</strong> to save a book, a research topic or a note.</p>';
      return h + readingSection(S) + reviewSection(S, today) + activitySection(S, today);
    }
  });
})();
