/* ==========================================================================
   JARVIS — Planning › Routine templates (plan-routine-logic.js; the Workout routines are routine-logic.js, a different thing) (pure rules; no page, storage or network).

   A routine is a reusable sequence of steps with lengths ("School morning": wake up 10 min, get ready 20 min, breakfast 20 min ...). You
   apply it to days and it puts ordinary time blocks on those days, starting at the time you choose. Nothing is repeated by magic: a routine
   remembers which blocks it made (applied), so that after you edit the routine you can update its FUTURE days. Days that have passed are
   never touched, and a block you edited or deleted yourself is left alone.

   * A step that is linked to one of your habits makes no block: the habit already has its own time on the Calendar, so nothing is duplicated.
   * Applying never makes a second block for a step that is already on that day (same title, same start).
   * Pausing a routine stops it being applied or updated; what it already put on future days stays until you remove it.
   * A step has a length and a gap after the previous one, so the times are worked out from the start time; none is typed per day.

   routine: { id, name, kind, startTime "HH:MM", paused, steps: [{ id, title, durationMin, gapMin, habitId }], applied: [{ date, blockId, stepId }], createdAt, updatedAt, deletedAt? }
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisPlanRoutineLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = [
    ["school-morning", "School morning"], ["weekend-morning", "Weekend morning"], ["evening", "Evening"], ["after-school", "After school"],
    ["sunday-reset", "Sunday reset"], ["business", "Business work"], ["custom", "Custom"]
  ];
  const KIND_IDS = KINDS.map(function (k) { return k[0]; });
  // A step becomes a time block, and a block is at least 15 minutes, so a step is too.
  const NAME_MAX = 60, TITLE_MAX = 80, MAX_STEPS = 12, MAX_ROUTINES = 40, MAX_APPLIED = 500, MIN_STEP_MIN = 15, MAX_STEP_MIN = 240, MAX_GAP_MIN = 120;

  // Starting points you can add and then edit. They are ordinary routines once added; the lengths are only a first guess.
  const STARTERS = [
    { kind: "school-morning", name: "School morning", startTime: "06:30", steps: [["Wake up", 15], ["Get ready", 20], ["Breakfast", 20], ["Pack up and go", 15]] },
    { kind: "weekend-morning", name: "Weekend morning", startTime: "08:30", steps: [["Wake up", 15], ["Breakfast", 30], ["Plan the day", 15]] },
    { kind: "after-school", name: "After school", startTime: "15:30", steps: [["Snack and reset", 20], ["Homework", 60], ["Tidy up", 15]] },
    { kind: "evening", name: "Evening", startTime: "20:30", steps: [["Prepare for tomorrow", 15], ["Wind down", 30], ["Get ready for bed", 15]] },
    { kind: "sunday-reset", name: "Sunday reset", startTime: "17:00", steps: [["Review the week", 15], ["Plan next week", 20], ["Prepare what you need", 20]] },
    { kind: "business", name: "Business work", startTime: "16:00", steps: [["Check orders and messages", 20], ["Main task", 60], ["Wrap up and note tomorrow", 15]] }
  ];

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function isTime(t) { return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function isDate(d) { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d); }
  function toMin(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); }
  function toTime(m) { const x = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); }
  function int(v, lo, hi, dflt) { const n = Math.round(Number(v)); return isFinite(n) && n >= lo && n <= hi ? n : dflt; }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function ctxOf(c) {
    const x = Object.assign({ now: Date.now(), makeId: null }, c || {});
    if (!x.makeId) x.makeId = function (p) { return p + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); };
    return x;
  }
  function addDays(d, n) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)) + n * 86400000).toISOString().slice(0, 10); }
  function weekday(d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8))).getUTCDay(); }

  /* ---------------- reading what is stored ---------------- */

  function cleanStep(s, makeId) {
    if (!isObj(s)) return null;
    const title = str(s.title, TITLE_MAX);
    if (!title) return null;
    return { id: typeof s.id === "string" && s.id ? s.id.slice(0, 60) : makeId("rs"), title: title, durationMin: int(s.durationMin, MIN_STEP_MIN, MAX_STEP_MIN, 15), gapMin: int(s.gapMin, 0, MAX_GAP_MIN, 0), habitId: typeof s.habitId === "string" ? s.habitId.slice(0, 60) : "" };
  }
  function cleanOne(r, makeId) {
    if (!isObj(r) || typeof r.id !== "string" || !r.id) return null;
    const name = str(r.name, NAME_MAX);
    if (!name && !r.deletedAt) return null;
    const out = {
      id: r.id.slice(0, 60), name: name, kind: KIND_IDS.indexOf(r.kind) !== -1 ? r.kind : "custom", startTime: isTime(r.startTime) ? r.startTime : "07:00", paused: !!r.paused,
      steps: (Array.isArray(r.steps) ? r.steps : []).map(function (s) { return cleanStep(s, makeId); }).filter(Boolean).slice(0, MAX_STEPS),
      applied: (Array.isArray(r.applied) ? r.applied : []).filter(function (a) { return isObj(a) && isDate(a.date) && typeof a.blockId === "string" && a.blockId; }).map(function (a) { return { date: a.date, blockId: a.blockId.slice(0, 80), stepId: typeof a.stepId === "string" ? a.stepId.slice(0, 60) : "" }; }).slice(-MAX_APPLIED),
      createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0
    };
    if (r.deletedAt) out.deletedAt = Number(r.deletedAt) || 1;
    return out;
  }
  // What was read from storage: only usable routines, each with its steps cleaned.
  function clean(list, ctx) {
    const c = ctxOf(ctx), seen = {};
    return (Array.isArray(list) ? list : []).map(function (r) { return cleanOne(r, c.makeId); }).filter(function (r) { if (!r || seen[r.id]) return false; seen[r.id] = true; return true; }).slice(0, MAX_ROUTINES * 3);
  }
  function live(list) { return (Array.isArray(list) ? list : []).filter(function (r) { return r && !r.deletedAt; }); }
  function byId(list, id) { return live(list).filter(function (r) { return r.id === id; })[0] || null; }

  /* ---------------- making and changing routines ---------------- */

  // input: { name, kind, startTime, steps: [{ title, durationMin, gapMin, habitId }] } -> { ok, errors, routine }
  function check(input, c) {
    const i = isObj(input) ? input : {}, errors = {};
    const name = str(i.name, NAME_MAX + 1);
    if (!name) errors.name = "Give the routine a name."; else if (name.length > NAME_MAX) errors.name = "Keep the name to " + NAME_MAX + " characters or fewer.";
    if (!isTime(i.startTime)) errors.startTime = "Pick the time it starts.";
    const raw = Array.isArray(i.steps) ? i.steps : [];
    const steps = raw.filter(function (s) { return isObj(s) && str(s.title, 1); }).map(function (s) { return cleanStep(s, c.makeId); }).filter(Boolean);
    if (!steps.length) errors.steps = "Add at least one step.";
    else if (steps.length > MAX_STEPS) errors.steps = "A routine can have up to " + MAX_STEPS + " steps.";
    raw.forEach(function (s) {
      if (!isObj(s) || !str(s.title, 1)) return;
      const d = Number(s.durationMin);
      if (!(isFinite(d) && d >= MIN_STEP_MIN && d <= MAX_STEP_MIN) && !errors.steps) errors.steps = "Each step takes " + MIN_STEP_MIN + " to " + MAX_STEP_MIN + " minutes (a step becomes a time block, and a block is at least " + MIN_STEP_MIN + " minutes).";
    });
    if (!errors.steps && !errors.startTime) { const end = toMin(i.startTime) + total(steps); if (end > 1439) errors.steps = "That does not fit in one day from " + i.startTime + ". Start earlier or shorten a step."; }
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, errors: {}, routine: { name: name, kind: KIND_IDS.indexOf(i.kind) !== -1 ? i.kind : "custom", startTime: i.startTime, steps: steps.slice(0, MAX_STEPS) } };
  }
  function total(steps) { return steps.reduce(function (n, s, k) { return n + (k ? s.gapMin : 0) + s.durationMin; }, 0); }

  function add(list, input, ctx) {
    const c = ctxOf(ctx), r = check(input, c);
    if (!r.ok) return { ok: false, list: list, errors: r.errors };
    if (live(list).length >= MAX_ROUTINES) return { ok: false, list: list, errors: { name: "That is the most routines (" + MAX_ROUTINES + "). Delete one first." } };
    const rec = Object.assign({ id: c.makeId("rt"), paused: false, applied: [], createdAt: c.now, updatedAt: c.now }, r.routine);
    return { ok: true, list: (list || []).concat([rec]), routine: rec };
  }
  function edit(list, id, input, ctx) {
    const c = ctxOf(ctx), cur = byId(list, id);
    if (!cur) return { ok: false, list: list, errors: { name: "That routine is not there any more." } };
    const r = check(input, c);
    if (!r.ok) return { ok: false, list: list, errors: r.errors };
    const next = Object.assign({}, cur, r.routine, { updatedAt: c.now });
    return { ok: true, list: list.map(function (x) { return x.id === id ? next : x; }), routine: next };
  }
  function duplicate(list, id, ctx) {
    const c = ctxOf(ctx), cur = byId(list, id);
    if (!cur) return { ok: false, list: list };
    if (live(list).length >= MAX_ROUTINES) return { ok: false, list: list, error: "That is the most routines (" + MAX_ROUTINES + ")." };
    const copy = Object.assign({}, cur, { id: c.makeId("rt"), name: str(cur.name + " copy", NAME_MAX), paused: false, applied: [], createdAt: c.now, updatedAt: c.now, steps: cur.steps.map(function (s) { return Object.assign({}, s, { id: c.makeId("rs") }); }) });
    delete copy.deletedAt;
    return { ok: true, list: list.concat([copy]), routine: copy };
  }
  function remove(list, id, ctx) {
    const c = ctxOf(ctx);
    if (!byId(list, id)) return { ok: false, list: list };
    return { ok: true, list: list.map(function (r) { return r.id === id ? Object.assign({}, r, { deletedAt: c.now, updatedAt: c.now }) : r; }) };
  }
  function setPaused(list, id, paused, ctx) {
    const c = ctxOf(ctx);
    if (!byId(list, id)) return { ok: false, list: list };
    return { ok: true, list: list.map(function (r) { return r.id === id ? Object.assign({}, r, { paused: !!paused, updatedAt: c.now }) : r; }) };
  }
  // A starter as the input for add(): same shape the form makes.
  function fromStarter(index) {
    const s = STARTERS[index];
    return s ? { name: s.name, kind: s.kind, startTime: s.startTime, steps: s.steps.map(function (x) { return { title: x[0], durationMin: x[1], gapMin: 0, habitId: "" }; }) } : null;
  }

  /* ---------------- laying a routine out on a day ---------------- */

  // The steps with their times from a start time. Sequential: each step starts after the one before it, plus its gap.
  // -> { ok, steps: [{ stepId, title, habitId, start, end, startMin, endMin }], endTime } | { ok: false, error }
  function layout(routine, startTime) {
    if (!routine || !isTime(startTime)) return { ok: false, error: "Pick the time it starts." };
    let at = toMin(startTime);
    const out = routine.steps.map(function (s, k) {
      if (k) at += s.gapMin;
      const a = at, b = at + s.durationMin;
      at = b;
      return { stepId: s.id, title: s.title, habitId: s.habitId, startMin: a, endMin: b, start: a <= 1439 ? toTime(a) : "", end: b <= 1439 ? toTime(b) : "" };
    });
    if (at > 1439) return { ok: false, error: "That does not fit in one day from " + startTime + "." };
    return { ok: true, steps: out, endTime: toTime(at) };
  }

  // The dates from `from` for `days` days whose weekday (0 = Sunday) is in `weekdays`. Never before `from`.
  function datesFor(from, days, weekdays) {
    const out = [], want = (Array.isArray(weekdays) ? weekdays : []).map(Number);
    if (!isDate(from)) return out;
    for (let i = 0; i < int(days, 1, 60, 7); i++) { const d = addDays(from, i); if (want.indexOf(weekday(d)) !== -1) out.push(d); }
    return out;
  }

  // What applying would do, without doing it. `existing` are the live blocks on the Calendar ({ date, title, start }); `habits` maps a habit id to its name.
  // -> { add: [{ date, title, start, end, stepId }], skipped: [{ date, title, reason }], habitSteps: [{ title, habitName }], error? }
  function planApply(routine, dates, startTime, existing, habits, today) {
    const lay = layout(routine, startTime);
    if (!lay.ok) return { ok: false, error: lay.error, add: [], skipped: [], habitSteps: [] };
    if (routine.paused) return { ok: false, error: "This routine is paused. Resume it to use it.", add: [], skipped: [], habitSteps: [] };
    const have = {};
    (Array.isArray(existing) ? existing : []).forEach(function (b) { if (b && isDate(b.date)) have[b.date + "|" + norm(b.title) + "|" + b.start] = true; });
    const add = [], skipped = [], habitSteps = [];
    lay.steps.filter(function (s) { return s.habitId; }).forEach(function (s) { habitSteps.push({ title: s.title, habitName: habits && habits[s.habitId] ? habits[s.habitId] : "a habit that is no longer there" }); });
    (Array.isArray(dates) ? dates : []).forEach(function (d) {
      if (!isDate(d) || (today && d < today)) { skipped.push({ date: d, title: "", reason: "That day has passed." }); return; }
      lay.steps.forEach(function (s) {
        if (s.habitId) return;
        if (have[d + "|" + norm(s.title) + "|" + s.start]) { skipped.push({ date: d, title: s.title, reason: "Already planned at " + s.start + "." }); return; }
        add.push({ date: d, title: s.title, start: s.start, end: s.end, stepId: s.stepId });
      });
    });
    return { ok: true, add: add, skipped: skipped, habitSteps: habitSteps };
  }

  /* ---------------- remembering what a routine put on the Calendar ---------------- */

  function recordApplied(list, id, entries, ctx) {
    const c = ctxOf(ctx);
    if (!byId(list, id)) return { ok: false, list: list };
    return { ok: true, list: list.map(function (r) { return r.id === id ? Object.assign({}, r, { applied: r.applied.concat(entries).slice(-MAX_APPLIED), updatedAt: c.now }) : r; }) };
  }
  // The blocks it put on days from `today` on: [{ date, blockId, stepId }]. Past days are never in this list.
  function futureApplied(routine, today) { return routine ? routine.applied.filter(function (a) { return a.date >= today; }) : []; }
  function forgetApplied(list, id, blockIds, ctx) {
    const c = ctxOf(ctx), gone = {};
    (blockIds || []).forEach(function (b) { gone[b] = true; });
    return { ok: true, list: list.map(function (r) { return r.id === id ? Object.assign({}, r, { applied: r.applied.filter(function (a) { return !gone[a.blockId]; }), updatedAt: c.now }) : r; }) };
  }

  function summary(r) {
    if (!r) return "";
    const n = r.steps.length, t = total(r.steps);
    return n + (n === 1 ? " step" : " steps") + " · " + (t >= 60 ? Math.floor(t / 60) + " h" + (t % 60 ? " " + (t % 60) + " min" : "") : t + " min");
  }

  return {
    KINDS: KINDS, STARTERS: STARTERS, MIN_STEP_MIN: MIN_STEP_MIN, NAME_MAX: NAME_MAX, MAX_STEPS: MAX_STEPS, clean: clean, live: live, byId: byId, check: check, add: add, edit: edit, duplicate: duplicate, remove: remove,
    setPaused: setPaused, fromStarter: fromStarter, layout: layout, datesFor: datesFor, planApply: planApply, recordApplied: recordApplied, futureApplied: futureApplied, forgetApplied: forgetApplied,
    summary: summary, total: total
  };
});
