/* ==========================================================================
   JARVIS — Learning & Research Hub: reading stats and the optional reading timer.
   Shown as "Reading stats" inside Books, as a card on the Dashboard and as a line on each book's page.
   Pages come only from the book page log (each page counted once); minutes come only from saved reading-time sessions.
   The rules live in learning-reading-logic.js.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning, R = window.JarvisLearningReading, core = window.JarvisCore;
  if (!A || !R || !core) return;
  const L = A.L, store = A.store, esc = A.esc, plural = A.plural;

  const rd = A.state.rd = { range: "days", metric: "pages", month: "", timerBook: "" };
  const RANGES = [["days", "14 days"], ["weeks", "12 weeks"], ["months", "12 months"]];
  const RANGE_WORDS = { days: "the last 14 days", weeks: "the last 12 weeks", months: "the last 12 months" };

  /* ---------------- the timer (kept on this device only) ---------------- */

  let timer = R.timerRead(core.loadJSON(R.TIMER_KEY, null));
  let tick = 0;
  function saveTimer() {
    if (timer) { if (!core.saveJSON(R.TIMER_KEY, timer)) A.notice("The timer couldn't be saved on this device. Keep this screen open until you finish.", ""); return; }
    try { localStorage.removeItem(R.TIMER_KEY); } catch (e) { /* nothing to remove */ }
  }
  function elapsed() { return R.timerElapsed(timer, Date.now()); }
  function paintClocks() {
    if (!timer) return;
    const text = R.clock(elapsed());
    Array.prototype.forEach.call(document.querySelectorAll("[data-timer-clock]"), function (e) { if (e.textContent !== text) e.textContent = text; });
  }
  function syncTick() {
    if (timer && R.timerRunning(timer) && !tick) tick = window.setInterval(paintClocks, 1000);
    else if ((!timer || !R.timerRunning(timer)) && tick) { window.clearInterval(tick); tick = 0; }
  }
  syncTick();
  function today() { return store.today(); }
  function timerBookTitle() { const b = timer && timer.bookId ? store.get("books", timer.bookId) : null; return b ? b.title : ""; }

  function clockHtml() {
    const running = R.timerRunning(timer), title = timerBookTitle();
    return '<p class="ln-clock" data-timer-clock role="timer" aria-live="off" aria-label="Time on the reading timer">' + R.clock(elapsed()) + '</p>' +
      '<p class="ln-item-sub">' + (title ? "Reading " + esc(title) : "Reading") + ' · ' + (running ? "running" : "paused") + '</p>' +
      '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="timer-' + (running ? "pause" : "resume") + '">' + (running ? "Pause" : "Resume") + '</button>' +
      '<button type="button" class="btn btn-primary" data-act="timer-finish">Finish and save</button>' +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="timer-discard">Discard</button></div>';
  }

  function bookOptions(selected) {
    const books = L.live(store.list("books")).filter(function (b) { return b.status !== "completed" || b.id === selected; });
    const rank = { reading: 0, paused: 1, want: 2, completed: 3 };
    books.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || (a.title < b.title ? -1 : 1); });
    return [["", "No particular book"]].concat(books.map(function (b) { return [b.id, b.title]; }));
  }
  function defaultBook() {
    const live = L.live(store.list("books"));
    if (rd.timerBook && live.some(function (b) { return b.id === rd.timerBook; })) return rd.timerBook;
    const cur = L.currentBooks(store.state());
    return cur.length ? cur[0].id : "";
  }

  function timerCard() {
    let h = '<section class="card ln-card" aria-labelledby="lnRtTimer"><div class="card-title-row"><h2 class="card-title" id="lnRtTimer">Reading timer</h2></div>';
    if (timer) return h + clockHtml() + '</section>';
    h += '<p class="field-hint">Optional. Start it when you begin and save the minutes when you stop. It never changes your page count: update the page as you always do.</p>' +
      '<div class="ln-timer-start"><div class="form-row"><label for="lnTimerBook">Book</label><select id="lnTimerBook" name="timerBook" data-fk="timerBook">' + bookOptions(defaultBook()).map(function (x) {
        return '<option value="' + esc(x[0]) + '"' + (x[0] === defaultBook() ? " selected" : "") + '>' + esc(x[1]) + '</option>';
      }).join("") + '</select></div>' +
      '<div class="ln-item-btns"><button type="button" class="btn btn-primary" data-act="timer-start">Start timer</button><button type="button" class="btn btn-secondary" data-act="time-add">Add time by hand</button></div></div>';
    return h + '</section>';
  }

  /* ---------------- saving a session (from the timer or by hand) ---------------- */

  // opts: { session } to edit one; { fromTimer: true } to save the running timer.
  function openTimeForm(opts) {
    opts = opts || {};
    const s = opts.session, fromTimer = !!opts.fromTimer, S = store.state();
    const ms = fromTimer ? elapsed() : 0, mins = fromTimer ? R.minutesFrom(ms) : 0;
    const start = s || { bookId: fromTimer && timer ? timer.bookId : defaultBook(), day: today(), minutes: mins || "", note: "" };
    const book = start.bookId ? store.get("books", start.bookId) : null;
    const body =
      (fromTimer ? '<p class="ln-big">' + R.clock(ms) + ' timed</p>' + (mins ? "" : '<p class="field-hint">Less than half a minute was timed. Enter the minutes if you did read.</p>') : "") +
      A.fText("minutes", "Minutes read", String(start.minutes), { required: true, mode: "numeric", max: 3, hint: fromTimer ? "Change it if you paused the timer late or forgot to start it." : "" }) +
      A.fText("day", "Day", start.day, { type: "date", required: true }) +
      A.fSelect("bookId", "Book", bookOptions(start.bookId), start.bookId, {}) +
      (s ? "" : '<div id="lnRtPage">' + A.fText("page", "Page you reached (optional)", "", { mode: "numeric", max: 6, hint: book ? "Now on page " + book.currentPage + ". Filling this in updates the book's page; leave it empty to leave the page alone." : "Choose a book to update its page too." }) + '</div>') +
      A.fText("note", "Note (optional)", start.note, { max: 200 });
    A.openSheet({
      title: s ? "Edit reading time" : fromTimer ? "Save this reading time" : "Add reading time", body: body, submit: s ? "Save changes" : "Save", focus: "#lnf_minutes",
      onOpen: function (el) { const d = el.querySelector("#lnf_day"); if (d) d.max = today(); const p = el.querySelector("#lnRtPage"); if (p) p.hidden = !start.bookId; },
      onChange: function (t, el) {
        if (t.id !== "lnf_bookId") return;
        const p = el.querySelector("#lnRtPage"), b = t.value ? store.get("books", t.value) : null;
        if (!p) return;
        p.hidden = !b;
        const h = el.querySelector("#lnh_page");
        if (h) h.textContent = b ? "Now on page " + b.currentPage + ". Filling this in updates the book's page; leave it empty to leave the page alone." : "";
      },
      onSubmit: function (v) {
        const res = R.check({ minutes: v.minutes, day: v.day, bookId: v.bookId, note: v.note }, { today: today(), books: L.live(S.books) });
        if (!res.ok) return { ok: false, errors: res.errors };
        const b = res.value.bookId ? store.get("books", res.value.bookId) : null;
        let pageN = null;
        if (!s && b && String(v.page || "").trim() !== "") {
          const c = A.checkPage(b, v.page);
          if (c.error) return { ok: false, errors: { page: c.error } };
          pageN = c.n;
        }
        if (s) { if (!store.put("sessions", Object.assign({}, s, res.value))) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; } A.say("Reading time saved."); return { ok: true }; }
        if (!store.add("sessions", res.value)) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        if (fromTimer) { timer = null; saveTimer(); syncTick(); }
        let msg = "Saved " + R.minutesText(res.value.minutes) + (b ? " on " + b.title : "") + ".";
        if (pageN !== null && b) {
          const r2 = A.applyPage(store.get("books", b.id) || b, pageN);
          if (!r2.ok) msg += " The page could not be updated.";
          else if (!r2.same) msg += " Now on page " + pageN + ".";
        }
        A.notice(msg, "");
        return { ok: true };
      }
    });
  }

  function deleteSession(id) {
    if (!store.get("sessions", id)) return;
    if (!store.remove("sessions", id)) { A.saveFailed(); return; }
    A.notice("Reading time deleted.", "Undo", function () { store.undoRemove("sessions", id); });
  }

  /* ---------------- actions ---------------- */

  A.acts["timer-start"] = function (el) {
    if (timer) { A.say("A timer is already running."); return; }
    let id = el && el.getAttribute("data-id");
    if (!id) { const sel = document.getElementById("lnTimerBook"); id = sel ? sel.value : defaultBook(); }
    if (id && !store.get("books", id)) id = "";
    rd.timerBook = id;
    timer = R.timerStart(id, Date.now());
    saveTimer(); syncTick(); A.render();
    const b = id ? store.get("books", id) : null;
    A.say("Reading timer started" + (b ? " for " + b.title : "") + ".");
  };
  A.acts["timer-pause"] = function () { if (!timer) return; timer = R.timerPause(timer, Date.now()); saveTimer(); syncTick(); A.render(); A.say("Timer paused."); };
  A.acts["timer-resume"] = function () { if (!timer) return; timer = R.timerResume(timer, Date.now()); saveTimer(); syncTick(); A.render(); A.say("Timer running."); };
  A.acts["timer-finish"] = function () {
    if (!timer) return;
    timer = R.timerPause(timer, Date.now()); saveTimer(); syncTick(); A.render();      // stop the clock while the minutes are checked; Cancel leaves it paused
    openTimeForm({ fromTimer: true });
  };
  A.acts["timer-discard"] = function () {
    if (!timer) return;
    timer = R.timerPause(timer, Date.now()); saveTimer(); syncTick(); A.render();
    const m = R.minutesFrom(elapsed());
    A.confirmSheet({ title: "Discard this timer?", text: m ? "The " + plural(m, "minute") + " timed will not be saved." : "Nothing has been timed yet.", yes: "Discard",
      onYes: function () { timer = null; saveTimer(); syncTick(); A.render(); A.say("Timer discarded."); } });
  };
  A.acts["time-add"] = function () { openTimeForm({}); };
  A.acts["time-edit"] = function (el) { const s = store.get("sessions", el.getAttribute("data-id")); if (s) openTimeForm({ session: s }); };
  A.acts["time-delete"] = function (el) { deleteSession(el.getAttribute("data-id")); };
  A.acts["rd-range"] = function (el) { rd.range = el.getAttribute("data-v"); A.render(); };
  A.acts["rd-metric"] = function (el) { rd.metric = el.getAttribute("data-v"); A.render(); };
  A.acts["cal-nav"] = function (el) { rd.month = el.getAttribute("data-ym"); A.render(); };
  A.acts["bpart"] = function (el) { A.state.bpart = el.getAttribute("data-v"); A.render(); };
  A.acts["reading-open"] = function () { A.state.bpart = "stats"; A.go("books"); };

  /* ---------------- the screen ---------------- */

  function tile(n, label, sub) { return '<div class="ln-tile"><span class="ln-tile-n">' + esc(n) + '</span><span class="ln-tile-l">' + esc(label) + '</span>' + (sub ? '<span class="ln-tile-s">' + esc(sub) + '</span>' : "") + '</div>'; }
  function seg(label, act, items, current) {
    return '<div class="ln-seg ln-seg-sm ln-seg-n' + items.length + '" role="group" aria-label="' + esc(label) + '">' + items.map(function (x) {
      return '<button type="button" class="ln-seg-btn" data-act="' + act + '" data-v="' + x[0] + '" aria-pressed="' + (current === x[0]) + '">' + esc(x[1]) + '</button>';
    }).join("") + '</div>';
  }
  function minTxt(n) { return n ? R.minutesText(n) : "0 min"; }

  function glance(S) {
    const o = R.overview(L.live(S.books), S.sessions, today());
    const cell = function (label, t) { return tile(String(t.pages), label, plural(t.pages, "page").replace(/^\d+ /, "") + " · " + minTxt(t.minutes)); };
    const ap = o.avgPages.last30, am = o.avgMinutes.last30, fin = o.year.booksFinished;
    let h = '<section class="card ln-card" aria-labelledby="lnRtNow"><div class="card-title-row"><h2 class="card-title" id="lnRtNow">At a glance</h2></div><div class="ln-tiles">' +
      cell("Today", o.today) + cell("This week", o.week) + cell("This month", o.month) + '</div><div class="ln-tiles">' +
      tile(String(fin.count), "Books finished in " + today().slice(0, 4), fin.undated ? plural(fin.undated, "finished book") + " with no finish date not counted" : "") +
      tile(ap ? String(ap.avg) : "–", "Pages per session", ap ? "last 30 days · " + plural(ap.sessions, "session") : "no pages logged in 30 days") +
      tile(String(o.streak.current), "Day streak", "best " + o.streak.longest + (o.streak.longest === 1 ? " day" : " days")) + '</div>';
    if (am) h += '<p class="ln-item-sub">Average timed session, last 30 days: ' + esc(R.minutesText(am.avg)) + ' (' + plural(am.sessions, "session") + ').</p>';
    h += '<p class="field-hint">A session is one book on one day you logged pages. A streak counts days with pages logged or reading time saved; a day with neither is a day with nothing recorded. The week runs Monday to Sunday.</p></section>';
    return h;
  }

  function history(S) {
    const pts = R.series(L.live(S.books), S.sessions, rd.range, today());
    const val = rd.metric === "minutes" ? "minutes" : "pages";
    const items = pts.map(function (x) { return { label: x.label, value: x[val], title: x.title }; });
    const total = pts.reduce(function (s, x) { return s + x[val]; }, 0);
    const any = pts.some(function (x) { return x.pages > 0 || x.minutes > 0; });
    return '<section class="card ln-card" aria-labelledby="lnRtHist"><div class="card-title-row"><h2 class="card-title" id="lnRtHist">Reading history</h2></div>' +
      seg("History length", "rd-range", RANGES, rd.range) + seg("What to show", "rd-metric", [["pages", "Pages"], ["minutes", "Minutes"]], val) +
      (any ? A.bars(items, "Reading history: " + val + " over " + RANGE_WORDS[rd.range], val) + '<p class="ln-item-sub">' + (val === "pages" ? plural(total, "page") : R.minutesText(total)) + ' over ' + RANGE_WORDS[rd.range] + '.</p>'
        : '<p class="empty-state-compact">Nothing recorded in ' + RANGE_WORDS[rd.range] + '. Update the page of a book you are reading, and it shows up here.</p>') + '</section>';
  }

  function calendar(S) {
    const t = today(), ym = /^\d{4}-\d{2}$/.test(rd.month) ? rd.month : t.slice(0, 7);
    const c = R.calendar(L.live(S.books), S.sessions, ym, t);
    const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let h = '<section class="card ln-card" aria-labelledby="lnRtCal"><div class="card-title-row"><h2 class="card-title" id="lnRtCal">Consistency</h2></div>' +
      '<div class="ln-cal-nav"><button type="button" class="btn btn-secondary ln-cal-btn" data-act="cal-nav" data-ym="' + c.prev + '" aria-label="Previous month">←</button><span class="ln-cal-title" aria-live="polite">' + esc(c.title) + '</span>' +
      '<button type="button" class="btn btn-secondary ln-cal-btn" data-act="cal-nav" data-ym="' + c.next + '" aria-label="Next month"' + (c.canNext ? "" : " disabled") + '>→</button></div>' +
      '<table class="ln-cal"><caption class="visually-hidden">' + esc(c.title) + ': ' + plural(c.activeDays, "day") + ' with reading recorded</caption><thead><tr>' + wd.map(function (d) { return '<th scope="col"><abbr title="' + ({ Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" })[d] + '">' + d.slice(0, 2) + '</abbr></th>'; }).join("") + '</tr></thead><tbody>';
    c.weeks.forEach(function (row) {
      h += '<tr>' + row.map(function (x) {
        if (!x) return '<td class="ln-cal-empty"></td>';
        const cls = "ln-cal-d" + (x.read ? " ln-cal-read" : "") + (x.today ? " ln-cal-today" : "") + (x.future ? " ln-cal-future" : "");
        const say = x.read ? '<span class="visually-hidden"> ' + esc(R.MONTHS[Number(x.d.slice(5, 7)) - 1] + " " + x.day) + ': ' + (x.pages ? plural(x.pages, "page") : "") + (x.pages && x.minutes ? ", " : "") + (x.minutes ? plural(x.minutes, "minute") : "") + '</span>' : "";
        return '<td><span class="' + cls + '"' + (x.today ? ' aria-current="date"' : "") + '>' + x.day + say + '</span></td>';
      }).join("") + '</tr>';
    });
    return h + '</tbody></table><p class="ln-item-sub">' + plural(c.activeDays, "day") + ' with pages logged or reading time saved in ' + esc(c.title) + '.</p></section>';
  }

  function timeList(S) {
    const all = L.live(S.sessions), list = R.recentSessions(all, 10);
    let h = '<section class="card ln-card" aria-labelledby="lnRtTimes"><div class="card-title-row"><h2 class="card-title" id="lnRtTimes">Reading time (' + all.length + ')</h2><button type="button" class="btn btn-secondary" data-act="time-add">+ Add time</button></div>';
    if (!list.length) return h + '<p class="empty-state-compact">No reading time saved. Use the timer above, or add minutes by hand.</p></section>';
    h += '<ul class="ln-sessions">' + list.map(function (x) {
      const b = x.bookId ? store.get("books", x.bookId) : null;
      return '<li class="ln-session"><div class="ln-source-main"><span class="ln-item-title">' + esc(R.minutesText(x.minutes)) + (b ? " · " + esc(b.title) : "") + '</span><span class="ln-item-sub">' + esc(A.fmtDate(x.day)) + (x.note ? " · " + esc(x.note) : "") + '</span></div>' +
        '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="time-edit" data-id="' + esc(x.id) + '" aria-label="Edit ' + esc(R.minutesText(x.minutes)) + ' on ' + esc(A.fmtDate(x.day)) + '">Edit</button>' +
        '<button type="button" class="btn btn-secondary ln-danger" data-act="time-delete" data-id="' + esc(x.id) + '" aria-label="Delete ' + esc(R.minutesText(x.minutes)) + ' on ' + esc(A.fmtDate(x.day)) + '">Delete</button></div></li>';
    }).join("") + '</ul>';
    if (all.length > list.length) h += '<p class="field-hint">Showing the latest ' + list.length + '. Older reading time is kept and still counted.</p>';
    return h + '</section>';
  }

  A.readingHtml = function () {
    const S = store.state();
    return timerCard() + glance(S) + history(S) + calendar(S) + timeList(S);
  };

  /* ---------------- on each book's page ---------------- */

  A.readingBookHtml = function (b) {
    const S = store.state(), mins = R.bookMinutes(S.sessions, b.id), n = L.live(S.sessions).filter(function (x) { return x.bookId === b.id; }).length;
    const total = mins ? '<span class="ln-item-sub">Reading time: ' + esc(R.minutesText(mins)) + ' in ' + plural(n, "session") + '</span>' : '<span class="ln-item-sub">No reading time saved for this book.</span>';
    if (timer && timer.bookId === b.id) return '<div class="ln-readline">' + clockHtml() + total + '</div>';
    if (timer) return '<div class="ln-readline">' + total + '<span class="ln-item-sub">The reading timer is running' + (timerBookTitle() ? " for " + esc(timerBookTitle()) : "") + '.</span></div>';
    return '<div class="ln-readline">' + total + '<button type="button" class="btn btn-secondary" data-act="timer-start" data-id="' + esc(b.id) + '">Start reading timer</button></div>';
  };

  /* ---------------- on the Dashboard ---------------- */

  A.dashTop.push(function (S) {
    const books = L.live(S.books);
    const o = R.overview(books, S.sessions, today());
    let h = '<section class="card ln-card" aria-labelledby="lnDashRead"><div class="card-title-row"><h2 class="card-title" id="lnDashRead">Reading</h2><button type="button" class="btn-icon" data-act="reading-open">Reading stats</button></div>';
    if (timer) h += clockHtml();
    const none = !o.streak.totalDays;
    if (none && !timer) return h + '<p class="empty-state-compact">Update the page of a book you are reading and your pages, streak and history appear here.</p></section>';
    h += '<div class="ln-tiles">' + tile(String(o.today.pages), "Pages today", minTxt(o.today.minutes)) + tile(String(o.week.pages), "Pages this week", minTxt(o.week.minutes)) + tile(String(o.streak.current), "Day streak", "best " + o.streak.longest) + '</div>';
    if (!timer) h += '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="timer-start">Start reading timer</button></div>';
    return h + '</section>';
  });

  window.addEventListener("pagehide", function () { if (tick) { window.clearInterval(tick); tick = 0; } });
  window.addEventListener("pageshow", function () { syncTick(); paintClocks(); });
})();
