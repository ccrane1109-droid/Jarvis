/* ==========================================================================
   JARVIS — Learning & Research Hub: the Weekly Learning Review (optional).
   Every figure is worked out from the records for that week (see weeklyReview in learning-logic.js and learning-weekly-logic.js).
   The four written boxes are the only things typed in, and they are saved per week so earlier weeks can be read and compared.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc, W = window.JarvisLearningWeekly, RD = window.JarvisLearningReading;

  function currentWeek() { return L.weekStart(store.today()); }
  function week() {
    if (!A.state.week || !L.isDate(A.state.week)) A.state.week = currentWeek();
    return A.state.week;
  }
  function range(w) { return A.fmtShort(w) + " – " + A.fmtDate(L.addDays(w, 6)); }

  function item(html) { return '<li class="ln-rv-item">' + html + '</li>'; }
  function goBtn(tab, id, text) { return '<button type="button" class="ln-link-btn" data-go="' + tab + '" data-id="' + esc(id) + '">' + esc(text) + '</button>'; }

  function box(id, name, label, sv, rows, max, fk) {
    return '<div class="form-row"><label for="' + id + '">' + esc(label) + '</label><textarea id="' + id + '" name="' + name + '" rows="' + rows + '" maxlength="' + max + '" data-fk="' + fk + '">' + esc(sv ? sv[name] : "") + '</textarea></div>';
  }
  function tileHtml(n, label, sub) { return '<div class="ln-tile"><span class="ln-tile-n">' + esc(n) + '</span><span class="ln-tile-l">' + esc(label) + '</span>' + (sub ? '<span class="ln-tile-s">' + esc(sub) + '</span>' : "") + '</div>'; }

  // Every figure counted from the records of that week.
  function glance(SUM) {
    const f = SUM.figures;
    return '<section class="card ln-card" aria-labelledby="lnRvNow"><div class="card-title-row"><h2 class="card-title" id="lnRvNow">The week in numbers</h2></div><div class="ln-tiles">' +
      tileHtml(String(f.pages), "Pages read") + tileHtml(String(f.minutes), "Minutes read") + tileHtml(String(f.books), "Books finished") +
      tileHtml(String(f.research), "Research completed") + tileHtml(String(f.lessons), "Lessons reviewed") +
      tileHtml(f.cardsPct === null ? "–" : f.cardsPct + "%", "Flashcards recalled", f.cards ? A.plural(f.cards, "answer") : "no answers") +
      tileHtml(String(f.goals), "Goals achieved") + tileHtml(String(f.ideas), "Ideas implemented") + '</div>' +
      '<p class="field-hint">Counted from your records. Nothing here is typed in or estimated.</p></section>';
  }

  function changeHtml(r) {
    if (r.dir === "none") return '<span class="ln-item-sub">–</span><span class="visually-hidden"> no comparison</span>';
    if (r.dir === "same") return 'same';
    const n = Math.abs(r.change);
    return (r.dir === "up" ? '<span aria-hidden="true">↑</span><span class="visually-hidden">up </span>' : '<span aria-hidden="true">↓</span><span class="visually-hidden">down </span>') + n + (r.unit === "%" ? " pts" : "");
  }
  function valueText(r, v) { return v === null || v === undefined ? "–" : v + (r.unit === "%" ? "%" : ""); }
  function compareCard(S, w, today, SUM) {
    const prevWeek = L.addDays(w, -7), prev = W.summary(S, prevWeek, today);
    let h = '<section class="card ln-card" aria-labelledby="lnRvCmp"><div class="card-title-row"><h2 class="card-title" id="lnRvCmp">Compared with the week before</h2></div>';
    if (prev.empty) return h + '<p class="empty-state-compact">Nothing was recorded the week before (' + esc(range(prevWeek)) + '), so there is nothing to compare with.</p></section>';
    const rows = W.compare(SUM, prev);
    h += '<table class="ln-cmp"><caption class="visually-hidden">This week against the week of ' + esc(A.fmtDate(prevWeek)) + '</caption><thead><tr><th scope="col"><span class="visually-hidden">Measure</span></th><th scope="col">This week</th><th scope="col">Before</th><th scope="col">Change</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><th scope="row">' + esc(r.label) + '</th><td>' + esc(valueText(r, r.now)) + '</td><td>' + esc(valueText(r, r.before)) + '</td><td>' + changeHtml(r) + '</td></tr>'; }).join("") + '</tbody></table>';
    return h + '<p class="field-hint">Compared with ' + esc(range(prevWeek)) + '. Figures are recounted from your records, so they always match what is stored.</p></section>';
  }

  function studyCard(SUM) {
    const f = SUM.figures;
    let h = '<section class="card ln-card" aria-labelledby="lnRvStudy"><div class="card-title-row"><h2 class="card-title" id="lnRvStudy">Reviews and flashcards</h2><button type="button" class="btn-icon" data-go="study">Study</button></div>';
    h += '<p class="ln-big">' + A.plural(f.lessons, "lesson") + ' reviewed</p>';
    if (f.cards) h += '<p class="ln-item-sub">' + esc(A.plural(f.cards, "flashcard answer") + " · recalled " + f.cardsPct + "%" + (f.cardsPractice ? " · " + f.cardsPractice + " of them practice" : "")) + '</p>';
    else h += '<p class="empty-state-compact">No flashcards were answered this week.</p>';
    return h + '<p class="field-hint">Lessons reviewed counts scheduled reviews. Flashcard answers include practice sessions; a card counts as recalled when you answered Easy, Good or Hard.</p></section>';
  }
  function goalsCard(SUM) {
    let h = '<section class="card ln-card" aria-labelledby="lnRvGoals"><div class="card-title-row"><h2 class="card-title" id="lnRvGoals">Goals achieved</h2><button type="button" class="btn-icon" data-go="goals">All goals</button></div>';
    if (!SUM.goals.length) return h + '<p class="empty-state-compact">No goal target was reached this week.</p></section>';
    return h + '<ul class="ln-rv-list">' + SUM.goals.map(function (x) { return item('<button type="button" class="ln-link-btn ln-link-block" data-go="goals">' + esc(x.goal.title || "") + '</button><span class="ln-item-sub">Reached ' + esc(A.fmtShort(x.on)) + '</span>'); }).join("") + '</ul></section>';
  }

  function pastCard(S, w) {
    const past = W.pastReviews(S, 12).filter(function (p) { return p.week !== w; });
    if (!past.length) return "";
    return '<details class="ln-more card ln-card" data-keep="rv_past"' + (A.state.open.rv_past ? " open" : "") + '><summary>Earlier reviews (' + past.length + ')</summary><ul class="ln-rv-list">' + past.map(function (p) {
      const r = p.review, first = r.reflection || r.struggled || r.applied || r.focusNext;
      return item('<button type="button" class="ln-link-btn ln-link-block" data-act="week-go" data-w="' + esc(p.week) + '">' + esc(range(p.week)) + '</button><span class="ln-item-sub">' + esc(A.plural(p.boxes, "box", "boxes") + " written · " + A.snippet(first, 90)) + '</span>');
    }).join("") + '</ul></details>';
  }

  function view() {
    const S = store.state(), today = store.today(), w = week(), cur = currentWeek();
    const R = L.weeklyReview(S, w, today);
    const SUM = W ? W.summary(S, w, today) : null;
    const isCurrent = w === cur;
    let h = '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Weekly review</h2></div>' +
      '<div class="ln-weeknav" role="group" aria-label="Choose a week"><button type="button" class="btn btn-secondary" data-act="week-prev">← Earlier</button>' +
      '<div class="ln-weeklabel" aria-live="polite"><strong>' + esc(range(w)) + '</strong><span class="ln-item-sub">' + (isCurrent ? "This week" : A.plural(Math.round(L.diffDays(w, cur) / 7), "week") + " ago") + '</span></div>' +
      '<button type="button" class="btn btn-secondary" data-act="week-next"' + (isCurrent ? ' aria-disabled="true"' : "") + '>Later →</button></div>' +
      (isCurrent ? "" : '<p><button type="button" class="btn-icon" data-act="week-now">Back to this week</button></p>');

    if (SUM ? SUM.empty : R.empty) h += '<p class="ln-note-empty">Nothing is recorded for this week yet: no page updates, notes, research or actions. The review fills in as you use the other sections.</p>';
    if (SUM) h += glance(SUM) + compareCard(S, w, today, SUM);

    // Reading
    h += '<section class="card ln-card" aria-labelledby="lnRvRead"><div class="card-title-row"><h2 class="card-title" id="lnRvRead">Reading progress</h2></div>';
    h += '<p class="ln-big">' + A.plural(R.reading.pages, "page") + ' read</p>';
    if (SUM && SUM.figures.minutes) h += '<p class="ln-item-sub">' + esc(RD ? RD.minutesText(SUM.figures.minutes) : SUM.figures.minutes + " min") + ' of reading time saved.</p>';
    if (R.reading.perBook.length) h += '<ul class="ln-rv-list">' + R.reading.perBook.map(function (x) { return item(goBtn("books", x.id, x.title) + ' <span class="ln-item-sub">' + A.plural(x.pages, "page") + '</span>'); }).join("") + '</ul>';
    else h += '<p class="empty-state-compact">No page updates were logged this week' + (store.list("books").length ? "." : ", and there are no books yet.") + '</p>';
    if (R.reading.finished.length) h += '<h3 class="ln-h3">Finished</h3><ul class="ln-rv-list">' + R.reading.finished.map(function (b) { return item(goBtn("books", b.id, b.title) + (b.rating ? " " + A.starsHtml(b.rating) : "")); }).join("") + '</ul>';
    if (R.reading.started.length) h += '<h3 class="ln-h3">Started</h3><ul class="ln-rv-list">' + R.reading.started.map(function (b) { return item(goBtn("books", b.id, b.title)); }).join("") + '</ul>';
    if (isCurrent) {
      const now = L.currentBooks(S);
      if (now.length) h += '<h3 class="ln-h3">Where your books are now</h3><ul class="ln-rv-list">' + now.map(function (b) { return item(goBtn("books", b.id, b.title) + ' <span class="ln-item-sub">' + esc(A.progressText(b) || "no page logged") + '</span>' + A.barHtml(L.progress(b), b.title + ": " + L.progress(b) + "%")); }).join("") + '</ul>';
    }
    h += '<p class="field-hint">Pages are counted from the page updates you log. Pages before a book’s first update, and days without an update, aren’t counted.</p></section>';

    // Research
    h += '<section class="card ln-card" aria-labelledby="lnRvRes"><div class="card-title-row"><h2 class="card-title" id="lnRvRes">Research</h2></div>';
    h += '<p class="ln-big">' + A.plural(R.research.completed.length, "project") + ' completed</p>';
    if (R.research.completed.length) h += '<ul class="ln-rv-list">' + R.research.completed.map(function (r) { return item(goBtn("research", r.id, r.title)); }).join("") + '</ul>';
    h += '<p class="ln-item-sub">' + esc(A.plural(R.research.findingsAdded, "finding") + " recorded · " + A.plural(R.research.sourcesAdded, "source") + " added") + '</p></section>';

    // Lessons
    const seen = {}, lessons = [];
    R.lessons.starred.concat(R.lessons.takeaways).forEach(function (n) { if (!seen[n.id]) { seen[n.id] = true; lessons.push(n); } });
    h += '<section class="card ln-card" aria-labelledby="lnRvLes"><div class="card-title-row"><h2 class="card-title" id="lnRvLes">Most important lessons</h2></div>';
    h += lessons.length ? '<ul class="ln-rv-list">' + lessons.slice(0, 8).map(function (n) {
      return item('<button type="button" class="ln-link-btn ln-link-block" data-go="knowledge" data-open-note="' + esc(n.id) + '">' + (n.important ? "★ " : "") + esc(A.snippet(n.title || n.text, 140)) + '</button>');
    }).join("") + '</ul><p class="field-hint">Notes you starred this week, then takeaways you recorded.</p>'
      : '<p class="empty-state-compact">No starred notes or takeaways this week. Star the notes that matter most and they appear here.</p>';
    h += '</section>';

    // Implemented
    h += '<section class="card ln-card" aria-labelledby="lnRvImp"><div class="card-title-row"><h2 class="card-title" id="lnRvImp">Ideas implemented</h2></div>';
    h += '<p class="ln-big">' + R.implemented.length + '</p>' + (R.implemented.length ? '<ul class="ln-rv-list">' + R.implemented.map(function (a) { return item(esc(A.snippet(a.lesson, 140))); }).join("") + '</ul>' : '<p class="empty-state-compact">No action was marked Implemented this week.</p>') + '</section>';

    if (SUM) h += studyCard(SUM) + goalsCard(SUM);

    // Focus
    h += '<section class="card ln-card" aria-labelledby="lnRvFocus"><div class="card-title-row"><h2 class="card-title" id="lnRvFocus">What to focus on next</h2></div>';
    h += R.focus.length ? '<ul class="ln-rv-list">' + R.focus.map(function (f) {
      const tab = f.kind === "action" ? "actions" : f.kind === "book" ? "books" : "research";
      return item('<button type="button" class="ln-link-btn ln-link-block" data-go="' + tab + '"' + (f.kind === "action" ? "" : ' data-id="' + esc(f.id) + '"') + '>' + esc(A.snippet(f.title, 120)) + '</button><span class="ln-item-sub">' + esc(f.reason) + '</span>');
    }).join("") + '</ul><p class="field-hint">Suggested from your records: overdue and upcoming actions, books you haven’t updated in a week, and high-priority research.</p>'
      : '<p class="empty-state-compact">Nothing needs attention right now.</p>';
    h += '</section>';

    // The user's own words
    const sv = R.saved, last = W ? W.lastIntention(S, w) : null;
    h += '<section class="card ln-card" aria-labelledby="lnRvMine"><div class="card-title-row"><h2 class="card-title" id="lnRvMine">My reflection</h2></div>' +
      (last ? '<p class="ln-intent"><span class="ln-item-sub">Last week you wanted to improve</span><br>' + esc(last.text) + '</p>' : "") +
      '<form data-form="review" data-week="' + esc(w) + '" novalidate>' +
      box("lnRvRef", "reflection", "What was your biggest lesson this week?", sv, 4, 5000, "rv_ref") +
      box("lnRvStruggled", "struggled", "What did you struggle to understand?", sv, 3, 5000, "rv_struggled") +
      box("lnRvApplied", "applied", "What did you apply in real life?", sv, 3, 5000, "rv_applied") +
      box("lnRvNext", "focusNext", "What do you want to improve next week?", sv, 3, 2000, "rv_next") +
      '<button type="submit" class="btn btn-primary">Save my reflection</button>' + (sv ? '<span class="ln-item-sub ln-saved">Saved ' + esc(A.fmtDate(L.localDate(sv.updatedAt))) + '</span>' : "") +
      '<p class="ln-err hidden" data-err="weekStart" role="alert"></p></form></section>';
    if (W) h += pastCard(S, w);
    return h;
  }

  function saveReview(form) {
    const w = form.getAttribute("data-week");
    const r = L.checkReview({ weekStart: w, reflection: form.elements.reflection.value, struggled: form.elements.struggled.value, applied: form.elements.applied.value, focusNext: form.elements.focusNext.value });
    if (!r.ok) { A.showErrors(form, r.errors); return; }
    const existing = store.all("reviews").filter(function (x) { return x.weekStart === w; })[0];
    let saved;
    if (existing) saved = store.put("reviews", Object.assign({}, L.restore(existing, Date.now()), r.value));
    else saved = store.add("reviews", r.value, { id: "wk_" + w });
    if (!saved) { A.saveFailed(); return; }
    A.notice("Reflection saved.", "");
  }

  A.register("review", {
    html: view,
    click: function (act, el) {
      if (act === "week-prev") { A.state.week = L.addDays(week(), -7); A.render(); }
      else if (act === "week-next") { if (week() < currentWeek()) { A.state.week = L.addDays(week(), 7); A.render(); } }
      else if (act === "week-now") { A.state.week = currentWeek(); A.render(); }
      else if (act === "week-go") { const t = el.getAttribute("data-w"); if (L.isDate(t)) { A.state.week = t; A.render(); window.scrollTo(0, 0); } }
    },
    submit: function (form) { if (form.getAttribute("data-form") === "review") saveReview(form); }
  });
})();
