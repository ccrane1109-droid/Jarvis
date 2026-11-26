/* ==========================================================================
   JARVIS — Planning sync screens: "this looks like something you already have" and "Review possible duplicates".

   The rules are in planning-core-logic.js and the saving is in habits.js (JarvisHabits.duplicateCheck / duplicateScan / linkTaskToHabit ...).
   This file only asks you and shows you:

   * A form that makes a new task or habit asks while you type: when the name (and day, and time) looks like something you already have, a choice
     appears and the form cannot be saved until you pick one (link it, keep the one you have, or add it as a separate item on purpose).
   * "Review possible duplicates" lists pairs that are already saved. Nothing is linked, merged or deleted unless you press the button, and every
     change in the list can be undone.
   ========================================================================== */

(function () {
  "use strict";

  const PC = window.JarvisPlanningCore;
  const state = { undo: null, msg: "" };

  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === undefined || s === null ? "" : s)); }
  function H() { return window.JarvisHabits; }
  function timeText(t) { if (!/^\d\d:\d\d$/.test(t || "")) return ""; const h = Number(t.slice(0, 2)); return ((h + 11) % 12 + 1) + ":" + t.slice(3) + (h < 12 ? " AM" : " PM"); }
  function dateText(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return ""; return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8))).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }
  function whenText(date, time) { return [dateText(date), timeText(time)].filter(Boolean).join(" at "); }

  /* ---------------- while typing ---------------- */

  // The choices for something new that looks like something you already have. value "" = not chosen yet.
  function choices(cand, found) {
    const out = [{ value: "", label: "Choose how to add it…" }];
    const habit = found.filter(function (f) { return f.type === "habit"; })[0];
    const other = found.filter(function (f) { return f.type === "task" || f.type === "event"; })[0];
    if (cand.type === "task" && habit) out.push({ value: "link:" + habit.id, label: "Link it to the habit “" + habit.name + "” (one tick does both)" });
    if (cand.type === "habit") {
      const n = found.filter(function (f) { return f.type === "task"; }).length, same = found.filter(function (f) { return f.type === "habit"; })[0];
      if (same) out.push({ value: "existing", label: "Don’t add it: keep my habit “" + same.name + "”" });
      if (n) out.push({ value: "linkall", label: "Link the " + n + " task" + (n === 1 ? "" : "s") + " with this name to the habit" });
    } else if (other) out.push({ value: "existing", label: "Don’t add it: keep my " + (other.type === "event" ? "event" : "task") + " “" + other.name + "”" });
    out.push({ value: "separate", label: "Add it as a separate item (don’t suggest again)" });
    return out;
  }
  function noteText(cand, found) {
    const top = found[0];
    if (cand.type === "habit" && top.type === "habit") return "You already have a habit named “" + top.name + "”. A second one would split its history in two.";
    if (cand.type === "habit") return "You have " + found.length + " task" + (found.length === 1 ? "" : "s") + " with this name coming up (" + found.slice(0, 3).map(function (f) { return dateText(f.date); }).join(", ") + (found.length > 3 ? "…" : "") + ").";
    return top.type === "habit" ? "This looks like your habit “" + top.name + "” on this day" + (top.time ? " at " + timeText(top.time) : "") + "."
      : "This looks like your " + (top.type === "event" ? "calendar event" : "task") + " “" + top.name + "” (" + whenText(top.date, top.time) + ").";
  }

  // Looks for duplicates of cand and shows the choice in the given elements (or hides them). Returns what was found.
  // els: { row, select, note }; the select keeps what you chose if it is still offered.
  function fill(els, cand) {
    let found = [];
    try { if (H() && H().duplicateCheck) found = H().duplicateCheck(cand); } catch (e) { found = []; }
    const row = els.row, sel = els.select;
    if (!row || !sel) return found;
    if (!found.length) { row.classList.add("hidden"); sel.innerHTML = ""; sel.removeAttribute("aria-required"); return found; }
    const keep = sel.value, list = choices(cand, found);
    sel.innerHTML = list.map(function (c) { return '<option value="' + esc(c.value) + '">' + esc(c.label) + '</option>'; }).join("");
    if (list.some(function (c) { return c.value === keep; })) sel.value = keep;
    sel.setAttribute("aria-required", "true");
    if (els.note) els.note.textContent = noteText(cand, found);
    row.classList.remove("hidden");
    return found;
  }

  // What the choice means. null when a choice is needed and has not been made.
  function decide(els, found) {
    if (!found.length) return { action: "create" };
    const v = els.select ? els.select.value : "";
    if (!v) return null;
    if (v.indexOf("link:") === 0) return { action: "link", habitId: v.slice(5) };
    if (v === "linkall") return { action: "linkall", ids: found.filter(function (f) { return f.type === "task"; }).map(function (f) { return f.id; }) };
    if (v === "existing") return { action: "existing" };
    return { action: "separate", ids: found.map(function (f) { return f.id; }) };
  }

  /* ---------------- Review possible duplicates ---------------- */

  function sheetApp() { return window.JarvisPlanApp && window.JarvisPlanApp.openSheet ? window.JarvisPlanApp : null; }
  function scan() { try { return H() && H().duplicateScan ? H().duplicateScan() : []; } catch (e) { return []; } }
  function count() { return scan().length; }

  function cardHtml(s, i) {
    const t = function (x) { return '<strong>' + esc(x.text || x.title || x.name) + '</strong>'; };
    let body, acts;
    if (s.kind === "task-habit") {
      body = '<p class="pc-line">Task ' + t(s.task) + (s.task.time ? ' at ' + esc(timeText(s.task.time)) : '') + ' and habit ' + t(s.habit) + (s.habit.time ? ' at ' + esc(timeText(s.habit.time)) : '') + ' are both on ' + esc(dateText(s.date)) + '.</p>';
      acts = '<button type="button" class="btn btn-primary" data-sheet-act="dup-link" data-i="' + i + '">Link them</button><button type="button" class="btn btn-secondary" data-sheet-act="dup-sep" data-i="' + i + '">Keep separate</button>';
    } else if (s.kind === "task-task") {
      body = '<p class="pc-line">Two tasks named ' + t(s.a) + ' on ' + esc(dateText(s.date)) + (s.a.time || s.b.time ? ' (' + esc([s.a.time, s.b.time].filter(Boolean).map(timeText).join(" and ")) + ')' : '') + '.</p>';
      acts = '<button type="button" class="btn btn-primary" data-sheet-act="dup-merge" data-i="' + i + '">Merge into one</button><button type="button" class="btn btn-secondary" data-sheet-act="dup-sep" data-i="' + i + '">Keep both</button>';
    } else {
      body = '<p class="pc-line">Task ' + t(s.task) + ' and the calendar event ' + t(s.event) + ' are both on ' + esc(dateText(s.date)) + '.</p>';
      acts = '<button type="button" class="btn btn-secondary" data-sheet-act="dup-sep" data-i="' + i + '">Keep both</button><button type="button" class="btn btn-secondary" data-sheet-act="dup-del" data-i="' + i + '">Delete the task</button>';
    }
    return '<li class="pc-card">' + body + '<div class="pc-acts">' + acts + '</div></li>';
  }

  function listHtml(list) {
    if (!list.length) return '<p class="field-hint">Nothing looks duplicated in the week just gone and the next 60 days.</p>';
    return '<ul class="pc-list">' + list.map(cardHtml).join("") + '</ul>';
  }

  function openReview(opener) {
    const A = sheetApp();
    if (!A) { core().showToast("The review isn't available right now."); return; }
    let list = scan();
    state.undo = null; state.msg = "";
    const draw = function (root) {
      const box = root.querySelector("#pcBox");
      if (!box) return;
      box.innerHTML = (state.msg ? '<p class="pc-msg" role="status">' + esc(state.msg) + (state.undo ? ' <button type="button" class="btn-icon" data-sheet-act="dup-undo">Undo</button>' : '') + '</p>' : '') + listHtml(list);
    };
    const refresh = function (root, msg, undo) { state.msg = msg || ""; state.undo = undo || null; list = scan(); draw(root); };
    A.openSheet({
      title: "Possible duplicates",
      body: '<p class="field-hint">Things that look like the same activity entered twice. Nothing is linked, merged or deleted unless you press a button here, and each change can be undone.</p><div id="pcBox" aria-live="polite"></div>',
      onOpen: draw,
      onAct: function (act, el, root) {
        if (act === "dup-undo") { const u = state.undo; if (u) u(); refresh(root, "Undone.", null); return; }
        const s = list[Number(el.getAttribute("data-i"))];
        if (!s) return;
        const h = H();
        if (act === "dup-link") {
          const prev = h.getTasks().map(function (x) { return Object.assign({}, x); }), r = h.linkTaskToHabit(s.task.id, s.habit.id);
          refresh(root, r.ok ? "Linked. Ticking either one now ticks both." : r.error, r.ok ? function () { h.commitTasks(prev); } : null);
        } else if (act === "dup-sep") {
          const a = s.kind === "task-task" ? s.a.id : s.task.id, b = s.kind === "task-task" ? s.b.id : s.kind === "task-habit" ? s.habit.id : s.event.id;
          const prev = h.getTasks().map(function (x) { return Object.assign({}, x); }), r = h.keepSeparate(a, b);
          refresh(root, r.ok ? "Kept separate. It won't be suggested again." : r.error, r.ok ? function () { h.commitTasks(prev); } : null);
        } else if (act === "dup-merge") {
          const r = mergeTasks(s.a.id, s.b.id);
          refresh(root, r.ok ? "Merged into one task." : r.error, r.ok ? r.undo : null);
        } else if (act === "dup-del") {
          const r = removeTask(s.task.id);
          refresh(root, r.ok ? "Deleted the task. The event stays." : r.error, r.ok ? r.undo : null);
        }
      }
    });
  }

  // Takes a task out of the lists (and off the time blocks that hold it). Returns an undo that puts everything back.
  function removeTask(id) {
    const h = H(), S = window.JarvisPlanStore, W = window.JarvisPlanWeekLogic;
    const prevTasks = h.getTasks().map(function (x) { return Object.assign({}, x); });
    if (!prevTasks.some(function (t) { return t.id === id; })) return { ok: false, error: "That task isn't there any more." };
    const prevBlocks = S && S.all ? S.all("blocks") : null;
    if (S && W && prevBlocks) { const r = W.unplaceTask(prevBlocks, id, {}); if (r.ok) S.replace("blocks", r.blocks); }
    h.commitTasks(prevTasks.filter(function (t) { return t.id !== id; }));
    return { ok: true, undo: function () { if (S && prevBlocks) S.replace("blocks", prevBlocks); h.commitTasks(prevTasks); } };
  }

  // Keeps the earlier of two tasks and folds the other into it: what the kept one lacks (time, goal, category, priority above medium) comes from the
  // other, and it is done if either was. The other is then removed. Reviewed and pressed by you, never automatic.
  function mergeTasks(aId, bId) {
    const h = H(), tasks = h.getTasks();
    const a = tasks.filter(function (t) { return t.id === aId; })[0], b = tasks.filter(function (t) { return t.id === bId; })[0];
    if (!a || !b) return { ok: false, error: "One of those tasks isn't there any more." };
    const keep = (a.createdAt || 0) <= (b.createdAt || 0) ? a : b, drop = keep === a ? b : a;
    const prevTasks = tasks.map(function (x) { return Object.assign({}, x); });
    const merged = Object.assign({}, keep);
    ["time", "goalId", "category", "habitId", "kind"].forEach(function (k) { if (!merged[k] && drop[k]) merged[k] = drop[k]; });
    if (merged.priority === "medium" && drop.priority && drop.priority !== "medium") merged.priority = drop.priority;
    merged.completed = !!(keep.completed || drop.completed);
    const S = window.JarvisPlanStore, W = window.JarvisPlanWeekLogic, prevBlocks = S && S.all ? S.all("blocks") : null;
    if (S && W && prevBlocks) { const r = W.unplaceTask(prevBlocks, drop.id, {}); if (r.ok) S.replace("blocks", r.blocks); }
    h.commitTasks(tasks.filter(function (t) { return t.id !== drop.id; }).map(function (t) { return t.id === keep.id ? merged : t; }));
    return { ok: true, undo: function () { if (S && prevBlocks) S.replace("blocks", prevBlocks); h.commitTasks(prevTasks); } };
  }

  window.JarvisPlanSync = { fill: fill, decide: decide, openReview: openReview, count: count, removeTask: removeTask, mergeTasks: mergeTasks, timeText: timeText, dateText: dateText };
})();
