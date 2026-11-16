/* ==========================================================================
   JARVIS — Strategic Planning Center: the rules for the weekly time-blocking planner (pure functions; no page, storage or
   network, so they can be tested outside the browser).

   What it works with:
     ingredients  jarvisPlanIngredients  { id, name, color (#rrggbb), rest, order, createdAt, updatedAt, deletedAt? }
                  the kinds of time you plan with (School, Gratiel, Workout, Studying, Personal, Rest ... or your own)
     blocks       jarvisPlanBlocks       { id, title, ingredientId, date, start, end, taskId, notes,
                                           repeat: null | { freq: weekly|daily, byDay: [0-6], until },
                                           exceptions: [dates skipped], overrides: { date: { start, end, workedMin, done } },
                                           was: { date, time } | null, createdAt, updatedAt, deletedAt? }
                  a block is a stretch of one day. A block can hold ONE of your existing tasks; then it is that task's time
                  (the task's day and time are set to match, and the task is the same record you see in Habits). Only blocks
                  without a task can repeat.
     weeks        jarvisPlanWeeks        { id: "wk_" + the Monday, weekStart, top: [{ taskId, text }], wins, lessons,
                                           nextFocus, reviewedAt, createdAt, updatedAt }

   Nothing is invented. Planned time is the length of your blocks. Actual time is only what you logged on a block: a block you
   didn't log is not counted as worked, and the review says how many were logged. Suggestions come from the free time left
   once your blocks, calendar events and timed tasks are taken out; they are only proposals, and you approve each one.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan-logic"), require("./calendar-logic"));
  else root.JarvisPlanWeekLogic = factory(root.JarvisPlanLogic, root.JarvisCalendarLogic);
})(typeof self !== "undefined" ? self : this, function (PL, CL) {
  "use strict";

  const COLORS = [
    { key: "blue", label: "Blue", hex: "#4f8cff" }, { key: "purple", label: "Purple", hex: "#a78bfa" }, { key: "green", label: "Green", hex: "#33d17a" },
    { key: "yellow", label: "Yellow", hex: "#ffc857" }, { key: "orange", label: "Orange", hex: "#fb923c" }, { key: "red", label: "Red", hex: "#ff5c66" },
    { key: "pink", label: "Pink", hex: "#f472b6" }, { key: "teal", label: "Teal", hex: "#2dd4bf" }, { key: "lime", label: "Lime", hex: "#a3e635" }, { key: "gray", label: "Gray", hex: "#94a3b8" }
  ];
  // The six the user named. Ids are fixed, so adding them on two devices never makes copies.
  const STARTERS = [
    { id: "ing_school", name: "School", color: "#4f8cff", rest: false }, { id: "ing_gratiel", name: "Gratiel", color: "#a78bfa", rest: false },
    { id: "ing_workout", name: "Workout", color: "#33d17a", rest: false }, { id: "ing_studying", name: "Studying", color: "#ffc857", rest: false },
    { id: "ing_personal", name: "Personal", color: "#f472b6", rest: false }, { id: "ing_rest", name: "Rest", color: "#2dd4bf", rest: true }
  ];
  const NAME_MAX = 30, TITLE_MAX = 140, NOTES_MAX = 1000, MIN_LEN = 15, MAX_LEN = 16 * 60, MAX_EXCEPTIONS = 400;
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];            // Monday first

  /* ---------------- small helpers ---------------- */
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function oneLine(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }
  function text(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, max); }
  const isDate = PL.isDate;
  function isTime(t) { return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toMin(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); }
  function toTime(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function weekday(date) { return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)))).getUTCDay(); }
  function mondayOf(date) { return PL.addDays(date, -((weekday(date) + 6) % 7)); }
  function weekDates(weekStart) { const out = []; for (let i = 0; i < 7; i++) out.push(PL.addDays(weekStart, i)); return out; }
  function ctxOf(c) {
    const x = Object.assign({ now: Date.now(), makeId: null }, c || {});
    if (!x.makeId) x.makeId = function (p) { return p + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); };
    return x;
  }
  const live = PL.live, tombstone = PL.tombstone, purge = PL.purge;
  function restoreRec(r, now) { const c = Object.assign({}, r, { updatedAt: now }); delete c.deletedAt; return c; }
  function hexOk(h) { return typeof h === "string" && /^#[0-9a-fA-F]{6}$/.test(h); }
  // The block's colour as a soft tint, so white text on it stays readable whatever colour was chosen.
  function tint(hex, alpha) {
    if (!hexOk(hex)) return "rgba(148,163,184," + alpha + ")";
    return "rgba(" + parseInt(hex.slice(1, 3), 16) + "," + parseInt(hex.slice(3, 5), 16) + "," + parseInt(hex.slice(5, 7), 16) + "," + alpha + ")";
  }

  /* ---------------- time block categories (stored as "ingredients", the name they had first) ---------------- */
  function liveIngredients(list) { return live(list).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0); }); }
  function ingredientById(list, id) { return live(list).filter(function (r) { return r.id === id; })[0] || null; }
  function checkIngredient(input, ctx) {
    const c = ctxOf(ctx), i = input || {}, errors = {};
    const name = oneLine(i.name);
    if (!name) errors.name = "Give it a name.";
    else if (name.length > NAME_MAX) errors.name = "Keep the name to " + NAME_MAX + " characters or fewer.";
    else if (liveIngredients(c.ingredients).some(function (x) { return x.id !== c.selfId && x.name.toLowerCase() === name.toLowerCase(); })) errors.name = "You already have one called " + name + ".";
    const color = hexOk(i.color) ? String(i.color).toLowerCase() : "";
    if (!color) errors.color = "Pick a colour.";
    return { ok: !Object.keys(errors).length, errors: errors, value: { name: name.slice(0, NAME_MAX), color: color, rest: !!i.rest } };
  }
  function addIngredient(list, input, ctx) {
    const c = ctxOf(ctx), r = checkIngredient(input, Object.assign({}, c, { ingredients: list }));
    if (!r.ok) return { ok: false, ingredients: list, errors: r.errors };
    const order = (list || []).reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0) + 1;
    const rec = Object.assign({ id: c.makeId("ing"), order: order, createdAt: c.now, updatedAt: c.now }, r.value);
    return { ok: true, ingredients: (list || []).concat([rec]), ingredient: rec };
  }
  function editIngredient(list, id, input, ctx) {
    const c = ctxOf(ctx), cur = ingredientById(list, id);
    if (!cur) return { ok: false, ingredients: list, errors: { name: "That isn't there any more." } };
    const r = checkIngredient(Object.assign({}, cur, input || {}), Object.assign({}, c, { ingredients: list, selfId: id }));
    if (!r.ok) return { ok: false, ingredients: list, errors: r.errors };
    const next = Object.assign({}, cur, r.value, { updatedAt: c.now });
    return { ok: true, ingredients: list.map(function (x) { return x.id === id ? next : x; }), ingredient: next };
  }
  // Deleting an ingredient leaves the blocks that used it in place (shown in grey as "No category"); Undo brings it back.
  function removeIngredient(list, id, ctx) {
    const c = ctxOf(ctx), cur = ingredientById(list, id);
    if (!cur) return { ok: false, ingredients: list };
    return { ok: true, ingredients: list.map(function (x) { return x.id === id ? tombstone(x, c.now) : x; }), ingredient: cur };
  }
  function restoreIngredient(list, id, ctx) { const c = ctxOf(ctx); return { ok: true, ingredients: list.map(function (x) { return x.id === id && x.deletedAt ? restoreRec(x, c.now) : x; }) }; }
  // The six ingredients you named. Ones you already have are left alone; ones you deleted come back; none is made twice.
  function addStarters(list, ctx) {
    const c = ctxOf(ctx);
    let out = (list || []).slice(), added = 0, order = out.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0);
    STARTERS.forEach(function (s) {
      const at = out.findIndex(function (x) { return x.id === s.id; });
      if (at !== -1) { if (out[at].deletedAt) { out[at] = restoreRec(out[at], c.now); added++; } return; }
      if (liveIngredients(out).some(function (x) { return x.name.toLowerCase() === s.name.toLowerCase(); })) return;
      out.push(Object.assign({}, s, { order: ++order, createdAt: c.now, updatedAt: c.now })); added++;
    });
    return { ok: true, ingredients: out, added: added };
  }

  /* ---------------- blocks ---------------- */
  function liveBlocks(list) { return live(list).filter(function (b) { return isDate(b.date) && isTime(b.start) && isTime(b.end); }); }
  function blockById(list, id) { return liveBlocks(list).filter(function (b) { return b.id === id; })[0] || null; }
  function blockOfTask(list, taskId) { return liveBlocks(list).filter(function (b) { return b.taskId === taskId; })[0] || null; }
  function taskText(tasks, id) { const t = (tasks || []).filter(function (x) { return x && x.id === id; })[0]; return t ? String(t.text || "") : ""; }

  // Checks a block's form values. -> { ok, errors, block } (block = the cleaned fields)
  function checkBlock(input, ctx) {
    const c = ctxOf(ctx), i = input || {}, errors = {}, b = {};
    b.taskId = typeof i.taskId === "string" ? i.taskId : "";
    if (b.taskId && Array.isArray(c.tasks) && !c.tasks.some(function (t) { return t && t.id === b.taskId; })) errors.taskId = "That task isn't there any more.";
    b.ingredientId = typeof i.ingredientId === "string" ? i.ingredientId : "";
    if (b.ingredientId && Array.isArray(c.ingredients) && !liveIngredients(c.ingredients).some(function (x) { return x.id === b.ingredientId; })) errors.ingredientId = "That category isn't there any more.";
    let title = oneLine(i.title);
    if (!title && b.taskId) title = oneLine(taskText(c.tasks, b.taskId));
    if (!title && b.ingredientId) { const ing = ingredientById(c.ingredients, b.ingredientId); title = ing ? ing.name : ""; }
    if (!title) errors.title = "Give it a title.";
    else if (title.length > TITLE_MAX) errors.title = "Keep the title to " + TITLE_MAX + " characters or fewer.";
    b.title = title.slice(0, TITLE_MAX);
    if (!isDate(i.date)) errors.date = "Pick a day."; else b.date = i.date;
    if (!isTime(i.start)) errors.start = "Pick a start time."; else b.start = i.start;
    if (!isTime(i.end)) errors.end = "Pick an end time."; else b.end = i.end;
    if (b.start && b.end) {
      const len = toMin(b.end) - toMin(b.start);
      if (len <= 0) errors.end = "The end has to be after the start.";
      else if (len < MIN_LEN) errors.end = "Make it at least " + MIN_LEN + " minutes.";
      else if (len > MAX_LEN) errors.end = "Keep it to 16 hours or less.";
    }
    b.notes = text(i.notes, NOTES_MAX + 1);
    if (b.notes.length > NOTES_MAX) errors.notes = "Keep the notes to " + NOTES_MAX + " characters or fewer.";
    // repeating
    const freq = i.repeatFreq !== undefined ? (i.repeatFreq === "weekly" || i.repeatFreq === "daily" ? i.repeatFreq : "") : (isObj(i.repeat) && (i.repeat.freq === "weekly" || i.repeat.freq === "daily") ? i.repeat.freq : "");
    b.repeat = null;
    if (freq) {
      if (b.taskId) errors.repeatFreq = "A block with a task can't repeat. The task happens once.";
      else {
        const rawDays = Array.isArray(i.repeatDays) ? i.repeatDays : (isObj(i.repeat) && Array.isArray(i.repeat.byDay) ? i.repeat.byDay : []);
        let days = rawDays.map(Number).filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; });
        days = days.filter(function (d, at) { return days.indexOf(d) === at; }).sort(function (x, y) { return WEEK_ORDER.indexOf(x) - WEEK_ORDER.indexOf(y); });
        if (freq === "weekly" && !days.length && b.date) days = [weekday(b.date)];
        const until = i.until === undefined || i.until === null ? (isObj(i.repeat) ? i.repeat.until : "") : i.until;
        if (until && !isDate(until)) errors.until = "Pick a valid last day, or leave it empty.";
        else if (until && b.date && until < b.date) errors.until = "The last day can't be before the first.";
        b.repeat = { freq: freq, byDay: freq === "weekly" ? days : [], until: until && isDate(until) ? until : "" };
      }
    }
    return { ok: !Object.keys(errors).length, errors: errors, block: b };
  }

  function addBlock(blocks, input, ctx) {
    const c = ctxOf(ctx), r = checkBlock(input, c);
    if (!r.ok) return { ok: false, blocks: blocks, errors: r.errors };
    const rec = Object.assign({ id: c.makeId("pb"), exceptions: [], overrides: {}, was: null, createdAt: c.now, updatedAt: c.now }, r.block);
    return { ok: true, blocks: (blocks || []).concat([rec]), block: rec };
  }
  // Changes a whole block (for a repeating one, every showing of it).
  function editBlock(blocks, id, patch, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, id);
    if (!cur) return { ok: false, blocks: blocks, errors: { title: "That isn't there any more." } };
    const r = checkBlock(Object.assign({}, cur, patch || {}, { repeatFreq: patch && patch.repeatFreq !== undefined ? patch.repeatFreq : (cur.repeat ? cur.repeat.freq : "") }), c);
    if (!r.ok) return { ok: false, blocks: blocks, errors: r.errors };
    const next = Object.assign({}, cur, r.block, { updatedAt: c.now });
    return { ok: true, blocks: blocks.map(function (b) { return b.id === id ? next : b; }), block: next };
  }
  function removeBlock(blocks, id, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, id);
    if (!cur) return { ok: false, blocks: blocks };
    return { ok: true, blocks: blocks.map(function (b) { return b.id === id ? tombstone(b, c.now) : b; }), block: cur };
  }
  function restoreBlock(blocks, id, ctx) { const c = ctxOf(ctx); return { ok: true, blocks: blocks.map(function (b) { return b.id === id && b.deletedAt ? restoreRec(b, c.now) : b; }) }; }
  // Takes one day out of a repeating block (or deletes a block that doesn't repeat).
  function removeOccurrence(blocks, id, occDate, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, id);
    if (!cur) return { ok: false, blocks: blocks };
    if (!cur.repeat) return removeBlock(blocks, id, c);
    if ((cur.exceptions || []).length >= MAX_EXCEPTIONS) return { ok: false, blocks: blocks, error: "That block has been skipped too many times. Delete the whole block instead." };
    const next = Object.assign({}, cur, { exceptions: (cur.exceptions || []).concat([occDate]), updatedAt: c.now });
    return { ok: true, blocks: blocks.map(function (b) { return b.id === id ? next : b; }), block: next };
  }
  function restoreOccurrence(blocks, id, occDate, ctx) {
    const c = ctxOf(ctx);
    return { ok: true, blocks: blocks.map(function (b) { return b.id === id ? Object.assign({}, b, { exceptions: (b.exceptions || []).filter(function (d) { return d !== occDate; }), updatedAt: c.now }) : b; }) };
  }

  // Every showing of every block from..to (dates inclusive).
  function occurrences(blocks, from, to) {
    const out = [];
    liveBlocks(blocks).forEach(function (b) {
      const ev = { date: b.date, repeat: b.repeat ? { freq: b.repeat.freq, interval: 1, byDay: b.repeat.byDay || [], until: b.repeat.until || "", count: 0 } : null, exceptions: b.exceptions || [] };
      CL.repeatDates(ev, from, to).forEach(function (d) {
        const o = (b.overrides || {})[d] || {}, s = isTime(o.start) ? o.start : b.start, e = isTime(o.end) ? o.end : b.end;
        out.push({
          key: b.id + "@" + d, blockId: b.id, date: d, start: s, end: e, startMin: toMin(s), endMin: toMin(e), title: b.title, ingredientId: b.ingredientId, taskId: b.taskId,
          recurring: !!b.repeat, workedMin: typeof o.workedMin === "number" ? o.workedMin : null, done: !!o.done, notes: b.notes || "", moved: !!(isTime(o.start) || isTime(o.end))
        });
      });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin || (a.title < b.title ? -1 : 1); });
  }
  function occurrence(blocks, id, occDate) { return occurrences(blocks, occDate, occDate).filter(function (o) { return o.blockId === id; })[0] || null; }

  function setOverride(blocks, id, occDate, patch, c) {
    const cur = blockById(blocks, id);
    if (!cur) return { ok: false, blocks: blocks };
    const ov = Object.assign({}, cur.overrides || {});
    ov[occDate] = Object.assign({}, ov[occDate] || {}, patch);
    Object.keys(ov[occDate]).forEach(function (k) { if (ov[occDate][k] === null || ov[occDate][k] === undefined || ov[occDate][k] === false) delete ov[occDate][k]; });
    if (!Object.keys(ov[occDate]).length) delete ov[occDate];
    const next = Object.assign({}, cur, { overrides: ov, updatedAt: c.now });
    return { ok: true, blocks: blocks.map(function (b) { return b.id === id ? next : b; }), block: next };
  }

  // Moves (or re-times) one showing of a block. to = { date, start, end }. A block that doesn't repeat just moves. For a repeating
  // block on the same day only that day's time changes; to another day, that day is skipped and a one-off copy is made there.
  // -> { ok, blocks, block, taskPatch? } where taskPatch is the { date, time } to give the block's task, if it has one.
  function moveOccurrence(blocks, id, occDate, to, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, id);
    if (!cur) return { ok: false, blocks: blocks, error: "That isn't there any more." };
    const chk = checkBlock(Object.assign({}, cur, { date: to.date, start: to.start, end: to.end, repeatFreq: "", taskId: cur.taskId }), Object.assign({}, c, { tasks: null, ingredients: null }));
    if (!chk.ok) return { ok: false, blocks: blocks, errors: chk.errors, error: chk.errors.end || chk.errors.date || chk.errors.start || "That can't be moved there." };
    if (!cur.repeat) {
      const next = Object.assign({}, cur, { date: to.date, start: to.start, end: to.end, updatedAt: c.now });
      return { ok: true, blocks: blocks.map(function (b) { return b.id === id ? next : b; }), block: next, taskPatch: cur.taskId ? { date: to.date, time: to.start } : null };
    }
    if (to.date === occDate) return setOverride(blocks, id, occDate, { start: to.start === cur.start ? null : to.start, end: to.end === cur.end ? null : to.end }, c);
    const skipped = removeOccurrence(blocks, id, occDate, c);
    if (!skipped.ok) return skipped;
    const copy = Object.assign({}, cur, { id: c.makeId("pb"), date: to.date, start: to.start, end: to.end, repeat: null, exceptions: [], overrides: {}, createdAt: c.now, updatedAt: c.now });
    return { ok: true, blocks: skipped.blocks.concat([copy]), block: copy };
  }
  function resizeOccurrence(blocks, id, occDate, end, ctx) {
    const o = occurrence(blocks, id, occDate);
    if (!o) return { ok: false, blocks: blocks, error: "That isn't there any more." };
    return moveOccurrence(blocks, id, occDate, { date: occDate, start: o.start, end: end }, ctx);
  }
  // Changes the details of ONE showing of a repeating block (the title, ingredient, notes and times), as a one-off copy on that day.
  function editOccurrence(blocks, id, occDate, patch, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, id);
    if (!cur) return { ok: false, blocks: blocks, errors: { title: "That isn't there any more." } };
    if (!cur.repeat) return editBlock(blocks, id, patch, c);
    const r = checkBlock(Object.assign({}, cur, { date: occDate }, patch || {}, { repeatFreq: "" }), c);
    if (!r.ok) return { ok: false, blocks: blocks, errors: r.errors };
    const skipped = removeOccurrence(blocks, id, occDate, c);
    if (!skipped.ok) return { ok: false, blocks: blocks, errors: { title: skipped.error || "That can't be changed." } };
    const copy = Object.assign({ id: c.makeId("pb"), exceptions: [], overrides: {}, was: null, createdAt: c.now, updatedAt: c.now }, r.block, { repeat: null });
    return { ok: true, blocks: skipped.blocks.concat([copy]), block: copy };
  }

  /* ---------------- time worked, done ---------------- */
  // Records the minutes you actually worked in one showing of a block. null/"" clears it.
  function logWork(blocks, id, occDate, minutes, ctx) {
    const c = ctxOf(ctx);
    const m = minutes === "" || minutes === null || minutes === undefined ? null : Number(minutes);
    if (m !== null && !(Number.isInteger(m) && m >= 0 && m <= 1440)) return { ok: false, blocks: blocks, error: "Enter whole minutes (0 to 1440)." };
    return setOverride(blocks, id, occDate, { workedMin: m === null ? null : m }, c);
  }
  // Without a task a block is its own checklist item (the task's completion is the task's own).
  function setBlockDone(blocks, id, occDate, done, ctx) { return setOverride(blocks, id, occDate, { done: !!done }, ctxOf(ctx)); }

  /* ---------------- putting a task in a block ---------------- */
  // Puts one of your tasks in a block at target = { date, start, end, ingredientId }. A task is in one block at a time: if it was
  // already in one, that block moves. -> { ok, blocks, block, taskPatch: { date, time } }  (taskPatch is what to set on the task).
  function placeTask(blocks, taskId, target, tasks, ctx) {
    const c = ctxOf(ctx), t = (tasks || []).filter(function (x) { return x && x.id === taskId; })[0];
    if (!t) return { ok: false, blocks: blocks, error: "That task isn't there any more." };
    const cur = blockOfTask(blocks, taskId);
    if (cur) {
      const r = moveOccurrence(blocks, cur.id, cur.date, { date: target.date, start: target.start, end: target.end }, c);
      if (!r.ok) return r;
      let out = r.blocks;
      if (target.ingredientId !== undefined && target.ingredientId !== cur.ingredientId) { const e = editBlock(out, cur.id, { ingredientId: target.ingredientId }, Object.assign({}, c, { tasks: tasks, ingredients: c.ingredients })); if (e.ok) out = e.blocks; }
      return { ok: true, blocks: out, block: blockById(out, cur.id), taskPatch: { date: target.date, time: target.start } };
    }
    const r = addBlock(blocks, { taskId: taskId, title: t.text, ingredientId: target.ingredientId || "", date: target.date, start: target.start, end: target.end }, Object.assign({}, c, { tasks: tasks, ingredients: c.ingredients }));
    if (!r.ok) return { ok: false, blocks: blocks, errors: r.errors, error: r.errors.end || r.errors.date || r.errors.start || r.errors.ingredientId || "That can't be scheduled." };
    // remember where the task was, so taking it out of the block puts it back
    const kept = Object.assign({}, r.block, { was: { date: t.date || "", time: t.time || "" } });
    return { ok: true, blocks: r.blocks.map(function (b) { return b.id === kept.id ? kept : b; }), block: kept, taskPatch: { date: target.date, time: target.start } };
  }
  // Takes a task out of its block (the block is deleted). -> the { date, time } to give the task back.
  function unplaceTask(blocks, taskId, ctx) {
    const c = ctxOf(ctx), cur = blockOfTask(blocks, taskId);
    if (!cur) return { ok: false, blocks: blocks };
    const was = cur.was && isObj(cur.was) ? cur.was : null;
    return { ok: true, blocks: blocks.map(function (b) { return b.id === cur.id ? tombstone(b, c.now) : b; }), block: cur, taskPatch: { date: was && isDate(was.date) ? was.date : cur.date, time: was && isTime(was.time) ? was.time : "" } };
  }
  // Puts a task into a block that already exists. If the task was in another block, that one is kept as a plain block.
  // -> { ok, blocks, block, taskPatch: { date, time }, releasedFrom }
  function assignTask(blocks, blockId, taskId, tasks, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, blockId), t = (tasks || []).filter(function (x) { return x && x.id === taskId; })[0];
    if (!cur) return { ok: false, blocks: blocks, error: "That block isn't there any more." };
    if (!t) return { ok: false, blocks: blocks, error: "That task isn't there any more." };
    if (cur.repeat) return { ok: false, blocks: blocks, error: "A block that repeats can't hold a task. The task happens once." };
    let out = blocks, from = null;
    const other = blockOfTask(blocks, taskId);
    if (other && other.id !== blockId) { out = releaseTask(out, other.id, c).blocks; from = other; }
    const keepWas = other && other.id === blockId ? cur.was : (other && other.was ? other.was : { date: t.date || "", time: t.time || "" });
    const next = Object.assign({}, blockById(out, blockId), { taskId: taskId, title: oneLine(t.text).slice(0, TITLE_MAX) || cur.title, was: keepWas, updatedAt: c.now });
    return { ok: true, blocks: out.map(function (b) { return b.id === blockId ? next : b; }), block: next, taskPatch: { date: cur.date, time: cur.start }, releasedFrom: from };
  }
  // Lets a block go on without its task (the block stays, now a plain one). -> { ok, blocks, taskId, taskPatch } where taskPatch is where the task was before.
  function releaseTask(blocks, blockId, ctx) {
    const c = ctxOf(ctx), cur = blockById(blocks, blockId);
    if (!cur || !cur.taskId) return { ok: false, blocks: blocks };
    const was = cur.was && isObj(cur.was) ? cur.was : null;
    const next = Object.assign({}, cur, { taskId: "", was: null, updatedAt: c.now });
    return { ok: true, blocks: blocks.map(function (b) { return b.id === blockId ? next : b; }), taskId: cur.taskId, taskPatch: was && isDate(was.date) ? { date: was.date, time: isTime(was.time) ? was.time : "" } : null };
  }
  // A task that was moved somewhere else (in Habits, say) takes its block with it, so the two never disagree; a task that no longer exists
  // lets its block go on as a plain block. The block keeps its length. Returns the same list when nothing needed to change.
  function followTasks(blocks, tasks, ctx) {
    const c = ctxOf(ctx), byTask = {};
    (tasks || []).forEach(function (t) { if (t && typeof t.id === "string") byTask[t.id] = t; });
    let changed = false;
    const out = (blocks || []).map(function (b) {
      if (!b || b.deletedAt || !b.taskId) return b;
      const t = byTask[b.taskId];
      if (!t) { changed = true; return Object.assign({}, b, { taskId: "", was: null, updatedAt: c.now }); }
      const dateOff = isDate(t.date) && t.date !== b.date, timeOff = isTime(t.time) && t.time !== b.start;
      if (!dateOff && !timeOff) return b;
      const len = toMin(b.end) - toMin(b.start);
      let start = isTime(t.time) ? toMin(t.time) : toMin(b.start);
      if (start + len > 1439) start = Math.max(0, 1439 - len);
      changed = true;
      return Object.assign({}, b, { date: isDate(t.date) ? t.date : b.date, start: toTime(start), end: toTime(start + len), updatedAt: c.now });
    });
    return changed ? out : blocks;
  }
  // The block keeps its place in the past as a plain block (so planned and worked time stay in the review), and the task is free again.
  function detachTasks(blocks, taskIds, ctx) {
    const c = ctxOf(ctx), set = {}; (taskIds || []).forEach(function (id) { set[id] = true; });
    return blocks.map(function (b) { return b && !b.deletedAt && b.taskId && set[b.taskId] ? Object.assign({}, b, { taskId: "", was: null, updatedAt: c.now }) : b; });
  }
  // Is this task in a block on the day it is dated?
  function scheduledBlock(blocks, task) {
    const b = blockOfTask(blocks, task.id);
    return b && b.date === task.date ? b : null;
  }
  function displayTitle(b, tasks) { return b.taskId ? (taskText(tasks, b.taskId) || b.title) : b.title; }

  /* ---------------- the weekly record: top three, review ---------------- */
  function weekId(weekStart) { return "wk_" + weekStart; }
  function weekOf(weeks, weekStart) { return live(weeks).filter(function (w) { return w.id === weekId(weekStart); })[0] || null; }
  function readWeek(w) {
    const top = (Array.isArray(w && w.top) ? w.top : []).filter(isObj).slice(0, 3).map(function (x) { return { taskId: typeof x.taskId === "string" ? x.taskId : "", text: oneLine(x.text).slice(0, TITLE_MAX) }; }).filter(function (x) { return x.taskId || x.text; });
    return { weekStart: w && w.weekStart, top: top, wins: text(w && w.wins, 2000), lessons: text(w && w.lessons, 2000), nextFocus: text(w && w.nextFocus, 2000), unfinished: text(w && w.unfinished, 2000), onPriorities: text(w && w.onPriorities, 2000), reviewedAt: Number(w && w.reviewedAt) || 0 };
  }
  // patch holds only what changes: top (a list), wins (what I accomplished), lessons (obstacles), unfinished, onPriorities, nextFocus (what to change), reviewedAt.
  function setWeek(weeks, weekStart, patch, ctx) {
    const c = ctxOf(ctx), p = patch || {};
    if (!isDate(weekStart) || weekday(weekStart) !== 1) return { ok: false, weeks: weeks, error: "A week starts on a Monday." };
    const cur = weekOf(weeks, weekStart), base = cur ? readWeek(cur) : readWeek({ weekStart: weekStart });
    const next = Object.assign({}, cur || { id: weekId(weekStart), weekStart: weekStart, createdAt: c.now }, readWeek(Object.assign({}, base, p, { weekStart: weekStart })), { id: weekId(weekStart), weekStart: weekStart, updatedAt: c.now });
    delete next.deletedAt;
    const had = (weeks || []).some(function (w) { return w && w.id === next.id; });
    return { ok: true, weeks: had ? weeks.map(function (w) { return w && w.id === next.id ? next : w; }) : (weeks || []).concat([next]), week: next };
  }

  /* ---------------- the monthly review record (jarvisPlanReviews) ---------------- */
  function reviewId(month) { return "mo_" + month; }
  function reviewOf(reviews, month) { return live(reviews).filter(function (r) { return r.id === reviewId(month); })[0] || null; }
  function readReview(r) {
    return { month: r && r.month, wins: text(r && r.wins, 2000), fellBehind: text(r && r.fellBehind, 2000), progress: text(r && r.progress, 2000), nextFocus: text(r && r.nextFocus, 2000), reviewedAt: Number(r && r.reviewedAt) || 0 };
  }
  function setReview(reviews, month, patch, ctx) {
    const c = ctxOf(ctx), p = patch || {};
    if (!PL.isMonth(month)) return { ok: false, reviews: reviews, error: "That isn't a month." };
    const cur = reviewOf(reviews, month), base = readReview(cur || { month: month });
    const next = Object.assign({}, cur || { id: reviewId(month), month: month, createdAt: c.now }, readReview(Object.assign({}, base, p, { month: month })), { id: reviewId(month), month: month, updatedAt: c.now });
    delete next.deletedAt;
    const had = (reviews || []).some(function (r) { return r && r.id === next.id; });
    return { ok: true, reviews: had ? reviews.map(function (r) { return r && r.id === next.id ? next : r; }) : (reviews || []).concat([next]), review: next };
  }

  /* ---------------- what the week looks like ---------------- */
  function winOf(settings) {
    const s = PL.settings(settings, "");
    return { start: toMin(s.dayStart), end: toMin(s.dayEnd), interval: s.interval, limitMin: Math.round((Number(s.dailyLimitHours) || 10) * 60) };
  }
  function eventItems(ctx, from, to) {
    if (!Array.isArray(ctx.events) || !ctx.events.length) return [];
    return CL.expand(ctx.events, from, to, ctx.zone || "UTC").filter(function (it) { return !it.allDay && !it.point && it.startMin !== null && it.endMin !== null && it.endMin > it.startMin; });
  }
  // Busy stretches on one day, as { start, end, title, kind }: your blocks, your calendar events, and tasks that have a time but aren't in a block.
  function busyOn(date, ctx) {
    const out = [];
    occurrences(ctx.blocks, date, date).forEach(function (o) { out.push({ start: o.startMin, end: o.endMin, title: o.title, kind: "block", rest: false }); });
    eventItems(ctx, date, date).forEach(function (it) {
      const s = it.date === date ? it.startMin : 0, e = it.endDate === date ? it.endMin : 1440;
      out.push({ start: s, end: e, title: it.title, kind: "event" });
    });
    (ctx.tasks || []).forEach(function (t) {
      if (!t || t.date !== date || !isTime(t.time) || t.completed) return;
      if (scheduledBlock(ctx.blocks, t)) return;
      out.push({ start: toMin(t.time), end: Math.min(1440, toMin(t.time) + 30), title: t.text, kind: "task" });
    });
    return out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  }
  // Free stretches of at least minLen minutes inside the day window, starting on the snap interval. Today starts from now (when known).
  // extraBusy: more stretches to treat as taken, [{ start, end }].
  function freeSlots(date, ctx, minLen, extraBusy) {
    const w = winOf(ctx.settings), out = [];
    const busy = busyOn(date, ctx).concat(extraBusy || []).sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    const snapUp = function (m) { return Math.ceil(m / w.interval) * w.interval; };
    let cursor = w.start;
    if (date === ctx.today && typeof ctx.nowMin === "number" && ctx.nowMin > cursor) cursor = ctx.nowMin;
    const take = function (to) { const st = snapUp(cursor); if (to - st >= minLen) out.push({ start: st, end: to }); };
    busy.forEach(function (b) { if (b.start > cursor) take(Math.min(b.start, w.end)); cursor = Math.max(cursor, b.end); });
    if (cursor < w.end) take(w.end);
    return out;
  }
  function labelOfDay(date) { return DAY_NAMES[weekday(date)]; }

  function rolesOf(ctx) {
    const rest = {}; liveIngredients(ctx.ingredients).forEach(function (x) { if (x.rest) rest[x.id] = true; });
    return rest;
  }

  // The numbers for one week. Everything is counted from your blocks and tasks.
  function weekStats(ctx) {
    const c = ctx || {}, dates = weekDates(c.weekStart), today = c.today || "", tasks = Array.isArray(c.tasks) ? c.tasks : [];
    const occ = occurrences(c.blocks, dates[0], dates[6]);
    const nowMin = typeof c.nowMin === "number" ? c.nowMin : -1;
    const isPast = function (o) { return o.date < today || (o.date === today && nowMin >= 0 && o.endMin <= nowMin); };
    const per = {}, order = [];
    const bucket = function (id) { if (!per[id]) { per[id] = { ingredientId: id, planned: 0, actual: 0, blocks: 0, logged: 0 }; order.push(id); } return per[id]; };
    let planned = 0, actual = 0, past = 0, logged = 0, blocksDone = 0;
    occ.forEach(function (o) {
      const len = o.endMin - o.startMin, ing = ingredientById(c.ingredients, o.ingredientId) ? o.ingredientId : "";
      const b = bucket(ing);
      b.planned += len; b.blocks++; planned += len;
      if (o.workedMin !== null) { b.actual += o.workedMin; b.logged++; actual += o.workedMin; }
      if (isPast(o)) {
        past++;
        if (o.workedMin !== null) logged++;
        const t = o.taskId ? tasks.filter(function (x) { return x && x.id === o.taskId; })[0] : null;
        if (t ? t.completed : o.done) blocksDone++;
      }
    });
    const inWeek = tasks.filter(function (t) { return t && dates.indexOf(t.date) !== -1; });
    const doneInWeek = inWeek.filter(function (t) { return t.completed; });
    const m = c.model || null, linkedTasks = inWeek.filter(function (t) { return m && m.nodeOfTask(t.id); });
    const byNode = {};
    linkedTasks.forEach(function (t) { const n = m.nodeOfTask(t.id); (byNode[n.id] = byNode[n.id] || { nodeId: n.id, title: n.title, type: n.type, tasks: 0, done: 0 }).tasks++; if (t.completed) byNode[n.id].done++; });
    const allocation = order.map(function (id) {
      const b = per[id], ing = id ? ingredientById(c.ingredients, id) : null;
      return { ingredientId: id, name: ing ? ing.name : "No category", color: ing ? ing.color : "#94a3b8", planned: b.planned, actual: b.actual, blocks: b.blocks, logged: b.logged, share: planned ? Math.round(100 * b.planned / planned) : 0 };
    }).sort(function (a, b) { return b.planned - a.planned; });
    return {
      weekStart: dates[0], plannedMin: planned, actualMin: actual, blocks: occ.length, pastBlocks: past, loggedBlocks: logged, blocksDone: blocksDone, allocation: allocation,
      tasksTotal: inWeek.length, tasksDone: doneInWeek.length, completionRate: inWeek.length ? Math.round(100 * doneInWeek.length / inWeek.length) : null,
      linkedTasks: linkedTasks.length, alignmentPct: inWeek.length && m ? Math.round(100 * linkedTasks.length / inWeek.length) : null,
      byNode: Object.keys(byNode).map(function (k) { return byNode[k]; }).sort(function (a, b) { return b.tasks - a.tasks; })
    };
  }

  const PRIO = { high: 3, medium: 2, low: 1 };
  function openTasksFor(ctx, upTo) { return (ctx.tasks || []).filter(function (t) { return t && !t.completed && isDate(t.date) && t.date <= upTo && t.text; }); }

  // High-priority tasks dated this week that are neither in a block nor given a time: they will be forgotten.
  function unscheduledHigh(ctx) {
    const dates = weekDates(ctx.weekStart), today = ctx.today || "";
    return (ctx.tasks || []).filter(function (t) {
      return t && !t.completed && t.priority === "high" && dates.indexOf(t.date) !== -1 && t.date >= today && !isTime(t.time) && !scheduledBlock(ctx.blocks, t);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order || 0) - (b.order || 0); });
  }

  // Three suggestions for "what matters most this week", each with the reasons in words. Only open tasks, and the ones that move
  // a plan item that is behind count for more. The person decides; this is only a starting list.
  function topThree(ctx) {
    const dates = weekDates(ctx.weekStart), weekEnd = dates[6], m = ctx.model || null;
    const scored = openTasksFor(ctx, weekEnd).map(function (t) {
      let score = (PRIO[t.priority] || 2) * 10;
      const why = [];
      if (t.priority === "high") why.push("High priority"); else if (t.priority === "low") why.push("Low priority");
      if (t.date < dates[0]) { score += 10; why.push("Carried over from " + labelOfDay(t.date)); } else if (dates.indexOf(t.date) !== -1) { score += 5; }
      const n = m ? m.nodeOfTask(t.id) : null;
      if (n) {
        score += 15; why.push("Counts toward “" + n.title + "”");
        const h = m.health(n.id);
        if (h === "behind" || h === "overdue" || h === "atrisk") { score += 10; why.push("which is " + (h === "atrisk" ? "at risk" : h)); }
      }
      return { task: t, score: score, reasons: why };
    });
    scored.sort(function (a, b) { return b.score - a.score || (a.task.date < b.task.date ? -1 : a.task.date > b.task.date ? 1 : 0) || (a.task.createdAt || 0) - (b.task.createdAt || 0); });
    return scored.slice(0, 3);
  }

  // Warnings about too much in too little time. Every one comes with the figures behind it.
  /* ---------------- one day at a glance, and which blocks overlap ---------------- */
  // Blocks that overlap another block, or a calendar event, on the same day. -> { "blockId|date": "block" | "event" } ("block" wins if both)
  function clashKeys(ctx, from, to) {
    const occ = occurrences(ctx.blocks, from, to), out = {};
    const key = function (o) { return o.blockId + "|" + o.date; };
    for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) {
      if (occ[i].date === occ[j].date && occ[i].startMin < occ[j].endMin && occ[j].startMin < occ[i].endMin) { out[key(occ[i])] = "block"; out[key(occ[j])] = "block"; }
    }
    weekDatesBetween(from, to).forEach(function (d) {
      const evs = eventItems(ctx, d, d);
      occ.filter(function (o) { return o.date === d; }).forEach(function (o) {
        if (out[key(o)]) return;
        if (evs.some(function (it) { const es = it.date === d ? it.startMin : 0, ee = it.endDate === d ? it.endMin : 1440; return o.startMin < ee && es < o.endMin; })) out[key(o)] = "event";
      });
    });
    return out;
  }
  function weekDatesBetween(from, to) { const out = []; for (let d = from; d <= to && out.length < 400; d = PL.addDays(d, 1)) out.push(d); return out; }
  // One day: minutes planned in blocks, by category; minutes taken (blocks, calendar events and timed tasks, overlaps counted once, inside your day window); minutes free.
  function daySummary(date, ctx) {
    const w = winOf(ctx.settings), occ = occurrences(ctx.blocks, date, date), rows = {}, order = [];
    let planned = 0;
    occ.forEach(function (o) {
      const ing = o.ingredientId ? ingredientById(ctx.ingredients, o.ingredientId) : null, id = ing ? o.ingredientId : "";
      if (!rows[id]) { rows[id] = { ingredientId: id, name: ing ? ing.name : "No category", color: ing ? ing.color : "#94a3b8", min: 0, rest: !!(ing && ing.rest) }; order.push(id); }
      const len = o.endMin - o.startMin; rows[id].min += len; planned += len;
    });
    const spans = busyOn(date, ctx).map(function (b) { return [Math.max(b.start, w.start), Math.min(b.end, w.end)]; }).filter(function (x) { return x[1] > x[0]; }).sort(function (a, b) { return a[0] - b[0]; });
    let taken = 0, cur = null;
    spans.forEach(function (x) { if (!cur || x[0] > cur[1]) { if (cur) taken += cur[1] - cur[0]; cur = [x[0], x[1]]; } else cur[1] = Math.max(cur[1], x[1]); });
    if (cur) taken += cur[1] - cur[0];
    const windowMin = Math.max(0, w.end - w.start);
    return { date: date, plannedMin: planned, takenMin: taken, windowMin: windowMin, freeMin: Math.max(0, windowMin - taken), rows: order.map(function (id) { return rows[id]; }).sort(function (a, b) { return b.min - a.min; }) };
  }

  function capacity(ctx) {
    const dates = weekDates(ctx.weekStart), w = winOf(ctx.settings), today = ctx.today || "", out = [], rest = rolesOf(ctx);
    const perDay = {};
    dates.forEach(function (d) {
      const occ = occurrences(ctx.blocks, d, d), evs = eventItems(ctx, d, d);
      let minutes = 0;
      occ.forEach(function (o) { if (!rest[o.ingredientId]) minutes += o.endMin - o.startMin; });
      evs.forEach(function (it) { minutes += (it.endDate === d ? it.endMin : 1440) - (it.date === d ? it.startMin : 0); });
      perDay[d] = minutes;
      if (minutes > w.limitMin) out.push({ kind: "overbooked", date: d, minutes: minutes, message: labelOfDay(d) + " has about " + (Math.round(minutes / 6) / 10) + " h planned (blocks and events), over your " + (w.limitMin / 60) + " h a day limit." });
      // blocks that overlap each other
      for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) {
        if (occ[i].startMin < occ[j].endMin && occ[j].startMin < occ[i].endMin) out.push({ kind: "overlap", date: d, message: labelOfDay(d) + ": “" + occ[i].title + "” and “" + occ[j].title + "” overlap." });
      }
      evs.forEach(function (it) {
        occ.forEach(function (o) {
          const es = it.date === d ? it.startMin : 0, ee = it.endDate === d ? it.endMin : 1440;
          if (o.startMin < ee && es < o.endMin) out.push({ kind: "clash", date: d, message: labelOfDay(d) + ": “" + o.title + "” runs into your calendar event “" + it.title + "”." });
        });
      });
    });
    // the open tasks you have estimated vs the free time left this week
    const remaining = dates.filter(function (d) { return d >= today; });
    const links = ctx.links || [];
    let need = 0, unknown = 0;
    (ctx.tasks || []).forEach(function (t) {
      if (!t || t.completed || dates.indexOf(t.date) === -1 || t.date < today || scheduledBlock(ctx.blocks, t)) return;
      const l = PL.linkOf(links, t.id);
      if (l && l.estMin) need += l.estMin; else unknown++;
    });
    if (need > 0) {
      let free = 0;
      remaining.forEach(function (d) { free += freeSlots(d, ctx, 15, []).reduce(function (s, x) { return s + x.end - x.start; }, 0); });
      if (need > free) out.push({ kind: "estimates", minutes: need, free: free, message: "The tasks you have estimated and not scheduled need about " + (Math.round(need / 6) / 10) + " h, but only " + (Math.round(free / 6) / 10) + " h of your day window is free for the rest of the week." + (unknown ? " (" + unknown + " more have no estimate.)" : "") });
    }
    return { warnings: out, perDay: perDay, limitMin: w.limitMin };
  }

  // Where unscheduled tasks could go: the first free stretch long enough, on the task's day or after it. Proposals only.
  function suggest(ctx) {
    const dates = weekDates(ctx.weekStart), today = ctx.today || "", w = winOf(ctx.settings), out = [], links = ctx.links || [];
    const taken = {};      // slots already proposed in this pass, so two tasks never get the same time
    const cand = (ctx.tasks || []).filter(function (t) {
      return t && !t.completed && dates.indexOf(t.date) !== -1 && t.date >= today && !scheduledBlock(ctx.blocks, t);
    }).sort(function (a, b) { return (PRIO[b.priority] || 2) - (PRIO[a.priority] || 2) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.order || 0) - (b.order || 0); }).slice(0, 12);
    cand.forEach(function (t) {
      const l = PL.linkOf(links, t.id), est = l && l.estMin ? l.estMin : 0;
      const len = Math.max(w.interval, Math.ceil((est || 60) / w.interval) * w.interval);
      let found = null;
      for (let i = 0; i < dates.length && !found; i++) {
        const d = dates[i];
        if (d < t.date || d < today) continue;
        const busy = busyOn(d, ctx).concat(taken[d] || []);
        const slots = freeSlots(d, ctx, len, taken[d] || []);
        if (slots.length) {
          const s = slots[0], prev = busy.filter(function (b) { return b.end <= s.start; }).sort(function (a, b) { return b.end - a.end; })[0];
          found = { taskId: t.id, text: t.text, date: d, start: toTime(s.start), end: toTime(s.start + len), minutes: len, estimated: !!est, after: prev ? prev.title : "" };
          (taken[d] = taken[d] || []).push({ start: s.start, end: s.start + len });
        }
      }
      if (found) { found.reason = (found.estimated ? "You estimated " : "No estimate, so ") + (found.estimated ? est : len) + " min. " + labelOfDay(found.date) + " " + toTime(toMin(found.start)) + " is free" + (found.after ? ", after “" + found.after + "”" : "") + "."; out.push(found); }
      else out.push({ taskId: t.id, text: t.text, none: true, minutes: len, reason: "No free " + len + " min left in your day window this week." });
    });
    return out;
  }
  // Unfinished tasks from days that have passed, with a place to carry them to. Nothing moves until you say so.
  function carryForward(ctx) {
    const today = ctx.today || "", from = PL.addDays(ctx.weekStart, -7);
    return (ctx.tasks || []).filter(function (t) { return t && !t.completed && isDate(t.date) && t.date < today && t.date >= from && t.text; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order || 0) - (b.order || 0); });
  }
  // The task list with these tasks moved to a new day, as unscheduled tasks at the end of that day. Others are untouched.
  function carryTasks(tasks, ids, targetDate) {
    const set = {}; ids.forEach(function (id) { set[id] = true; });
    let order = (tasks || []).filter(function (t) { return t && t.date === targetDate; }).reduce(function (m, t) { return Math.max(m, Number(t.order) || 0); }, -1);
    return (tasks || []).map(function (t) {
      if (!t || !set[t.id] || t.completed) return t;
      order += 1;
      return Object.assign({}, t, { date: targetDate, time: "", order: order });
    });
  }
  // The week's own date: the day to carry to (today while the week is still on, else the next Monday).
  function carryTarget(ctx) {
    const today = ctx.today || "", dates = weekDates(ctx.weekStart);
    return dates.indexOf(today) !== -1 && today < dates[6] ? today : PL.addDays(dates[6], 1);
  }

  return {
    COLORS: COLORS, STARTERS: STARTERS, DAY_NAMES: DAY_NAMES, DAY_SHORT: DAY_SHORT, WEEK_ORDER: WEEK_ORDER, MIN_LEN: MIN_LEN, NAME_MAX: NAME_MAX,
    isTime: isTime, toMin: toMin, toTime: toTime, weekday: weekday, mondayOf: mondayOf, weekDates: weekDates, tint: tint, hexOk: hexOk, labelOfDay: labelOfDay,
    liveIngredients: liveIngredients, ingredientById: ingredientById, checkIngredient: checkIngredient, addIngredient: addIngredient, editIngredient: editIngredient, removeIngredient: removeIngredient, restoreIngredient: restoreIngredient, addStarters: addStarters,
    liveBlocks: liveBlocks, blockById: blockById, blockOfTask: blockOfTask, checkBlock: checkBlock, addBlock: addBlock, editBlock: editBlock, removeBlock: removeBlock, restoreBlock: restoreBlock,
    removeOccurrence: removeOccurrence, restoreOccurrence: restoreOccurrence, occurrences: occurrences, occurrence: occurrence, moveOccurrence: moveOccurrence, resizeOccurrence: resizeOccurrence, editOccurrence: editOccurrence,
    logWork: logWork, setBlockDone: setBlockDone, placeTask: placeTask, unplaceTask: unplaceTask, detachTasks: detachTasks, releaseTask: releaseTask, assignTask: assignTask, followTasks: followTasks, scheduledBlock: scheduledBlock, displayTitle: displayTitle,
    weekId: weekId, weekOf: weekOf, readWeek: readWeek, setWeek: setWeek, reviewId: reviewId, reviewOf: reviewOf, readReview: readReview, setReview: setReview, purge: purge,
    winOf: winOf, busyOn: busyOn, freeSlots: freeSlots, weekStats: weekStats, unscheduledHigh: unscheduledHigh, topThree: topThree, capacity: capacity, suggest: suggest,
    carryForward: carryForward, carryTasks: carryTasks, carryTarget: carryTarget, clashKeys: clashKeys, daySummary: daySummary,
    readers: {
      ingredients: function (raw) { const items = [], kept = []; (Array.isArray(raw) ? raw : []).forEach(function (r) { if (isObj(r) && typeof r.id === "string" && r.id && typeof r.name === "string") items.push(Object.assign({}, r, { color: hexOk(r.color) ? r.color : "#94a3b8", rest: !!r.rest, order: Number(r.order) || 0 })); else kept.push(r); }); return { items: items, kept: kept }; },
      blocks: function (raw) {
        const items = [], kept = [];
        (Array.isArray(raw) ? raw : []).forEach(function (r) {
          if (!isObj(r) || typeof r.id !== "string" || !r.id || !isDate(r.date) || !isTime(r.start) || !isTime(r.end)) { kept.push(r); return; }
          items.push(Object.assign({}, r, { title: oneLine(r.title).slice(0, TITLE_MAX) || "Block", ingredientId: typeof r.ingredientId === "string" ? r.ingredientId : "", taskId: typeof r.taskId === "string" ? r.taskId : "", notes: text(r.notes, NOTES_MAX), exceptions: Array.isArray(r.exceptions) ? r.exceptions.filter(isDate) : [], overrides: isObj(r.overrides) ? r.overrides : {}, repeat: isObj(r.repeat) && (r.repeat.freq === "weekly" || r.repeat.freq === "daily") ? { freq: r.repeat.freq, byDay: Array.isArray(r.repeat.byDay) ? r.repeat.byDay.filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; }) : [], until: isDate(r.repeat.until) ? r.repeat.until : "" } : null }));
        });
        return { items: items, kept: kept };
      },
      reviews: function (raw) { const items = [], kept = []; (Array.isArray(raw) ? raw : []).forEach(function (r) { if (isObj(r) && typeof r.id === "string" && PL.isMonth(r.month)) items.push(Object.assign({}, r, readReview(r), { month: r.month })); else kept.push(r); }); return { items: items, kept: kept }; },
      weeks: function (raw) { const items = [], kept = []; (Array.isArray(raw) ? raw : []).forEach(function (r) { if (isObj(r) && typeof r.id === "string" && isDate(r.weekStart)) items.push(Object.assign({}, r, readWeek(r), { weekStart: r.weekStart })); else kept.push(r); }); return { items: items, kept: kept }; }
    }
  };
});
