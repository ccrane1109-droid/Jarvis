/* ==========================================================================
   JARVIS — Learning & Research Hub: Study (spaced-repetition reviews, flashcards, the schedule, and your history).

   Four parts:  Review   what is due now (lessons and flashcards together) and practice sessions you choose
                Cards    your flashcards: add, edit, pause, delete, and see when each will be reviewed
                Schedule everything that is being reviewed, soonest first, and what isn't yet
                History  how many you reviewed and how often you recalled them (no figure until there is something to measure)

   The rules (the 1, 3, 7, 14 and 30 day steps, Easy / Good / Hard / Forgot) are in learning-srs.js; the cards are in
   learning-cards-logic.js. Everything runs on this device. A review is saved the moment you answer, so closing the app
   mid-session loses nothing.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;
  const SRS = window.JarvisLearningSRS, K = window.JarvisLearningCards;

  // What is open in the Study section.
  const ui = A.state.study = { part: "review", session: null, practice: { tag: "", bookId: "", researchId: "", limit: "20", shuffle: true } };
  const PARTS = [["review", "Review"], ["cards", "Flashcards"], ["schedule", "Schedule"], ["history", "History"]];

  function today() { return store.today(); }
  function plural(n, a, b) { return A.plural(n, a, b); }
  function all() { return { notes: store.list("notes"), cards: store.list("cards") }; }
  function scheduledItems() { const x = all(); return x.notes.concat(x.cards); }

  // How an item appears: { kind: "Lesson" | "Flashcard", title, context }
  function describe(kind, rec) {
    return kind === "cards"
      ? { label: "Flashcard", title: A.snippet(rec.question, 120), context: A.noteSource(rec) }
      : { label: A.typeLabel ? A.typeLabel(rec.type) : "Lesson", title: rec.title || A.snippet(rec.text, 120), context: A.noteSource(rec) };
  }
  function srsOf(kind, id) { const r = store.get(kind, id); return r ? r.srs || null : null; }

  /* ---------------- saving a review / pausing / turning on ---------------- */

  function setSrs(kind, id, next) {
    if (!store.patch(kind, id, { srs: next })) { A.saveFailed(); return false; }
    return true;
  }
  function setRemember(kind, id, on) {
    const r = store.get(kind, id);
    if (!r) return;
    if (setSrs(kind, id, SRS.setEnabled(r.srs || null, on, today()))) A.say(on ? "Added to your reviews." : "Taken out of your reviews.");
  }
  function setPaused(kind, id) {
    const r = store.get(kind, id);
    if (!r || !r.srs) return;
    const next = r.srs.paused ? SRS.resume(r.srs, today()) : SRS.pause(r.srs);
    if (setSrs(kind, id, next)) A.say(next.paused ? "Reviews paused." : "Reviews resumed.");
  }

  /* ---------------- the Dashboard card ---------------- */

  A.dashTop.push(function () {
    const x = all(), items = x.notes.concat(x.cards), sum = SRS.summary(items, today());
    const dueNotes = SRS.dueItems(x.notes, today()).length, dueCards = SRS.dueItems(x.cards, today()).length;
    let h = '<section class="card ln-card ln-review-card" aria-labelledby="lnDashReview"><div class="card-title-row"><h2 class="card-title" id="lnDashReview">Review Knowledge</h2><button type="button" class="btn-icon" data-act="study-open">Study</button></div>';
    if (sum.due) {
      h += '<p class="ln-big" data-due="' + sum.due + '">' + plural(sum.due, "item") + ' due for review</p><p class="ln-item-sub">' + esc([dueNotes ? plural(dueNotes, "lesson") : "", dueCards ? plural(dueCards, "flashcard") : ""].filter(Boolean).join(" · ") + (sum.overdue ? " · " + sum.overdue + " overdue" : "")) + '</p>' +
        '<button type="button" class="btn btn-primary" data-act="study-start-due">Start review</button>';
    } else if (sum.scheduled) {
      h += '<p class="ln-big" data-due="0">Nothing due today</p><p class="ln-item-sub">' + (sum.nextDue ? "Next review " + esc(A.fmtShort(sum.nextDue)) + " · " : "") + esc(plural(sum.scheduled, "item") + " in your schedule" + (sum.paused ? ", " + sum.paused + " paused" : "")) + '.</p>';
    } else {
      h += '<p class="ln-big" data-due="0">Nothing to review yet</p><p class="empty-state-compact">Tick “Remember this” when you save a takeaway, or add a flashcard, and JARVIS will bring it back after 1, 3, 7, 14 and 30 days.</p>' +
        '<button type="button" class="btn btn-secondary" data-act="study-open">Set up reviews</button>';
    }
    return h + '</section>';
  });

  /* ---------------- starting and running a session ---------------- */

  function startSession(mode, opts) {
    const q = K.queue(store.state(), Object.assign({ mode: mode }, opts || {}), today());
    if (!q.length) { A.say(mode === "due" ? "Nothing is due for review." : "No flashcards match."); A.notice(mode === "due" ? "Nothing is due for review." : "No flashcards match those choices.", ""); return; }
    ui.session = { mode: mode, queue: q, i: 0, revealed: false, results: [], skipped: 0, paused: 0 };
    ui.part = "review";
    A.go("study", "");
  }
  function current() {
    const s = ui.session;
    while (s && s.i < s.queue.length) {
      const ref = s.queue[s.i], rec = store.get(ref.kind, ref.id);
      if (rec && (s.mode === "practice" || SRS.isDue(rec.srs, today()) || s.queue[s.i].seen)) return { ref: ref, rec: rec };
      s.queue.splice(s.i, 1);             // deleted, paused or no longer due meanwhile: skip it
    }
    return null;
  }
  function answer(g) {
    const s = ui.session, cur = s && current();
    if (!cur || !s.revealed) return;
    const next = s.mode === "due" ? SRS.grade(cur.rec.srs, g, today()) : SRS.practice(cur.rec.srs || null, g, today());
    if (!next || !setSrs(cur.ref.kind, cur.ref.id, next)) return;
    s.results.push({ kind: cur.ref.kind, id: cur.ref.id, g: g, due: next.due, on: next.on });
    s.i++; s.revealed = false;
    A.render();
    A.say(s.i < s.queue.length ? "Saved. " + (s.queue.length - s.i) + " left." : "Session finished.");
  }
  function skip() {
    const s = ui.session;
    if (!s || s.i >= s.queue.length) return;
    s.queue.push(s.queue.splice(s.i, 1)[0]);
    s.queue[s.queue.length - 1].seen = true;
    s.skipped++; s.revealed = false;
    A.render();
  }
  function pauseCurrent() {
    const s = ui.session, cur = s && current();
    if (!cur || !cur.rec.srs) return;
    if (setSrs(cur.ref.kind, cur.ref.id, SRS.pause(cur.rec.srs))) { s.paused++; s.i++; s.revealed = false; A.render(); A.say("Paused. It won't come back until you resume it."); }
  }

  function sessionHtml() {
    const s = ui.session, cur = current();
    if (!cur) return summaryHtml();
    const d = describe(cur.ref.kind, cur.rec), total = s.queue.length, n = s.i + 1;
    const pct = Math.round(s.i / total * 100);
    let h = '<div class="ln-head"><h2 class="ln-h2" data-focus-top>' + (s.mode === "due" ? "Review" : "Practice") + ' <span class="ln-item-sub">' + n + ' of ' + total + '</span></h2><button type="button" class="btn btn-secondary" data-act="study-end">End session</button></div>' +
      A.barHtml(pct, "Session progress: " + s.i + " of " + total + " done") +
      '<section class="card ln-card ln-flash" aria-label="Question"><div class="ln-badges">' + A.badge("accent", d.label) + (cur.ref.kind === "notes" ? "" : "") + '</div>';
    if (cur.ref.kind === "cards") {
      h += '<p class="ln-flash-q">' + esc(cur.rec.question) + '</p>';
    } else {
      h += (cur.rec.title ? '<p class="ln-flash-q">' + esc(cur.rec.title) + '</p>' : '<p class="ln-flash-q">What do you remember about this lesson?</p>') +
        (d.context && d.context !== "Not linked to a book or project" ? '<p class="ln-item-sub">From: ' + esc(d.context) + '</p>' : "") +
        ((cur.rec.tags || []).length ? '<p class="ln-item-sub">' + esc(cur.rec.tags.map(function (t) { return "#" + t; }).join(" ")) + '</p>' : "");
    }
    if (!s.revealed) {
      h += '<button type="button" class="btn btn-primary ln-reveal" data-act="study-reveal" data-fk="reveal">Show answer</button></section>';
    } else {
      const ans = cur.ref.kind === "cards" ? cur.rec.answer : cur.rec.text + (cur.rec.evidence ? "\n\n" + cur.rec.evidence : "");
      h += '<div class="ln-flash-a" role="group" aria-label="Answer"><p class="ln-h4">Answer</p><p class="ln-text">' + esc(ans) + '</p></div></section>' +
        '<p class="ln-item-sub ln-grade-q">' + (s.mode === "due" ? "How well did you remember it?" : "How did you do? (Practice: this does not change your review dates.)") + '</p>' +
        '<div class="ln-grades" role="group" aria-label="How well did you remember it?">' + gradeButtons(cur.rec.srs, s.mode) + '</div>';
    }
    h += '<div class="ln-item-btns ln-flash-more"><button type="button" class="btn btn-secondary" data-act="study-skip">Skip for now</button>' +
      (s.mode === "due" ? '<button type="button" class="btn btn-secondary" data-act="study-pause-current">Pause this one</button>' : '') + '</div>' +
      '<p class="field-hint ln-keys">Keys: Space shows the answer, 1 Forgot, 2 Hard, 3 Good, 4 Easy.</p>';
    return h;
  }
  function gradeButtons(srs, mode) {
    const pv = srs && srs.on ? SRS.preview(srs, today()) : null;
    return SRS.GRADES.map(function (g, i) {
      const sub = mode === "due" && pv ? "Again in " + plural(pv[g.key].days, "day") : (mode === "due" ? "" : g.key === "forgot" ? "Missed it" : "Got it");
      return '<button type="button" class="ln-grade ln-grade-' + g.key + '" data-act="study-grade" data-g="' + g.key + '" aria-label="' + esc(g.label + (sub ? ", " + sub.toLowerCase() : "")) + '"><span class="ln-grade-name">' + g.label + '</span> <span class="ln-grade-sub">' + esc(sub) + '</span></button>';
    }).join("");
  }
  function summaryHtml() {
    const s = ui.session, by = { forgot: 0, hard: 0, good: 0, easy: 0 };
    s.results.forEach(function (r) { by[r.g]++; });
    const correct = by.hard + by.good + by.easy, total = s.results.length;
    const upcoming = s.mode === "due" ? s.results.filter(function (r) { return r.on; }).map(function (r) { return r.due; }).sort()[0] : "";
    return '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Session finished</h2></div><section class="card ln-card">' +
      (total ? '<p class="ln-big">' + plural(total, "answer") + '</p>' +
        '<p class="ln-item-sub">' + SRS.GRADES.slice().reverse().map(function (g) { return g.label + " " + by[g.key]; }).join(" · ") + '</p>' +
        '<p class="ln-text">You remembered ' + correct + ' of ' + total + ' (' + Math.round(correct / total * 100) + '%).' + (s.mode === "practice" ? " This was practice, so your review dates did not change." : "") + '</p>' +
        (upcoming ? '<p class="ln-item-sub">Your next review is ' + esc(A.fmtDate(upcoming)) + '.</p>' : "")
        : '<p class="empty-state-compact">No answers were recorded this time.</p>') +
      (s.skipped ? '<p class="ln-item-sub">' + plural(s.skipped, "item") + ' skipped; they are still due.</p>' : "") +
      (s.paused ? '<p class="ln-item-sub">' + plural(s.paused, "item") + ' paused.</p>' : "") +
      '<button type="button" class="btn btn-primary" data-act="study-end">Done</button></section>';
  }

  document.addEventListener("keydown", function (e) {
    if (!ui.session || A.state.tab !== "study" || document.body.classList.contains("ln-sheet-open")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (tag === "BUTTON" && e.key === " ")) return;
    if (e.key === " " && !ui.session.revealed && current()) { e.preventDefault(); ui.session.revealed = true; A.render(); return; }
    const map = { "1": "forgot", "2": "hard", "3": "good", "4": "easy" };
    if (map[e.key] && ui.session.revealed) { e.preventDefault(); answer(map[e.key]); }
  });

  /* ---------------- flashcards: editor, row, delete ---------------- */

  function editCard(card, preset) {
    const isNew = !card, p = preset || {};
    const c = card || { question: p.question || "", answer: p.answer || "", bookIds: p.bookIds || [], researchIds: p.researchIds || [], chapter: p.chapter || "", tags: p.tags || [], noteId: p.noteId || "" };
    const books = store.list("books"), research = store.list("research");
    const inSchedule = isNew ? true : !!(card.srs && card.srs.on);
    const body =
      A.fArea("question", "Question", c.question, { rows: 2, max: 500, required: true, placeholder: "What do you want to be able to answer?" }) +
      A.fArea("answer", "Answer", c.answer, { rows: 3, max: 2000, required: true, placeholder: "The answer, in your own words" }) +
      '<div class="form-row"><label class="ln-check"><input type="checkbox" name="remember"' + (inSchedule ? " checked" : "") + '><span>Review it on a schedule (1, 3, 7, 14, 30 days)</span></label><p class="field-hint">Untick to keep it for practice sessions only.</p></div>' +
      '<details class="ln-more"' + (!isNew || c.bookIds.length || c.researchIds.length || c.tags.length ? " open" : "") + '><summary>Connect it: books, chapter, projects, topics</summary>' +
      A.checks("bookIds", books, c.bookIds, "Book") + A.fText("chapter", "Chapter", c.chapter, { max: 80, placeholder: "Chapter 4, or a section name" }) +
      A.checks("researchIds", research, c.researchIds, "Research project") +
      A.fText("tags", "Topics", (c.tags || []).join(", "), { max: 200, placeholder: "habits, pricing", hint: "Separate topics with commas." }) + '</details>';
    A.openSheet({
      title: isNew ? "Add a flashcard" : "Edit flashcard", body: body, submit: isNew ? "Save flashcard" : "Save changes", focus: "#lnf_question",
      onSubmit: function (v) {
        const r = K.check(v, { today: today(), books: books, research: research, existingSrs: card ? card.srs : null });
        if (!r.ok) return { ok: false, errors: r.errors };
        const value = Object.assign({}, r.value, { noteId: card ? card.noteId || "" : c.noteId || "" });
        const saved = isNew ? store.add("cards", value) : store.put("cards", Object.assign({}, card, value, { inbox: undefined }));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(isNew ? "Flashcard saved." : "Flashcard updated.");
        A.notice(isNew ? (saved.srs && saved.srs.on ? "Flashcard saved. First review " + A.fmtShort(saved.srs.due) + "." : "Flashcard saved for practice.") : "Flashcard updated.", "");
        return { ok: true };
      }
    });
  }
  function deleteCard(id) {
    if (!store.remove("cards", id)) { A.saveFailed(); return; }
    A.notice("Flashcard deleted.", "Undo", function () { store.undoRemove("cards", id); });
  }

  function cardRow(cd) {
    const key = "card_" + cd.id, acc = K.accuracy(cd), n = cd.srs ? cd.srs.reviews.length : 0, due = SRS.isDue(cd.srs, today());
    const links = A.noteSource(cd);
    return '<details class="ln-note ln-note-plain" id="lncard_' + esc(cd.id) + '" data-keep="' + esc(key) + '"' + (A.state.open[key] ? " open" : "") + '>' +
      '<summary class="ln-note-sum"><span class="ln-badges">' + A.badge("accent", "Flashcard") + (due ? A.badge("red", "Due") : "") + (cd.inbox ? A.badge("neutral", "To organize") : "") + (cd.srs && cd.srs.on && cd.srs.paused ? A.badge("yellow", "Paused") : "") + (!(cd.srs && cd.srs.on) ? A.badge("neutral", "Practice only") : "") + '</span>' +
      '<span class="ln-note-title">' + esc(cd.question) + '</span><span class="ln-item-sub">' + esc([A.srsLabel(cd.srs), acc === null ? "Not answered yet" : "Recalled " + acc + "% of " + plural(n, "time")].join(" · ")) + '</span></summary>' +
      '<div class="ln-note-body"><p class="ln-h4">Answer</p><p class="ln-text">' + esc(cd.answer) + '</p>' +
      (cd.chapter ? '<p class="ln-item-sub">Chapter: ' + esc(cd.chapter) + '</p>' : "") +
      ((cd.tags || []).length ? '<div class="ln-chips" role="group" aria-label="Topics">' + cd.tags.map(function (t) { return '<span class="badge badge-neutral">#' + esc(t) + '</span>'; }).join("") + '</div>' : "") +
      (links && links !== "Not linked to a book or project" ? '<p class="ln-item-sub">Connected to: ' + esc(links) + '</p>' : "") +
      '<div class="ln-item-btns ln-note-btns"><button type="button" class="btn btn-secondary" data-act="card-edit" data-id="' + esc(cd.id) + '">Edit</button>' +
      (cd.inbox ? '<button type="button" class="btn btn-secondary" data-act="card-organized" data-id="' + esc(cd.id) + '">Mark organized</button>' : "") +
      (cd.srs && cd.srs.on ? '<button type="button" class="btn btn-secondary" data-act="srs-pause" data-kind="cards" data-id="' + esc(cd.id) + '">' + (cd.srs.paused ? "Resume reviews" : "Pause reviews") + '</button>' : '<button type="button" class="btn btn-secondary" data-act="srs-remember" data-kind="cards" data-id="' + esc(cd.id) + '" data-on="1">Add to reviews</button>') +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="card-delete" data-id="' + esc(cd.id) + '">Delete</button></div></div></details>';
  }
  A.cardRow = cardRow;
  A.editCard = editCard;

  /* ---------------- the four parts ---------------- */

  function reviewPart() {
    const x = all(), items = x.notes.concat(x.cards), sum = SRS.summary(items, today());
    const dueNotes = SRS.dueItems(x.notes, today()).length, dueCards = SRS.dueItems(x.cards, today()).length;
    let h = '<section class="card ln-card" aria-labelledby="lnStDue"><div class="card-title-row"><h2 class="card-title" id="lnStDue">Due for review</h2></div>';
    if (sum.due) h += '<p class="ln-big">' + plural(sum.due, "item") + '</p><p class="ln-item-sub">' + esc([dueNotes ? plural(dueNotes, "lesson") : "", dueCards ? plural(dueCards, "flashcard") : ""].filter(Boolean).join(" · ")) + '</p><button type="button" class="btn btn-primary" data-act="study-start-due">Start review (' + sum.due + ')</button>';
    else h += '<p class="ln-big">Nothing due today</p><p class="ln-item-sub">' + (sum.nextDue ? "Your next review is " + esc(A.fmtDate(sum.nextDue)) + "." : sum.scheduled ? "" : "Nothing is in your schedule yet.") + '</p>';
    h += '<p class="field-hint">Each lesson comes back after 1, 3, 7, 14 and 30 days (then 60 and 90, so a lesson you keep remembering is still checked now and then). Easy skips ahead, Hard comes back sooner, Forgot starts again tomorrow.</p></section>';

    // practice
    const cards = x.cards, tags = L.allTags(cards.map(function (c) { return { tags: c.tags, deletedAt: c.deletedAt }; }));
    const bookIds = {}, resIds = {};
    cards.forEach(function (c) { (c.bookIds || []).forEach(function (id) { bookIds[id] = 1; }); (c.researchIds || []).forEach(function (id) { resIds[id] = 1; }); });
    const pr = ui.practice;
    h += '<section class="card ln-card" aria-labelledby="lnStPractice"><div class="card-title-row"><h2 class="card-title" id="lnStPractice">Practice flashcards</h2><button type="button" class="btn-icon" data-act="card-add">+ Flashcard</button></div>';
    if (!cards.length) h += '<p class="empty-state-compact">No flashcards yet. Write a question and its answer, or turn a note into a flashcard from the library.</p><button type="button" class="btn btn-secondary" data-act="card-add">Add your first flashcard</button>';
    else {
      h += '<form data-form="practice" novalidate><div class="ln-two">' +
        A.fSelect("p_tag", "Topic", [["", "All topics"]].concat(tags.map(function (t) { return [t.tag, "#" + t.tag + " (" + t.count + ")"]; })), pr.tag, {}) +
        A.fSelect("p_book", "Book", [["", "All books"]].concat(store.list("books").filter(function (b) { return bookIds[b.id]; }).map(function (b) { return [b.id, b.title]; })), pr.bookId, {}) + '</div>' +
        '<div class="ln-two">' + A.fSelect("p_research", "Research project", [["", "All projects"]].concat(store.list("research").filter(function (r) { return resIds[r.id]; }).map(function (r) { return [r.id, r.title]; })), pr.researchId, {}) +
        A.fSelect("p_limit", "How many", [["10", "10 cards"], ["20", "20 cards"], ["50", "50 cards"], ["0", "All"]], pr.limit, {}) + '</div>' +
        '<div class="form-row"><label class="ln-check"><input type="checkbox" name="p_shuffle"' + (pr.shuffle ? " checked" : "") + '><span>Shuffle the order</span></label></div>' +
        '<p class="field-hint" id="lnPracticeCount">' + practiceCountText() + '</p><button type="submit" class="btn btn-primary">Start practice</button></form>';
    }
    return h + '</section>';
  }
  function practiceFilter() { const pr = ui.practice; return { mode: "practice", tag: pr.tag, bookId: pr.bookId, researchId: pr.researchId, limit: Number(pr.limit) || 0, shuffle: pr.shuffle }; }
  function practiceCountText() {
    const q = K.queue(store.state(), Object.assign(practiceFilter(), { limit: 0 }), today());
    return q.length ? plural(q.length, "flashcard") + " match" + (q.length === 1 ? "es" : "") + ". Answers count toward your accuracy; they do not move your review dates." : "No flashcards match those choices.";
  }

  function cardsResults() {
    const S = store.state(), f = A.state.filters.study;
    const list = K.filter(S.cards, S, f, today());
    if (!list.length) {
      return L.live(S.cards).length ? '<p class="empty-state">No flashcards match. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>'
        : '<div class="empty-state"><p>No flashcards yet.</p><p class="field-hint">A flashcard is a question and answer you write yourself. The answer stays hidden until you reveal it.</p><button type="button" class="btn btn-primary" data-act="card-add">Add your first flashcard</button></div>';
    }
    return '<div class="ln-list">' + list.map(cardRow).join("") + '</div>';
  }
  function cardsCount() {
    const S = store.state(), n = K.filter(S.cards, S, A.state.filters.study, today()).length, total = L.live(S.cards).length;
    return n === total ? plural(total, "flashcard") : n + " of " + total + " flashcards";
  }
  function cardsPart() {
    const S = store.state(), tags = L.allTags(S.cards.map(function (c) { return { tags: c.tags, deletedAt: c.deletedAt }; }));
    return A.toolbar("study", [
      { name: "q", kind: "search", label: "Search flashcards", placeholder: "Search flashcards" },
      { name: "status", kind: "select", label: "Filter by review status", options: [["", "All"], ["due", "Due now"], ["scheduled", "In the schedule"], ["paused", "Paused"], ["practice", "Practice only"]] },
      { name: "tag", kind: "select", label: "Filter by topic", options: [["", "All topics"]].concat(tags.map(function (t) { return [t.tag, "#" + t.tag]; })) },
      { name: "bookId", kind: "select", label: "Filter by book", options: [["", "All books"]].concat(store.list("books").map(function (b) { return [b.id, b.title]; })) },
      { name: "researchId", kind: "select", label: "Filter by project", options: [["", "All projects"]].concat(store.list("research").map(function (r) { return [r.id, r.title]; })) },
      { name: "sort", kind: "select", label: "Sort flashcards", options: [["newest", "Newest first"], ["due", "Next review"], ["hardest", "Hardest first"], ["question", "A to Z"]] }
    ], { fold: 2 }) + '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(cardsCount()) + '</p><div id="lnResults">' + cardsResults() + '</div>';
  }

  function schedulePart() {
    const x = all(), items = SRS.scheduled(x.notes.map(function (n) { return Object.assign({ _k: "notes" }, n); }).concat(x.cards.map(function (c) { return Object.assign({ _k: "cards" }, c); })));
    let h = '<section class="card ln-card" aria-labelledby="lnStSched"><div class="card-title-row"><h2 class="card-title" id="lnStSched">When things come back (' + items.length + ')</h2></div>';
    if (!items.length) h += '<p class="empty-state-compact">Nothing is in your schedule yet. Lessons and flashcards you add to your reviews appear here with the date of their next review.</p>';
    else h += '<ul class="ln-sched">' + items.map(function (it) {
      const d = describe(it._k, it);
      return '<li class="ln-sched-row"><div class="ln-sched-main"><span class="ln-badges">' + A.badge(it._k === "cards" ? "accent" : "neutral", d.label) + (SRS.isDue(it.srs, today()) ? A.badge("red", "Due") : "") + '</span>' +
        '<span class="ln-item-title">' + esc(d.title) + '</span><span class="ln-item-sub">' + esc(A.srsLabel(it.srs)) + (it.srs.reviews.length ? " · reviewed " + plural(it.srs.reviews.filter(function (r) { return !r.p; }).length, "time") : " · not reviewed yet") + '</span></div>' +
        '<button type="button" class="btn btn-secondary" data-act="srs-pause" data-kind="' + it._k + '" data-id="' + esc(it.id) + '">' + (it.srs.paused ? "Resume" : "Pause") + '</button></li>';
    }).join("") + '</ul>';
    h += '</section>';
    // takeaways not in the schedule yet (including ones you saved before reviews existed)
    const todo = x.notes.filter(function (n) { return n.type === "takeaway" && !(n.srs && n.srs.on); });
    if (todo.length) {
      h += '<section class="card ln-card" aria-labelledby="lnStNot"><div class="card-title-row"><h2 class="card-title" id="lnStNot">Takeaways not being reviewed (' + todo.length + ')</h2><button type="button" class="btn btn-secondary" data-act="srs-all">Review all ' + todo.length + '</button></div>' +
        '<ul class="ln-sched">' + todo.slice(0, 8).map(function (n) {
          return '<li class="ln-sched-row"><div class="ln-sched-main"><span class="ln-item-title">' + esc(n.title || A.snippet(n.text, 110)) + '</span><span class="ln-item-sub">' + esc(A.noteSource(n)) + '</span></div><button type="button" class="btn btn-secondary" data-act="srs-remember" data-kind="notes" data-id="' + esc(n.id) + '" data-on="1">Remember this</button></li>';
        }).join("") + '</ul>' + (todo.length > 8 ? '<p class="field-hint">Showing 8 of ' + todo.length + '. “Review all” adds every one; you can pause any of them later.</p>' : '') + '</section>';
    }
    return h;
  }

  function historyPart() {
    const x = all(), items = x.notes.concat(x.cards), t = today();
    const row = function (label, from) { const a = SRS.accuracy(items, from, t); return '<li class="ln-rv-item"><strong>' + label + '</strong> <span class="ln-item-sub">' + (a.total ? plural(a.total, "answer") + " · recalled " + a.pct + "%" : "no answers yet") + '</span></li>'; };
    const sched = SRS.accuracy(items, "", "", { practice: false }), prac = SRS.accuracy(items, "", "", { practice: true });
    let h = '<section class="card ln-card" aria-labelledby="lnStHist"><div class="card-title-row"><h2 class="card-title" id="lnStHist">How you are doing</h2></div>';
    if (!SRS.count(items, "", "")) h += '<p class="empty-state-compact">No reviews yet. Your accuracy appears here after your first review or practice session. Nothing is shown until there is something to measure.</p>';
    else {
      h += '<ul class="ln-rv-list">' + row("Last 7 days", L.addDays(t, -6)) + row("Last 30 days", L.addDays(t, -29)) + row("All time", "") + '</ul>' +
        '<p class="ln-item-sub">' + esc(plural(sched.total, "scheduled review") + " · " + plural(prac.total, "practice answer")) + '</p>';
      const days = [];
      for (let i = 13; i >= 0; i--) { const d = L.addDays(t, -i); days.push({ label: String(Number(d.slice(8))), value: SRS.count(items, d, d), title: A.fmtShort(d) + ": " + plural(SRS.count(items, d, d), "answer") }); }
      h += '<h3 class="ln-h3">Answers per day, last 14 days</h3>' + A.bars(days, "Answers per day over the last 14 days", "answers");
    }
    h += '</section>';
    const hard = SRS.hardest(items, 3, 6);
    if (hard.length) h += '<section class="card ln-card" aria-labelledby="lnStHard"><div class="card-title-row"><h2 class="card-title" id="lnStHard">Hardest to remember</h2></div><ul class="ln-rv-list">' + hard.map(function (r) {
      const kind = r.item.question ? "cards" : "notes", d = describe(kind, r.item);
      return '<li class="ln-rv-item"><span class="ln-item-title">' + esc(d.title) + '</span><span class="ln-item-sub">' + r.pct + '% recalled over ' + plural(r.total, "answer") + '</span></li>';
    }).join("") + '</ul><p class="field-hint">Only items answered at least 3 times are listed.</p></section>';
    const recent = SRS.entries(items, "", "").sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; }).slice(0, 15);
    if (recent.length) h += '<section class="card ln-card" aria-labelledby="lnStRec"><div class="card-title-row"><h2 class="card-title" id="lnStRec">Recent answers</h2></div><ul class="ln-rv-list">' + recent.map(function (e) {
      const d = describe(e.item.question ? "cards" : "notes", e.item);
      return '<li class="ln-rv-item"><span class="ln-item-title">' + esc(d.title) + '</span><span class="ln-item-sub">' + esc(A.fmtShort(e.d) + " · " + SRS.labelOf(e.g) + (e.p ? " · practice" : "")) + '</span></li>';
    }).join("") + '</ul></section>';
    return h;
  }

  /* ---------------- the view ---------------- */

  function html() {
    if (ui.session) return sessionHtml();
    const tabs = '<div class="ln-seg ln-seg-parts" role="group" aria-label="Study sections">' + PARTS.map(function (p) {
      return '<button type="button" class="ln-seg-btn" data-act="study-part" data-v="' + p[0] + '" aria-pressed="' + (ui.part === p[0]) + '">' + p[1] + '</button>';
    }).join("") + '</div>';
    const body = ui.part === "cards" ? cardsPart() : ui.part === "schedule" ? schedulePart() : ui.part === "history" ? historyPart() : reviewPart();
    return '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Study</h2><button type="button" class="btn btn-primary" data-act="card-add">+ Flashcard</button></div>' + tabs + body;
  }

  A.register("study", {
    html: html,
    results: cardsResults,
    count: cardsCount,
    click: function (act, el) {
      if (act === "study-part") { ui.part = el.getAttribute("data-v"); A.render(); }
      else if (act === "study-reveal") { if (ui.session) { ui.session.revealed = true; A.render(); const g = document.querySelector(".ln-grade"); if (g) g.focus(); } }
      else if (act === "study-grade") answer(el.getAttribute("data-g"));
      else if (act === "study-skip") skip();
      else if (act === "study-pause-current") pauseCurrent();
      else if (act === "study-end") { ui.session = null; A.render(); }
      else if (act === "card-add") editCard(null, {});
      else if (act === "card-edit") { const c = store.get("cards", el.getAttribute("data-id")); if (c) editCard(c); }
      else if (act === "card-delete") deleteCard(el.getAttribute("data-id"));
      else if (act === "card-organized") { if (!store.patch("cards", el.getAttribute("data-id"), { inbox: undefined })) A.saveFailed(); }
    },
    submit: function (form) {
      if (form.getAttribute("data-form") === "practice") {
        const v = A.formValues(form);
        ui.practice = { tag: v.p_tag, bookId: v.p_book, researchId: v.p_research, limit: v.p_limit, shuffle: !!v.p_shuffle };
        startSession("practice", practiceFilter());
      }
    },
    change: function (el) {
      if (el.closest && el.closest('form[data-form="practice"]')) {
        const f = el.closest("form"), v = A.formValues(f);
        ui.practice = { tag: v.p_tag, bookId: v.p_book, researchId: v.p_research, limit: v.p_limit, shuffle: !!v.p_shuffle };
        const out = document.getElementById("lnPracticeCount");
        if (out) out.textContent = practiceCountText();
      }
    }
  });

  /* ---------------- actions other screens use ---------------- */

  A.acts["study-open"] = function () { ui.session = null; ui.part = "review"; A.go("study", ""); };
  A.acts["study-start-due"] = function () { startSession("due"); };
  A.acts["srs-pause"] = function (el) { setPaused(el.getAttribute("data-kind"), el.getAttribute("data-id")); };
  A.acts["srs-remember"] = function (el) { setRemember(el.getAttribute("data-kind"), el.getAttribute("data-id"), el.getAttribute("data-on") === "1"); };
  A.acts["srs-all"] = function () {
    const todo = store.list("notes").filter(function (n) { return n.type === "takeaway" && !(n.srs && n.srs.on); });
    A.confirmSheet({ title: "Review all your takeaways?", text: "Each of the " + plural(todo.length, "takeaway") + " will be added to your reviews, with the first review tomorrow. That could mean a lot of reviews at once; you can pause any of them later.", yes: "Add all " + todo.length, danger: false,
      onYes: function () {
        let failed = false;
        todo.forEach(function (n) { if (!failed && !store.patch("notes", n.id, { srs: SRS.setEnabled(n.srs || null, true, today()) })) failed = true; });
        if (failed) A.saveFailed(); else A.notice(plural(todo.length, "takeaway") + " added to your reviews.", "");
      } });
  };
  A.quickAdd.card = function () { editCard(null, {}); };
  A.study = { start: startSession, describe: describe };
})();
