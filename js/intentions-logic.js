/* ==========================================================================
   JARVIS — Weekly Intentions: the rules (pure functions; no page, storage or network, so they can be tested outside the browser).

   One record per week, in the plan's own storage (jarvisPlanIntentions, a list; backed up and merged like the other planner records):

     { id: "wi_" + the Monday, weekStart,
       doItems:   [ { text, done } x 3 ]            three things to start or do more of this week
       stopItems: [ { text, days: [7 booleans] } x 3 ]   three things to stop; days[0] is Monday ... days[6] is Sunday,
                                                          true = "I avoided it that day"
       wentWell, improve,                           the two reflection answers
       createdAt, updatedAt, deletedAt? }

   Rules:
     - A new week starts clean: the checkboxes and the daily marks are the week's own, so nothing has to be "reset". The words of
       this week's six slots are carried over from the latest earlier week you wrote anything in, so you only retype what changed.
       This is only a starting point that is shown; nothing is saved until you change something. Past weeks that were never filled
       in stay empty.
     - A week you filled in stays as it was (that is the history). Nothing is counted or scored for you beyond "x of y".
     - A box can only be ticked, and a day marked, on a slot with words in it, and a day that hasn't happened yet can't be marked.
     - Records this version doesn't understand are left alone by the callers (the plan store keeps them aside untouched).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan-logic"));
  else root.JarvisIntentionsLogic = factory(root.JarvisPlanLogic);
})(typeof self !== "undefined" ? self : this, function (PL) {
  "use strict";

  const SLOTS = 3, DAYS = 7, TEXT_MAX = 120, NOTE_MAX = 1000, HISTORY_MAX = 26;
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function oneLine(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function note(v) { return String(v === undefined || v === null ? "" : v).replace(/\r\n?/g, "\n").slice(0, NOTE_MAX); }
  function weekday(date) { return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)))).getUTCDay(); }
  function mondayOf(date) { return PL.addDays(date, -((weekday(date) + 6) % 7)); }
  function isMonday(date) { return PL.isDate(date) && weekday(date) === 1; }
  function weekId(weekStart) { return "wi_" + weekStart; }
  function live(records) { return (Array.isArray(records) ? records : []).filter(function (r) { return isObj(r) && typeof r.id === "string" && PL.isDate(r.weekStart) && !r.deletedAt; }); }
  function recordOf(records, weekStart) { return live(records).filter(function (r) { return r.id === weekId(weekStart); })[0] || null; }

  /* ---------------- reading a record (always exactly 3 + 3 slots) ---------------- */
  function readDays(v) {
    const out = [];
    for (let i = 0; i < DAYS; i++) out.push(Array.isArray(v) && v[i] === true);
    return out;
  }
  function read(rec) {
    const r = isObj(rec) ? rec : {}, doIn = Array.isArray(r.doItems) ? r.doItems : [], stopIn = Array.isArray(r.stopItems) ? r.stopItems : [];
    const doItems = [], stopItems = [];
    for (let i = 0; i < SLOTS; i++) {
      const d = isObj(doIn[i]) ? doIn[i] : {}, s = isObj(stopIn[i]) ? stopIn[i] : {};
      doItems.push({ text: oneLine(d.text, TEXT_MAX), done: d.done === true });
      stopItems.push({ text: oneLine(s.text, TEXT_MAX), days: readDays(s.days) });
    }
    return { weekStart: r.weekStart, doItems: doItems, stopItems: stopItems, wentWell: note(r.wentWell), improve: note(r.improve) };
  }
  function hasWords(c) { return c.doItems.some(function (x) { return x.text; }) || c.stopItems.some(function (x) { return x.text; }); }
  // Anything worth keeping in the history: words, a tick, a marked day, or a reflection.
  function hasContent(c) {
    return hasWords(c) || c.doItems.some(function (x) { return x.done; }) || c.stopItems.some(function (x) { return x.days.some(Boolean); }) || !!(c.wentWell.trim() || c.improve.trim());
  }

  /* ---------------- progress: only "x of y" ---------------- */
  // Only slots with words in them count; a slot you left empty is not "0 done".
  function progress(c) {
    const doFilled = c.doItems.filter(function (x) { return x.text; }), stopFilled = c.stopItems.filter(function (x) { return x.text; });
    const doDone = doFilled.filter(function (x) { return x.done; }).length;
    const stopMarked = stopFilled.reduce(function (n, x) { return n + x.days.filter(Boolean).length; }, 0), stopTotal = stopFilled.length * DAYS;
    return {
      doFilled: doFilled.length, doDone: doDone, doPct: doFilled.length ? Math.round((doDone / doFilled.length) * 100) : null,
      stopFilled: stopFilled.length, stopMarked: stopMarked, stopTotal: stopTotal, stopPct: stopTotal ? Math.round((stopMarked / stopTotal) * 100) : null
    };
  }

  /* ---------------- what a week shows ---------------- */
  // The words of the latest week before weekStart that has any (live records only), with fresh checkboxes and days.
  function carriedFrom(records, weekStart) {
    const before = live(records).filter(function (r) { return r.weekStart < weekStart && hasWords(read(r)); }).sort(function (a, b) { return a.weekStart < b.weekStart ? 1 : -1; })[0];
    if (!before) return null;
    const c = read(before);
    return {
      from: before.weekStart,
      doItems: c.doItems.map(function (x) { return { text: x.text, done: false }; }),
      stopItems: c.stopItems.map(function (x) { return { text: x.text, days: readDays() }; })
    };
  }
  // -> { weekStart, saved, carriedFrom, doItems, stopItems, wentWell, improve, progress }
  // A week that has a record shows it. A week with none shows the carried words (this week and later ones only; a past week that
  // was never filled in stays empty) with clean trackers.
  function view(records, weekStart, today) {
    const rec = recordOf(records, weekStart);
    if (rec) { const c = read(rec); return Object.assign({ weekStart: weekStart, saved: true, carriedFrom: null }, c, { progress: progress(c) }); }
    const c = read({ weekStart: weekStart });
    let from = null;
    if (!PL.isDate(today) || weekStart >= mondayOf(today)) {
      const carry = carriedFrom(records, weekStart);
      if (carry) { c.doItems = carry.doItems; c.stopItems = carry.stopItems; from = carry.from; }
    }
    return Object.assign({ weekStart: weekStart, saved: false, carriedFrom: from }, c, { progress: progress(c) });
  }

  /* ---------------- changing a week ---------------- */
  // change is one of:
  //   { type: "doText", index, text }          { type: "doDone", index, done }
  //   { type: "stopText", index, text }        { type: "stopDay", index, day (0 = Monday), value }
  //   { type: "reflection", field: "wentWell" | "improve", text }
  // ctx: { now, today }. -> { ok, records, record } or { ok: false, records, error } (the list is returned unchanged).
  function update(records, weekStart, change, ctx) {
    const c = ctx || {}, now = typeof c.now === "number" ? c.now : Date.now(), today = c.today, list = Array.isArray(records) ? records : [];
    const fail = function (error) { return { ok: false, records: list, error: error }; };
    if (!isMonday(weekStart)) return fail("A week starts on a Monday.");
    if (!isObj(change)) return fail("Nothing to change.");
    const base = view(list, weekStart, today);
    const doItems = base.doItems.map(function (x) { return { text: x.text, done: x.done }; });
    const stopItems = base.stopItems.map(function (x) { return { text: x.text, days: x.days.slice() }; });
    let wentWell = base.wentWell, improve = base.improve;
    const idx = Number(change.index), okIdx = Number.isInteger(idx) && idx >= 0 && idx < SLOTS;
    switch (change.type) {
      case "doText": if (!okIdx) return fail("There are three slots."); doItems[idx].text = oneLine(change.text, TEXT_MAX); break;
      case "stopText": if (!okIdx) return fail("There are three slots."); stopItems[idx].text = oneLine(change.text, TEXT_MAX); break;
      case "doDone":
        if (!okIdx) return fail("There are three slots.");
        if (!doItems[idx].text) return fail("Write what you want to do first.");
        doItems[idx].done = change.done === true; break;
      case "stopDay": {
        if (!okIdx) return fail("There are three slots.");
        const day = Number(change.day);
        if (!Number.isInteger(day) || day < 0 || day >= DAYS) return fail("That isn't a day of the week.");
        if (!stopItems[idx].text) return fail("Write what you want to stop first.");
        if (PL.isDate(today) && PL.addDays(weekStart, day) > today) return fail("That day hasn't happened yet.");
        stopItems[idx].days[day] = change.value === true; break;
      }
      case "reflection":
        if (change.field === "wentWell") wentWell = note(change.text);
        else if (change.field === "improve") improve = note(change.text);
        else return fail("Unknown question.");
        break;
      default: return fail("Unknown change.");
    }
    const id = weekId(weekStart), cur = list.filter(function (r) { return isObj(r) && r.id === id; })[0] || null;
    const next = Object.assign({}, cur || { id: id, weekStart: weekStart, createdAt: now }, { id: id, weekStart: weekStart, doItems: doItems, stopItems: stopItems, wentWell: wentWell, improve: improve, updatedAt: now });
    delete next.deletedAt;
    const out = cur ? list.map(function (r) { return r === cur ? next : r; }) : list.concat([next]);
    return { ok: true, records: out, record: next };
  }

  /* ---------------- history: the weeks before this one ---------------- */
  // Newest first. Only weeks with something in them; this week and later ones are not history.
  function history(records, today, limit) {
    const current = PL.isDate(today) ? mondayOf(today) : "9999-12-31";
    return live(records).filter(function (r) { return r.weekStart < current; })
      .map(function (r) { const c = read(r); return { weekStart: r.weekStart, doItems: c.doItems, stopItems: c.stopItems, wentWell: c.wentWell, improve: c.improve, progress: progress(c), has: hasContent(c) }; })
      .filter(function (w) { return w.has; })
      .sort(function (a, b) { return a.weekStart < b.weekStart ? 1 : -1; })
      .slice(0, typeof limit === "number" ? limit : HISTORY_MAX);
  }

  return {
    SLOTS: SLOTS, DAYS: DAYS, TEXT_MAX: TEXT_MAX, NOTE_MAX: NOTE_MAX, HISTORY_MAX: HISTORY_MAX, DAY_NAMES: DAY_NAMES, DAY_LETTERS: DAY_LETTERS,
    weekId: weekId, mondayOf: mondayOf, isMonday: isMonday, read: read, hasContent: hasContent, progress: progress, view: view, update: update, history: history
  };
});
