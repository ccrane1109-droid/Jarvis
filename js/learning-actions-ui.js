/* ==========================================================================
   JARVIS — Learning & Research Hub: Actions (Notes tab). Each action is something you learned that you mean to do:
   the lesson, where you learned it, how you'll put it into practice, an optional target date, and where it stands.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;

  // Where the action came from, in words, with a link when the thing still exists.
  function sourceHtml(a) {
    if (a.sourceType === "book") { const b = store.get("books", a.sourceId); return b ? '<button type="button" class="ln-link-btn" data-go="books" data-id="' + esc(b.id) + '">' + esc(b.title) + '</button>' : "a book that was removed"; }
    if (a.sourceType === "research") { const r = store.get("research", a.sourceId); return r ? '<button type="button" class="ln-link-btn" data-go="research" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button>' : "a research project that was removed"; }
    if (a.sourceType === "note") { const n = store.get("notes", a.sourceId); return n ? '<button type="button" class="ln-link-btn" data-go="knowledge" data-open-note="' + esc(n.id) + '">' + esc(A.snippet(n.title || n.text, 50)) + '</button>' : "a note that was removed"; }
    if (a.sourceType === "other" && a.sourceLabel) return esc(a.sourceLabel);
    return "";
  }

  function actionRow(a) {
    const today = store.today(), overdue = !!(a.targetDate && a.status !== "done" && a.targetDate < today);
    const src = sourceHtml(a);
    const sel = '<label class="visually-hidden" for="lnas_' + esc(a.id) + '">Status of this action</label><select id="lnas_' + esc(a.id) + '" class="ln-status-sel" data-status-action data-id="' + esc(a.id) + '">' +
      L.ACTION_STATUS.map(function (s) { return '<option value="' + s.key + '"' + (a.status === s.key ? " selected" : "") + '>' + esc(s.label) + '</option>'; }).join("") + '</select>';
    return '<div class="ln-action" id="lnact_' + esc(a.id) + '"><div class="ln-action-main"><p class="ln-item-title">' + esc(a.lesson) + '</p>' +
      '<div class="ln-badges">' +
      (a.targetDate && a.status !== "done" ? (overdue ? A.badge("red", "Overdue · " + A.fmtShort(a.targetDate)) : A.badge("neutral", "Due " + A.fmtShort(a.targetDate))) : "") +
      (a.status === "done" && a.implementedAt ? A.badge("green", "Implemented " + A.fmtShort(a.implementedAt)) : "") + '</div>' +
      (src ? '<p class="ln-links ln-item-sub">Learned from: ' + src + '</p>' : "") +
      (a.plan ? '<p class="ln-text"><span class="ln-item-sub">How I’ll do it:</span> ' + esc(a.plan) + '</p>' : "") + '</div>' +
      '<div class="ln-action-btns">' + sel +
      '<button type="button" class="ln-link-btn" data-act="action-edit" data-id="' + esc(a.id) + '" aria-label="Edit action">Edit</button>' +
      '<button type="button" class="ln-link-btn ln-danger" data-act="action-delete" data-id="' + esc(a.id) + '" aria-label="Delete action">Delete</button></div></div>';
  }

  /* ---------------- the editor ---------------- */

  function editAction(action, preset) {
    const isNew = !action, p = preset || {};
    const a = action || { lesson: p.lesson || "", plan: "", sourceType: p.sourceType || "none", sourceId: p.sourceId || "", sourceLabel: p.label && p.sourceType === "other" ? p.label : "", targetDate: "", status: "todo" };
    const books = store.list("books"), research = store.list("research"), notes = store.list("notes");
    const sel = function (name, label, items, cur, text) {
      return '<div class="form-row ln-src-row" data-src="' + name + '" hidden><label for="lnf_src_' + name + '">' + label + '</label><select id="lnf_src_' + name + '" name="src_' + name + '">' +
        '<option value="">Choose…</option>' + items.map(function (i) { return '<option value="' + esc(i.id) + '"' + (cur === i.id ? " selected" : "") + '>' + esc(text(i)) + '</option>'; }).join("") + '</select><p class="ln-err hidden" data-err="src_' + name + '" role="alert"></p></div>';
    };
    const srcTypes = [["none", "Not specified"]].concat(books.length ? [["book", "A book"]] : [], research.length ? [["research", "A research project"]] : [], notes.length ? [["note", "A note"]] : [], [["other", "Somewhere else"]]);
    if (srcTypes.every(function (t) { return t[0] !== a.sourceType; })) a.sourceType = "none";
    const body =
      A.fArea("lesson", "Lesson or idea", a.lesson, { rows: 3, max: 500, required: true, placeholder: "What did you learn that you want to act on?" }) +
      A.fSelect("sourceType", "Where did you learn it?", srcTypes, a.sourceType, {}) +
      sel("book", "Book", books, a.sourceId, function (i) { return i.title; }) + sel("research", "Research project", research, a.sourceId, function (i) { return i.title; }) +
      sel("note", "Note", notes, a.sourceId, function (i) { return A.snippet(i.title || i.text, 70); }) +
      '<div class="form-row ln-src-row" data-src="other" hidden><label for="lnf_sourceLabel">Where</label><input type="text" id="lnf_sourceLabel" name="sourceLabel" maxlength="200" value="' + esc(a.sourceLabel) + '" placeholder="A podcast, a conversation, a course…" autocomplete="off"></div>' +
      A.fArea("plan", "How will you implement it?", a.plan, { rows: 3, max: 2000, placeholder: "The first concrete step you’ll take" }) +
      '<div class="ln-two">' + A.fText("targetDate", "Target date (optional)", a.targetDate, { type: "date" }) + A.fSelect("status", "Status", A.opts(L.ACTION_STATUS), a.status, { required: true }) + '</div>';
    function sync(el) {
      const t = el.querySelector("#lnf_sourceType").value;
      Array.prototype.forEach.call(el.querySelectorAll(".ln-src-row"), function (r) { r.hidden = r.getAttribute("data-src") !== t; });
    }
    A.openSheet({
      title: isNew ? "Add an action" : "Edit action", body: body, submit: isNew ? "Save action" : "Save changes", focus: "#lnf_lesson",
      onOpen: sync,
      onChange: function (t, el) { if (t.id === "lnf_sourceType") sync(el); },
      onSubmit: function (v) {
        const t = v.sourceType;
        const input = { lesson: v.lesson, plan: v.plan, sourceType: t, sourceId: t === "book" || t === "research" || t === "note" ? v["src_" + t] : "", sourceLabel: v.sourceLabel, targetDate: v.targetDate, status: v.status, implementedAt: action ? action.implementedAt : "" };
        const r = L.checkAction(input, { today: store.today(), books: books, research: research, notes: notes });
        if (!r.ok) {
          const errors = Object.assign({}, r.errors);
          if (errors.sourceId) { errors["src_" + t] = errors.sourceId; delete errors.sourceId; }
          return { ok: false, errors: errors };
        }
        const saved = isNew ? store.add("actions", r.value) : store.put("actions", Object.assign({}, action, r.value));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(isNew ? "Action saved." : "Action updated.");
        if (isNew) A.notice("Action saved.", "");
        return { ok: true };
      }
    });
  }

  function actionClick(act, el) {
    const id = el.getAttribute("data-id");
    if (act === "action-edit") { const a = store.get("actions", id); if (a) editAction(a); return true; }
    if (act === "action-delete") {
      if (!store.remove("actions", id)) { A.saveFailed(); return true; }
      A.notice("Action deleted.", "Undo", function () { store.undoRemove("actions", id); });
      return true;
    }
    return false;
  }

  /* ---------------- the list ---------------- */

  function results() {
    const S = store.state(), f = A.state.filters.actions;
    const list = L.filterActions(S.actions, S, f);
    if (!list.length) {
      return L.live(S.actions).length
        ? '<p class="empty-state">No actions match. <button type="button" class="btn-icon" data-act="clear-filters">Clear filters</button></p>'
        : '<div class="empty-state"><p>No actions yet.</p><p class="field-hint">Reading only helps if something changes. Write down one thing you’ll do differently, and where you learned it.</p><button type="button" class="btn btn-primary" data-act="add-action-new">Add your first action</button></div>';
    }
    return '<div class="ln-list">' + list.map(actionRow).join("") + '</div>';
  }
  function count() {
    const S = store.state(), n = L.filterActions(S.actions, S, A.state.filters.actions).length, total = L.live(S.actions).length;
    return n === total ? A.plural(total, "action") : n + " of " + total + " actions";
  }
  function view() {
    const live = L.live(store.state().actions), f = A.state.filters.actions;
    const c = { todo: 0, doing: 0, done: 0 };
    live.forEach(function (a) { c[a.status] = (c[a.status] || 0) + 1; });
    const chip = function (v, label, n) {
      return '<button type="button" class="ln-pill" data-act="action-filter" data-v="' + v + '" aria-pressed="' + ((f.status || "") === v) + '">' + esc(label) + ' <span class="ln-pill-n">' + n + '</span></button>';
    };
    return A.notesSeg("actions") + '<h2 class="visually-hidden" data-focus-top>Actions</h2>' +
      '<div class="ln-pills ln-pills-filter" role="group" aria-label="Show actions">' + chip("", "All", live.length) + chip("todo", "To do", c.todo) + chip("doing", "In progress", c.doing) + chip("done", "Done", c.done) + '</div>' +
      A.toolbar("actions", [
        { name: "q", kind: "search", label: "Search actions", placeholder: "Search lessons and plans" },
        { name: "sort", kind: "select", label: "Sort actions", options: [["date", "Target date"], ["newest", "Newest first"], ["status", "By status"]] }
      ], { fold: 1 }) + '<p class="ln-count" id="lnResultCount" aria-live="polite">' + esc(count()) + '</p><div id="lnResults">' + results() + '</div>';
  }

  A.register("actions", {
    html: view,
    results: results,
    count: count,
    click: function (act, el) {
      if (act === "add-action-new") editAction(null, {});
      else if (act === "action-filter") { A.state.filters.actions = Object.assign({}, A.state.filters.actions, { status: el.getAttribute("data-v") }); A.render(); }
    }
  });
  A.quickAdd.action = function () { editAction(null, {}); };
  A.actionRow = actionRow;
  A.editAction = editAction;
  A.actionClick = actionClick;
})();
