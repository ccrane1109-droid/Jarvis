/* ==========================================================================
   JARVIS — Learning & Research Hub: the Weekly Learning Review (optional).
   Every figure is worked out from the records for that week (see weeklyReview in learning-logic.js). Your own
   reflection and your focus for next week are the only things typed in, and they are saved per week.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;

  function currentWeek() { return L.weekStart(store.today()); }
  function week() {
    if (!A.state.week || !L.isDate(A.state.week)) A.state.week = currentWeek();
    return A.state.week;
  }
  function range(w) { return A.fmtShort(w) + " – " + A.fmtDate(L.addDays(w, 6)); }

  function item(html) { return '<li class="ln-rv-item">' + html + '</li>'; }
  function goBtn(tab, id, text) { return '<button type="button" class="ln-link-btn" data-go="' + tab + '" data-id="' + esc(id) + '">' + esc(text) + '</button>'; }

  function view() {
    const S = store.state(), today = store.today(), w = week(), cur = currentWeek();
    const R = L.weeklyReview(S, w, today);
    const isCurrent = w === cur;
    let h = '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Weekly review</h2></div>' +
      '<div class="ln-weeknav" role="group" aria-label="Choose a week"><button type="button" class="btn btn-secondary" data-act="week-prev">← Earlier</button>' +
      '<div class="ln-weeklabel" aria-live="polite"><strong>' + esc(range(w)) + '</strong><span class="ln-item-sub">' + (isCurrent ? "This week" : A.plural(Math.round(L.diffDays(w, cur) / 7), "week") + " ago") + '</span></div>' +
      '<button type="button" class="btn btn-secondary" data-act="week-next"' + (isCurrent ? ' aria-disabled="true"' : "") + '>Later →</button></div>' +
      (isCurrent ? "" : '<p><button type="button" class="btn-icon" data-act="week-now">Back to this week</button></p>');

    if (R.empty) h += '<p class="ln-note-empty">Nothing is recorded for this week yet: no page updates, notes, research or actions. The review fills in as you use the other sections.</p>';

    // Reading
    h += '<section class="card ln-card" aria-labelledby="lnRvRead"><div class="card-title-row"><h2 class="card-title" id="lnRvRead">Reading progress</h2></div>';
    h += '<p class="ln-big">' + A.plural(R.reading.pages, "page") + ' read</p>';
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

    // Focus
    h += '<section class="card ln-card" aria-labelledby="lnRvFocus"><div class="card-title-row"><h2 class="card-title" id="lnRvFocus">What to focus on next</h2></div>';
    h += R.focus.length ? '<ul class="ln-rv-list">' + R.focus.map(function (f) {
      const tab = f.kind === "action" ? "actions" : f.kind === "book" ? "books" : "research";
      return item('<button type="button" class="ln-link-btn ln-link-block" data-go="' + tab + '"' + (f.kind === "action" ? "" : ' data-id="' + esc(f.id) + '"') + '>' + esc(A.snippet(f.title, 120)) + '</button><span class="ln-item-sub">' + esc(f.reason) + '</span>');
    }).join("") + '</ul><p class="field-hint">Suggested from your records: overdue and upcoming actions, books you haven’t updated in a week, and high-priority research.</p>'
      : '<p class="empty-state-compact">Nothing needs attention right now.</p>';
    h += '</section>';

    // The user's own words
    const sv = R.saved;
    h += '<section class="card ln-card" aria-labelledby="lnRvMine"><div class="card-title-row"><h2 class="card-title" id="lnRvMine">My reflection</h2></div>' +
      '<form data-form="review" data-week="' + esc(w) + '" novalidate>' +
      '<div class="form-row"><label for="lnRvRef">What did you learn this week?</label><textarea id="lnRvRef" name="reflection" rows="4" maxlength="5000" data-fk="rv_ref">' + esc(sv ? sv.reflection : "") + '</textarea></div>' +
      '<div class="form-row"><label for="lnRvNext">What will you focus on next week?</label><textarea id="lnRvNext" name="focusNext" rows="3" maxlength="2000" data-fk="rv_next">' + esc(sv ? sv.focusNext : "") + '</textarea></div>' +
      '<button type="submit" class="btn btn-primary">Save my reflection</button>' + (sv ? '<span class="ln-item-sub ln-saved">Saved ' + esc(A.fmtDate(L.localDate(sv.updatedAt))) + '</span>' : "") +
      '<p class="ln-err hidden" data-err="weekStart" role="alert"></p></form></section>';
    return h;
  }

  function saveReview(form) {
    const w = form.getAttribute("data-week");
    const r = L.checkReview({ weekStart: w, reflection: form.elements.reflection.value, focusNext: form.elements.focusNext.value });
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
    },
    submit: function (form) { if (form.getAttribute("data-form") === "review") saveReview(form); }
  });
})();
