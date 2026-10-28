/* ==========================================================================
   JARVIS — Discipline tracker: the rules (pure functions, no page access, so
   they can be tested outside the browser).

   Everything here comes from what you typed in. Nothing is estimated, guessed
   or filled in for you, and no AI is involved.

   The daily score (out of 100):
     Following through on priorities   30   the one task that makes the day a win counts double,
                                            each other priority (up to 3) counts once
     Focus and phone                   20   focus rating 10, phone time against your limit 10
     Time management                   15   how closely you kept your plan, rated 1-5
     School and business               15   school work 7, a business block that made something 8
     Healthy routines                  10   bed on time 4, phone out of the bedroom 3, trained or rested as planned 3
     Reflection                        10   a morning plan saved 4, the evening questions answered 6

   An item marked "not today" (sick, exam, planned rest, travel...) is left out
   of both what you earned and what was possible, so the score is out of what
   was attainable that day. Days with excused items are counted and shown in
   the trends, so they can't hide. A day is scored only once every item is
   answered; a day with no review has no score (it is never counted as zero).

   Two more review questions (followed your planned routine, managed your
   distractions) are recorded and shown in Trends but are not part of the score:
   the model above is unchanged.

   Each saved review remembers which version of this model scored it
   (review.rubric) and what it came to when it was saved (review.scored: the
   score, the points earned out of the points that were attainable, which items
   were left out, each category), together with the phone limit it was scored
   against. Changing the model or a setting later therefore never rewrites a
   past day; only changing that day's own answers or plan does.

   Accountability (what to do next, why you're avoiding something, your own
   rules, the weekly summary) is also plain rules over what was entered, with
   fixed advice text. It is not AI and it never invents numbers.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisDisciplineLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORIES = [
    { key: "followThrough", label: "Following through", max: 30 },
    { key: "focus", label: "Focus and phone", max: 20 },
    { key: "time", label: "Time management", max: 15 },
    { key: "consistency", label: "School and business", max: 15 },
    { key: "routines", label: "Healthy routines", max: 10 },
    { key: "reflection", label: "Reflection", max: 10 }
  ];

  // Yes/no items (answered "done", "not" or "na" = not today).
  const ITEMS = {
    school: { label: "School work", category: "consistency", points: 7 },
    gratiel: { label: "Business block that made something", category: "consistency", points: 8 },
    bedOnTime: { label: "Bed on time", category: "routines", points: 4 },
    phoneOut: { label: "Phone out of the bedroom", category: "routines", points: 3 },
    training: { label: "Trained or rested as planned", category: "routines", points: 3 }
  };
  // The version of the scoring model written onto each review when it is saved. A future change to the points
  // above gets a new number, and a review keeps the number it was scored under.
  const RUBRIC_VERSION = 1;
  const PHONE_POINTS = 10;
  const FOCUS_POINTS = 10;
  const PLAN_POINTS = 4;
  const NOTES_POINTS = 6;
  const NOTE_FIELDS = ["procrastinated", "distractions", "wentWell", "improve"];

  // Optional tag on a priority, so Trends can say where the day's effort went. A fixed list keeps the counts clean.
  const TASK_CATEGORIES = [
    { key: "school", label: "School" }, { key: "business", label: "Business" }, { key: "training", label: "Training" },
    { key: "personal", label: "Personal" }, { key: "other", label: "Other" }
  ];
  // Plain starting points for the planning steps. They are offered, never filled in over what you typed, and not advice from AI.
  const DISTRACTION_RESPONSES = [
    "Phone in another room while I work",
    "Block the app or site for the day",
    "Work somewhere else",
    "Work in 25-minute blocks with the phone away"
  ];
  const IF_THEN_EXAMPLES = [
    "If I get home from school, then I put my phone away and start my homework.",
    "If I reach for my phone, then I do two minutes of my main win first.",
    "If it is 3:45 pm, then I start my main win before anything else.",
    "If I finish dinner, then I plan tomorrow and charge my phone outside my room."
  ];
  // Review questions that are recorded and shown in Trends but are not part of the score (the model is unchanged).
  const EXTRA_ITEMS = {
    routine: { label: "Followed your planned routine" },
    managed: { label: "Managed your distractions" }
  };

  // Which items a kind of day usually excuses. Only a starting point: each can still be changed.
  const DAY_TYPES = {
    normal: { label: "Normal day", na: [] },
    exam: { label: "Exam or heavy school day", na: ["gratiel"] },
    sick: { label: "Sick or recovering", na: ["gratiel", "training", "phone"] },
    rest: { label: "Planned rest day", na: ["training"] },
    travel: { label: "Travel or event day", na: ["gratiel", "training"] }
  };

  // Why something is being avoided, what to do right now about it, and a rule that would prevent it next time.
  const REASONS = [
    { key: "big", label: "It feels too big or unclear", first: "Write the first three steps. Do only step 1 for two minutes.", rule: "Write the first step of every priority before I start the day." },
    { key: "boring", label: "It's boring or I'm dreading it", first: "Phone in another room and a 10-minute timer. You only owe the 10 minutes.", rule: "Do the task I'm dreading first, before anything fun." },
    { key: "afraid", label: "I'm afraid it won't be good", first: "Make the worst possible version for five minutes. Fix it later, not while making it.", rule: "Make a rough version first and improve it in a second block." },
    { key: "tired", label: "I'm tired or low on energy", first: "Do two minutes. If you're still wiped after that, do the minimum version, not nothing.", rule: "Do the hard task right after school, before the energy dip." },
    { key: "phone", label: "My phone keeps pulling me", first: "Put the phone in another room right now, then start a 10-minute timer.", rule: "Phone goes on the charger in another room when I get home." },
    { key: "didnt", label: "I just didn't start", first: "Start the two-minute timer now. Starting is the whole job.", rule: "Do two minutes of the key task before I touch my phone." }
  ];
  const EXCUSES = [
    { key: "tomorrow", label: "I'll do it tomorrow", challenge: "Tomorrow-you has the same phone and the same excuse. Do two minutes now, and pick a start time for the rest." },
    { key: "tired", label: "I'm too tired", challenge: "Tired is a reason to shrink the task, not skip it. Do two minutes, then decide." },
    { key: "break", label: "I deserve a break", challenge: "A break is earned after the block, not before it. Do the block, then take the break." },
    { key: "ready", label: "I'll start when I feel ready", challenge: "Feeling ready usually shows up after you start. Start for two minutes." },
    { key: "phone", label: "I'll just check my phone first", challenge: "Checking first is how hours disappear. Task first; phone after the timer." },
    { key: "skip", label: "One skipped day won't matter", challenge: "One skipped day rarely matters. A habit of skipping does. Do the minimum version." }
  ];
  // A starting rule for each scoring area, offered when that area is the weak one.
  const AREA_RULES = {
    followThrough: "Plan tomorrow's key task before bed.",
    focus: "Phone goes on the charger in another room when I get home.",
    time: "Write a start time next to every priority.",
    consistency: "Do my school work before my phone on school days.",
    routines: "My phone charges outside my bedroom every night.",
    reflection: "Do my evening review before I open any app for fun."
  };
  const STARTER_RULES = [AREA_RULES.consistency, AREA_RULES.routines, AREA_RULES.followThrough];
  const DEFAULT_TIMES = { planBy: "06:30", afterSchool: "15:45", review: "20:30" };
  const MAX_RULES = 5;
  const RULE_MAX = 100;
  const AVOID_CAP = 300;
  const START_MINUTES = 2;

  const PRIORITY_MAX = 100;
  const NOTE_MAX = 240;
  const REFLECT_MAX = 240; // one optional answer per program day
  const DEFAULT_PHONE_LIMIT = 5;
  const MIN_NOTE_CHARS = 3;
  const MIN_DAYS_FOR_AVERAGES = 3;
  const MIN_DAYS_FOR_WEEKDAYS = 14;

  /* ---------------- dates (plain YYYY-MM-DD strings, never parsed as UTC instants) ---------------- */

  function isISODate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekdayOf(iso) { return new Date(iso + "T00:00:00Z").getUTCDay(); } // 0 = Sunday
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }

  /* ---------------- cleaning what is stored or typed ---------------- */

  function clean(v, max) {
    return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  }
  function rating(v) {
    const n = Number(v);
    return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  }
  function hours(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 && n <= 24 ? Math.round(n * 10) / 10 : null;
  }
  function limit(v) {
    const n = Number(v);
    return isFinite(n) && n >= 0.5 && n <= 24 ? Math.round(n * 10) / 10 : DEFAULT_PHONE_LIMIT;
  }
  function state(v) { return v === "done" || v === "not" || v === "na" ? v : null; }
  function stamp(v) { return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : Date.now(); }

  function timeOfDay(v, fallback) {
    const m = typeof v === "string" ? v.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/) : null;
    return m ? (m[1].length === 1 ? "0" + m[1] : m[1]) + ":" + m[2] : fallback;
  }
  function minutesOf(hhmm) { const p = hhmm.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  function sanitizeTimes(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return { planBy: timeOfDay(r.planBy, DEFAULT_TIMES.planBy), afterSchool: timeOfDay(r.afterSchool, DEFAULT_TIMES.afterSchool), review: timeOfDay(r.review, DEFAULT_TIMES.review) };
  }
  function keyOf(list, key) { return list.some(function (x) { return x.key === key; }) ? key : ""; }

  // Your own rules: [{ id, text }], at most MAX_RULES, no blanks or repeats.
  function sanitizeRules(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      const text = clean(r && r.text, RULE_MAX);
      if (!text || out.length >= MAX_RULES) return;
      if (out.some(function (x) { return x.text.toLowerCase() === text.toLowerCase(); })) return;
      const id = typeof (r && r.id) === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) && !out.some(function (x) { return x.id === r.id; }) ? r.id : "r" + Date.now().toString(36) + out.length;
      out.push({ id: id, text: text });
    });
    return out;
  }

  // Times you sat down to start something you were avoiding, and what came of it.
  function sanitizeAvoid(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (a) {
      if (!a || typeof a !== "object" || !isISODate(a.date)) return;
      out.push({
        at: stamp(a.at), date: a.date, task: clean(a.task, PRIORITY_MAX),
        reason: keyOf(REASONS, a.reason), excuse: keyOf(EXCUSES, a.excuse),
        outcome: a.outcome === "started" || a.outcome === "dropped" ? a.outcome : null
      });
    });
    return out.slice(-AVOID_CAP);
  }

  // The running start timer, or null. endsAt is worked out from the start, so it stays right if the app is closed.
  function sanitizeTimer(raw) {
    if (!raw || typeof raw !== "object" || !(Number(raw.startedAt) > 0)) return null;
    const minutes = Math.round(Number(raw.minutes));
    if (!(minutes >= 1 && minutes <= 60)) return null;
    return {
      task: clean(raw.task, PRIORITY_MAX), taskId: /^(key|p[0-2])$/.test(raw.taskId) ? raw.taskId : "",
      reason: keyOf(REASONS, raw.reason), excuse: keyOf(EXCUSES, raw.excuse),
      entryAt: Number(raw.entryAt) > 0 ? Number(raw.entryAt) : 0, // which avoid-log entry this run belongs to, if any
      startedAt: Number(raw.startedAt), minutes: minutes, endsAt: Number(raw.startedAt) + minutes * 60000
    };
  }

  // The 30-day program: the day it started, which of each day's own-word missions were ticked ({ "3": [0, 2] }), and the
  // optional reflection written for each day ({ "3": "text" }). Both are keyed by program day (1-30).
  function sanitizeProgram(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const done = {};
    Object.keys(r.done && typeof r.done === "object" ? r.done : {}).forEach(function (k) {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 1 || n > 30 || !Array.isArray(r.done[k])) return;
      const picked = r.done[k].filter(function (i, at, all) { return Number.isInteger(i) && i >= 0 && i <= 9 && all.indexOf(i) === at; });
      if (picked.length) done[String(n)] = picked.sort();
    });
    const reflections = {};
    const rf = r.reflections && typeof r.reflections === "object" && !Array.isArray(r.reflections) ? r.reflections : {};
    Object.keys(rf).forEach(function (k) {
      const n = Number(k);
      const text = typeof rf[k] === "string" ? clean(rf[k], REFLECT_MAX) : "";
      if (Number.isInteger(n) && n >= 1 && n <= 30 && text) reflections[String(n)] = text;
    });
    return { start: isISODate(r.start) ? r.start : null, done: done, reflections: reflections };
  }

  // The calendar day (on this device) a rule was added, read from its id, or null if the id doesn't say. Rules made by
  // this app get "r" + the time in base 36 (8 characters until 2059) + an optional counter.
  function ruleAddedDate(rule) {
    const m = rule && typeof rule.id === "string" ? rule.id.match(/^r([0-9a-z]{8})/) : null;
    const ms = m ? parseInt(m[1], 36) : NaN;
    if (!(ms > 1577836800000 && ms < 4102444800000)) return null; // between 2020 and 2100, else it isn't one of ours
    const d = new Date(ms);
    const p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }

  // One planned item: its text, whether it is done, and an optional due time and category.
  function sanitizeTask(raw) {
    const p = raw && typeof raw === "object" ? raw : {};
    const text = clean(p.text, PRIORITY_MAX);
    return { text: text, done: !!text && p.done === true, due: text ? timeOfDay(p.due, "") : "", category: text ? keyOf(TASK_CATEGORIES, p.category) : "" };
  }

  function sanitizeMorning(raw) {
    if (!raw || typeof raw !== "object") return null;
    const list = Array.isArray(raw.priorities) ? raw.priorities : [];
    const priorities = [];
    for (let i = 0; i < 3; i++) priorities.push(sanitizeTask(list[i]));
    const savedAt = stamp(raw.savedAt);
    return {
      priorities: priorities,
      keyTask: sanitizeTask(raw.keyTask),
      distraction: clean(raw.distraction, NOTE_MAX),
      response: clean(raw.response, 120),
      plan: clean(raw.plan, NOTE_MAX),
      savedAt: savedAt,
      // When the priorities last changed. A plan changed after its day was scored is flagged on the score card.
      editedAt: raw.editedAt ? stamp(raw.editedAt) : savedAt
    };
  }

  // How the Habits routine stood when a review was saved: counts only, or null (no habits, or an older review).
  function sanitizeRoutineCounts(raw) {
    if (!raw || typeof raw !== "object") return null;
    const total = Math.round(Number(raw.total)), done = Math.round(Number(raw.done)), open = Math.round(Number(raw.open));
    if (!(total >= 1 && total <= 200 && done >= 0 && open >= 0 && done + open === total)) return null;
    return { done: done, open: open, total: total };
  }

  // What a review came to when it was saved, or null (an older review that has not been backfilled yet).
  function sanitizeScored(raw) {
    if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.score)) || !Number.isFinite(Number(raw.possible)) || Number(raw.possible) <= 0) return null;
    const cats = Array.isArray(raw.categories) ? raw.categories : [];
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(raw.score)))),
      earned: round1(Math.max(0, Number(raw.earned) || 0)),
      possible: Math.round(Number(raw.possible) * 10) / 10,
      excused: (Array.isArray(raw.excused) ? raw.excused : []).slice(0, 10).map(function (x) { return clean(x, 60); }).filter(Boolean),
      categories: cats.slice(0, 12).map(function (c) {
        return { key: clean(c && c.key, 30), earned: round1(Math.max(0, Number(c && c.earned) || 0)), possible: Math.max(0, Number(c && c.possible) || 0) };
      }).filter(function (c) { return c.key; }),
      at: stamp(raw.at)
    };
  }

  function sanitizeReview(raw) {
    if (!raw || typeof raw !== "object") return null;
    const items = {};
    Object.keys(ITEMS).concat(["phone"]).forEach(function (k) { items[k] = state(raw.items && raw.items[k]); });
    const review = {
      screenHours: hours(raw.screenHours),
      phoneLimit: limit(raw.phoneLimit),
      items: items,
      focus: rating(raw.focus),
      time: rating(raw.time),
      output: clean(raw.output, NOTE_MAX),
      blocker: keyOf(REASONS, raw.blocker),
      extras: { routine: state(raw.extras && raw.extras.routine), managed: state(raw.extras && raw.extras.managed) },
      habits: sanitizeRoutineCounts(raw.habits),
      rules: [],
      rubric: Number.isInteger(raw.rubric) && raw.rubric >= 1 ? raw.rubric : RUBRIC_VERSION,
      scored: sanitizeScored(raw.scored),
      savedAt: stamp(raw.savedAt)
    };
    (Array.isArray(raw.rules) ? raw.rules : []).slice(0, MAX_RULES).forEach(function (r) {
      const text = clean(r && r.text, RULE_MAX);
      if (text) review.rules.push({ id: clean(r.id, 40), text: text, state: state(r.state) });
    });
    NOTE_FIELDS.forEach(function (f) { review[f] = clean(raw[f], NOTE_MAX); });
    return review;
  }

  function sanitizeDay(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    return {
      type: DAY_TYPES[d.type] ? d.type : "normal",
      morning: sanitizeMorning(d.morning),
      review: sanitizeReview(d.review)
    };
  }

  // Half-finished morning plans and evening reviews, kept per date so nothing typed is lost to a refresh, a switch to
  // another screen, the phone locking or midnight passing. Only the newest few dates are kept.
  const DRAFT_KEEP = 10;
  const DRAFT_NOTE_KEYS = ["output"].concat(NOTE_FIELDS);
  function sanitizeDrafts(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    Object.keys(src).filter(isISODate).sort().slice(-DRAFT_KEEP).forEach(function (date) {
      const plain = function (v) { return !!v && typeof v === "object" && !Array.isArray(v); };
      const d = plain(src[date]) ? src[date] : {};
      const entry = {};
      const m = d.morning;
      if (plain(m)) {
        const p = Array.isArray(m.p) ? m.p : [];
        const d4 = Array.isArray(m.d) ? m.d : [], c4 = Array.isArray(m.c) ? m.c : [];
        entry.morning = {
          key: clean(m.key, PRIORITY_MAX), p: [0, 1, 2].map(function (i) { return clean(p[i], PRIORITY_MAX); }),
          d: [0, 1, 2, 3].map(function (i) { return timeOfDay(d4[i], ""); }), c: [0, 1, 2, 3].map(function (i) { return keyOf(TASK_CATEGORIES, c4[i]); }),
          distraction: clean(m.distraction, NOTE_MAX), response: clean(m.response, 120), plan: clean(m.plan, NOTE_MAX), at: stamp(m.at)
        };
      }
      const r = d.review;
      if (plain(r)) {
        const items = {};
        Object.keys(ITEMS).concat(["phone"]).forEach(function (k) { items[k] = state(r.items && r.items[k]); });
        const rules = {};
        const rr = r.rules && typeof r.rules === "object" && !Array.isArray(r.rules) ? r.rules : {};
        Object.keys(rr).slice(0, MAX_RULES * 2).forEach(function (id) { const st = state(rr[id]); const key = clean(id, 40); if (st && key) rules[key] = st; });
        const notes = {};
        DRAFT_NOTE_KEYS.forEach(function (k) { notes[k] = clean(r.notes && r.notes[k], NOTE_MAX); });
        const extras = { routine: state(r.extras && r.extras.routine), managed: state(r.extras && r.extras.managed) };
        entry.review = { items: items, extras: extras, focus: rating(r.focus), time: rating(r.time), rules: rules, screenHours: clean(r.screenHours, 6), notes: notes, at: stamp(r.at) };
      }
      if (typeof d.reflect === "string") entry.reflect = clean(d.reflect, REFLECT_MAX); // an unsaved program reflection for the program day on this date
      if (entry.morning || entry.review || entry.reflect !== undefined) out[date] = entry;
    });
    return out;
  }

  // The whole saved object: { settings: { phoneLimit }, days: { "YYYY-MM-DD": day } }. Bad dates and junk are dropped.
  function sanitizeStore(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const days = {};
    Object.keys(r.days && typeof r.days === "object" ? r.days : {}).forEach(function (date) {
      if (!isISODate(date)) return;
      const day = sanitizeDay(r.days[date]);
      if (day.morning || day.review || day.type !== "normal") days[date] = day;
    });
    return {
      settings: { phoneLimit: limit(r.settings && r.settings.phoneLimit), times: sanitizeTimes(r.settings && r.settings.times) },
      rules: sanitizeRules(r.rules), avoid: sanitizeAvoid(r.avoid), timer: sanitizeTimer(r.timer),
      program: sanitizeProgram(r.program),
      drafts: sanitizeDrafts(r.drafts),
      days: days
    };
  }

  /* ---------------- the daily score ---------------- */

  // What still has to be answered before a day can be scored (keys: "focus", "time", an item key, or "phone").
  function unanswered(review) {
    const out = [];
    if (review.focus === null) out.push("focus");
    if (review.time === null) out.push("time");
    if (review.items.phone !== "na" && review.screenHours === null) out.push("phone");
    Object.keys(ITEMS).forEach(function (k) { if (review.items[k] === null) out.push(k); });
    return out;
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  // -> { complete: false, score: null, missing: [...] } until every item is answered, then
  //    { complete: true, score, earned, possible, categories: [{ key, label, max, earned, possible }],
  //      excused: [labels], gap, strong, detail }
  function scoreDay(rawDay) {
    const day = sanitizeDay(rawDay);
    const review = day.review;
    if (!review) return { complete: false, score: null, missing: ["review"] };
    const missing = unanswered(review);
    if (missing.length) return { complete: false, score: null, missing: missing };

    const cats = {};
    CATEGORIES.forEach(function (c) { cats[c.key] = { key: c.key, label: c.label, max: c.max, earned: 0, possible: 0 }; });
    const excused = [];

    // Following through: the key task counts double.
    const m = day.morning;
    let doneWeight = 0, totalWeight = 0, prioritiesDone = 0, prioritiesTotal = 0;
    if (m) {
      if (m.keyTask.text) { totalWeight += 2; if (m.keyTask.done) doneWeight += 2; }
      m.priorities.forEach(function (p) {
        if (!p.text) return;
        prioritiesTotal++; totalWeight += 1;
        if (p.done) { prioritiesDone++; doneWeight += 1; }
      });
    }
    cats.followThrough.possible = 30;
    cats.followThrough.earned = totalWeight ? 30 * doneWeight / totalWeight : 0;

    // Focus and phone.
    cats.focus.possible += FOCUS_POINTS;
    cats.focus.earned += FOCUS_POINTS * (review.focus - 1) / 4;
    if (review.items.phone === "na") {
      excused.push("Phone time");
    } else {
      cats.focus.possible += PHONE_POINTS;
      const over = Math.max(0, review.screenHours - review.phoneLimit);
      cats.focus.earned += PHONE_POINTS * Math.max(0, 1 - over / review.phoneLimit);
    }

    // Time management.
    cats.time.possible = 15;
    cats.time.earned = 15 * (review.time - 1) / 4;

    // Yes/no items.
    Object.keys(ITEMS).forEach(function (k) {
      const item = ITEMS[k];
      const s = review.items[k];
      if (s === "na") { excused.push(item.label); return; }
      cats[item.category].possible += item.points;
      if (s === "done") cats[item.category].earned += item.points;
    });

    // Reflection.
    const planned = !!m && (!!m.keyTask.text || m.priorities.some(function (p) { return !!p.text; }));
    cats.reflection.possible = PLAN_POINTS + NOTES_POINTS;
    cats.reflection.earned = (planned ? PLAN_POINTS : 0);
    const answered = NOTE_FIELDS.filter(function (f) { return review[f].length >= MIN_NOTE_CHARS; }).length;
    cats.reflection.earned += NOTES_POINTS * answered / NOTE_FIELDS.length;

    const list = CATEGORIES.map(function (c) { return cats[c.key]; });
    const earned = list.reduce(function (s, c) { return s + c.earned; }, 0);
    const possible = list.reduce(function (s, c) { return s + c.possible; }, 0);
    const categories = list.map(function (c) { return { key: c.key, label: c.label, max: c.max, earned: round1(c.earned), possible: c.possible }; });

    let gap = null;
    let gapRatio = 1;
    list.forEach(function (c) {
      if (!c.possible) return;
      const ratio = c.earned / c.possible;
      if (ratio < gapRatio - 1e-9) { gapRatio = ratio; gap = { key: c.key, label: c.label, earned: round1(c.earned), possible: c.possible }; }
    });
    const strong = list.filter(function (c) { return c.possible && c.earned / c.possible >= 0.9; }).map(function (c) { return c.label; });

    return {
      complete: true,
      score: Math.round(100 * earned / possible),
      earned: round1(earned), possible: possible,
      categories: categories, excused: excused, gap: gap, strong: strong,
      detail: { prioritiesDone: prioritiesDone, prioritiesTotal: prioritiesTotal, keyTaskDone: !!(m && m.keyTask.text && m.keyTask.done), keyTaskSet: !!(m && m.keyTask.text), planned: planned, notesAnswered: answered }
    };
  }

  // The part of a score that is kept with the review it belongs to.
  function scoreSnapshot(result) {
    return sanitizeScored({ score: result.score, earned: result.earned, possible: result.possible, excused: result.excused, categories: result.categories, at: Date.now() });
  }

  // Reviews saved before snapshots existed have none. Each complete one is stamped with what it scores right now under
  // its own rubric, which is exactly what the app has been showing for it. Returns how many were stamped.
  function backfillSnapshots(store) {
    let n = 0;
    Object.keys(store.days).forEach(function (date) {
      const day = store.days[date];
      if (!day.review || day.review.scored) return;
      const r = scoreDay(day);
      if (!r.complete) return;
      day.review.scored = scoreSnapshot(r);
      day.review.scored.at = day.review.savedAt;
      n++;
    });
    return n;
  }

  // Which items to pre-mark "not today" for a kind of day (before any answer is given).
  function excusedFor(type) { return (DAY_TYPES[type] || DAY_TYPES.normal).na.slice(); }

  /* ---------------- streaks, gaps, trends ---------------- */

  function isScored(days, date) { return !!days[date] && scoreDay(days[date]).complete; }

  // Consecutive scored days ending today, or yesterday while today hasn't been scored yet.
  function reviewStreak(days, todayISO) {
    let cursor = isScored(days, todayISO) ? todayISO : addDays(todayISO, -1);
    let n = 0;
    while (isScored(days, cursor)) { n++; cursor = addDays(cursor, -1); }
    return n;
  }

  // The most recent scored day on or before todayISO: { date, score } or null.
  function lastScored(days, todayISO) {
    const dates = Object.keys(days).filter(function (d) { return d <= todayISO && isScored(days, d); }).sort();
    if (!dates.length) return null;
    const date = dates[dates.length - 1];
    return { date: date, score: scoreDay(days[date]).score };
  }

  // Summary of the last `windowDays` days ending today.
  function trendSummary(days, todayISO, windowDays) {
    const all = Object.keys(days).filter(function (d) { return days[d].morning || days[d].review; }).sort();
    const firstUse = all.length ? all[0] : null;
    const daily = [];
    const results = [];
    let missed = 0;
    for (let i = windowDays - 1; i >= 0; i--) {
      const date = addDays(todayISO, -i);
      const day = days[date];
      const result = day ? scoreDay(day) : null;
      const scored = !!(result && result.complete);
      if (scored) results.push({ date: date, result: result, day: sanitizeDay(day) });
      // A day is "missed" once it has passed without a scored review, from the first day anything was logged.
      if (!scored && date < todayISO && firstUse && date >= firstUse) missed++;
      daily.push({ date: date, score: scored ? result.score : null, planned: !!(day && day.morning), reviewed: scored, type: day ? day.type : "normal" });
    }
    const enough = results.length >= MIN_DAYS_FOR_AVERAGES;
    const scores = results.map(function (r) { return r.result.score; });
    let best = null, worst = null;
    results.forEach(function (r) {
      if (!best || r.result.score > best.score) best = { date: r.date, score: r.result.score };
      if (!worst || r.result.score < worst.score) worst = { date: r.date, score: r.result.score };
    });

    let categories = null;
    if (enough) {
      categories = CATEGORIES.map(function (c) {
        let sum = 0, n = 0;
        results.forEach(function (r) {
          const cat = r.result.categories.filter(function (x) { return x.key === c.key; })[0];
          if (cat && cat.possible) { sum += cat.earned / cat.possible; n++; }
        });
        return { key: c.key, label: c.label, pct: n ? Math.round(100 * sum / n) : null, days: n };
      });
    }
    let weakest = null;
    if (categories) categories.forEach(function (c) { if (c.pct !== null && (!weakest || c.pct < weakest.pct)) weakest = c; });

    const phoneDays = results.filter(function (r) { return r.day.review.items.phone !== "na" && r.day.review.screenHours !== null; });
    const phone = {
      days: phoneDays.length,
      averageHours: phoneDays.length ? round1(phoneDays.reduce(function (s, r) { return s + r.day.review.screenHours; }, 0) / phoneDays.length) : null,
      overLimit: phoneDays.filter(function (r) { return r.day.review.screenHours > r.day.review.phoneLimit; }).length
    };

    let weekdays = null, weakestWeekday = null;
    if (results.length >= MIN_DAYS_FOR_WEEKDAYS) {
      weekdays = [0, 1, 2, 3, 4, 5, 6].map(function (w) {
        const list = results.filter(function (r) { return weekdayOf(r.date) === w; });
        return { weekday: w, days: list.length, average: list.length ? Math.round(list.reduce(function (s, r) { return s + r.result.score; }, 0) / list.length) : null };
      });
      weekdays.forEach(function (w) { if (w.days >= 2 && (!weakestWeekday || w.average < weakestWeekday.average)) weakestWeekday = w; });
    }

    return {
      windowDays: windowDays,
      scoredDays: results.length,
      enough: enough,
      average: enough ? Math.round(scores.reduce(function (s, x) { return s + x; }, 0) / scores.length) : null,
      best: best, worst: worst,
      categories: categories, weakest: weakest,
      phone: phone,
      missed: missed,
      excusedDays: results.filter(function (r) { return r.result.excused.length > 0; }).length,
      daily: daily,
      weekdays: weekdays, weakestWeekday: weakestWeekday
    };
  }

  /* ---------------- accountability ---------------- */

  function firstUseDate(days) {
    const dates = Object.keys(days).filter(function (d) { return days[d].morning || days[d].review; }).sort();
    return dates.length ? dates[0] : null;
  }
  // Does a plan note read as an if-then: a trigger word ("if", "when", "after"...) and an action ("then", "I will"...)?
  // It checks the wording, not whether the plan is followed.
  const IF_WORD = /\b(if|when|whenever|after|once)\b/i;
  const THEN_WORD = /\b(then|i will|i'll|i am going to|i'm going to)\b/i;
  function hasIfThen(text) { return typeof text === "string" && IF_WORD.test(text) && THEN_WORD.test(text); }
  function hasPlanItems(m) { return !!m && (!!m.keyTask.text || m.priorities.some(function (p) { return !!p.text; })); }

  // The one thing to do right now, from the time of day and what has actually been entered.
  //   input: { todayISO, minutes (since midnight, local), days, settings: { times } }
  //   -> { kind, title, text, task: { id, text } | null, actions: [...] }   actions are ids the screen knows:
  //      "plan", "scoreYesterday", "start", "avoid", "review", "planTomorrow"
  // What to do next, from the time of day, the saved times, today's plan, what is still open, the program's missions
  // and whether the review is done. -> { kind, title, text, why, task, actions: [primary buttons], more: [other
  // things that could be done now] }. Plain rules and fixed wording; it only ever suggests, nothing is sent or forced.
  //   input.missions (optional): { total, done, nextText } for today's program missions that still need a tick
  //   input.routine  (optional): { open, text } from the Habits routine: how many habits are still open today, and a line naming them
  function nextUp(input) {
    const days = input.days;
    const times = sanitizeTimes(input.settings && input.settings.times);
    const first = firstUseDate(days);
    const today = sanitizeDay(days[input.todayISO]);
    const yesterday = addDays(input.todayISO, -1);
    const evening = input.minutes >= minutesOf(times.review);
    const planned = hasPlanItems(today.morning);
    const tomorrowPlanned = hasPlanItems(sanitizeDay(days[addDays(input.todayISO, 1)]).morning);
    const scoredToday = isScored(days, input.todayISO);
    const mission = input.missions && input.missions.total > input.missions.done ? input.missions : null;
    const routine = input.routine && input.routine.open > 0 ? input.routine : null;

    // Everything else that makes sense right now, so the person can always pick something other than the suggestion.
    function others(primary) {
      const list = [];
      if (!planned) list.push("plan");
      if (!scoredToday) list.push("review");
      if (planned && openItems(today.morning)) list.push("avoid");
      if (routine) list.push("routine");
      if (mission) list.push("mission");
      if (!tomorrowPlanned) list.push("planTomorrow");
      return list.filter(function (k) { return primary.indexOf(k) === -1; });
    }
    function make(o) { o.more = others(o.actions); return o; }

    if (!first) return make({ kind: "plan", title: "Start with a morning plan", text: "Two minutes: the one task that makes today a win, and up to three more.", why: "A decision made before the day starts is the easiest one to keep.", task: null, actions: ["plan"] });
    if (yesterday >= first && !isScored(days, yesterday)) {
      return make({ kind: "missed", title: "Score yesterday first", text: "One miss is data, two is a pattern. A rough, honest review is enough.", why: "Without it there is a gap in your record, and Trends can only show what you entered.", task: null, actions: ["scoreYesterday"] });
    }
    if (scoredToday) {
      if (!tomorrowPlanned) return make({ kind: "planTomorrow", title: "Plan tomorrow tonight", text: "Decide the key task and a start time now, so tomorrow's first minutes are already settled.", why: "It takes away tomorrow's first decision, which is usually the hardest.", task: null, actions: ["planTomorrow"] });
      return make({ kind: "done", title: "Today is done and tomorrow is planned", text: "Protect your sleep.", why: "Sleep is part of the system, not a reward for finishing it.", task: null, actions: [] });
    }
    if (!planned) {
      if (evening) return make({ kind: "review", title: "No plan was set today", text: "Score the day anyway, honestly. The review is where the learning is.", why: "A day without a plan is still a day you can learn from.", task: null, actions: ["review"] });
      return make({ kind: "plan", title: "Lock in today's plan", text: "Two minutes. Decide what makes today a win before the day decides for you.", why: "Unplanned time tends to go to whatever is easiest, not whatever matters.", task: null, actions: ["plan"] });
    }
    if (evening) return make({ kind: "review", title: "Evening review time", text: "Score your day while it's fresh. Then plan tomorrow.", why: "Your answers are what Trends is built from; the sooner you write them, the more accurate they are.", task: null, actions: ["review"] });
    const m = today.morning;
    if (m.keyTask.text && !m.keyTask.done) {
      const late = input.minutes >= minutesOf(times.afterSchool);
      return make({ kind: "win", title: m.keyTask.text, text: late ? "This is what makes today a win. Start it before anything else." : "This is what makes today a win.", why: "Starting is the hard part. Two minutes counts, and most of the time you keep going.", task: { id: "key", text: m.keyTask.text }, actions: ["start", "avoid"] });
    }
    for (let i = 0; i < 3; i++) {
      if (m.priorities[i].text && !m.priorities[i].done) return make({ kind: "next", title: m.priorities[i].text, text: "Next on your list.", why: "One thing at a time. Finish it, tick it, then look at the next.", task: { id: "p" + i, text: m.priorities[i].text }, actions: ["start", "avoid"] });
    }
    if (routine) return make({ kind: "routine", title: routine.open === 1 ? "One habit left today" : routine.open + " habits left today", text: routine.text, why: "Your routine lives in Habits. A tick there takes seconds, and the day then counts as kept.", task: null, actions: ["routine"] });
    if (mission) return make({ kind: "mission", title: "Today's mission is still open", text: mission.nextText, why: "Missions are the small, practical part of the 30-day program. A tick takes seconds.", task: null, actions: ["mission"] });
    return make({ kind: "allDone", title: "Everything you planned is done", text: "Your planned actions are complete. Review at " + times.review + ", and look at tomorrow's priorities when you're ready.", why: "Nothing else is due. Rest counts.", task: null, actions: [] });
  }

  function openItems(m) {
    return !!m && ((!!m.keyTask.text && !m.keyTask.done) || m.priorities.some(function (p) { return !!p.text && !p.done; }));
  }

  /* ---------------- reordering a plan ---------------- */

  function cloneMorning(m) { return JSON.parse(JSON.stringify(m)); }

  // Moves a supporting priority up (dir -1) or down (+1) among the three slots. Its tick, due time and tag go with it.
  function moveTask(morning, index, dir) {
    const to = index + dir;
    if (!morning || index < 0 || index > 2 || to < 0 || to > 2) return morning;
    const out = cloneMorning(morning);
    const t = out.priorities[index]; out.priorities[index] = out.priorities[to]; out.priorities[to] = t;
    return out; // the same items in a new order: not an edit of the plan, and it changes no score
  }

  // Makes a supporting priority the main win, and the old main win takes its place.
  function promoteTask(morning, index) {
    if (!morning || index < 0 || index > 2 || !morning.priorities[index].text) return morning;
    const out = cloneMorning(morning);
    const t = out.keyTask; out.keyTask = out.priorities[index]; out.priorities[index] = t;
    out.editedAt = Date.now();
    return out;
  }

  // The start timer: how long is left, and whether it has run out.
  function timerState(timer, nowMs) {
    if (!timer) return null;
    // Never more than the time it was set for, even if the phone's clock was moved back.
    const remaining = Math.min(Math.max(0, timer.endsAt - nowMs), timer.endsAt - timer.startedAt);
    return { remainingMs: remaining, finished: remaining === 0 };
  }

  function inWindow(date, todayISO, windowDays) { return date <= todayISO && date >= addDays(todayISO, -(windowDays - 1)); }
  function countBy(list, keyFn, table) {
    const counts = {};
    list.forEach(function (x) { const k = keyFn(x); if (k) counts[k] = (counts[k] || 0) + 1; });
    return Object.keys(counts).map(function (k) {
      const entry = table.filter(function (t) { return t.key === k; })[0];
      return { key: k, label: entry ? entry.label : k, count: counts[k] };
    }).sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : 1); });
  }

  // Times you used "I'm avoiding it" in the window, why, and how often you started anyway.
  function avoidSummary(avoid, todayISO, windowDays) {
    const list = avoid.filter(function (a) { return inWindow(a.date, todayISO, windowDays); });
    const started = list.filter(function (a) { return a.outcome === "started"; }).length;
    const dropped = list.filter(function (a) { return a.outcome === "dropped"; }).length;
    const resolved = started + dropped;
    return { total: list.length, started: started, dropped: dropped, open: list.length - resolved, startRate: resolved ? Math.round(100 * started / resolved) : null, reasons: countBy(list, function (a) { return a.reason; }, REASONS) };
  }

  // What got in the way on days a priority was missed (the "what got in the way?" answers on scored days).
  function blockerSummary(days, todayISO, windowDays) {
    const list = [];
    Object.keys(days).forEach(function (d) {
      if (!inWindow(d, todayISO, windowDays) || !days[d].review || !days[d].review.blocker) return;
      list.push({ blocker: days[d].review.blocker });
    });
    return countBy(list, function (x) { return x.blocker; }, REASONS);
  }

  // How often your own rules were kept, from the evening answers ("not today" answers are left out).
  function ruleSummary(days, todayISO, windowDays) {
    const by = {};
    let answered = 0, kept = 0;
    Object.keys(days).forEach(function (d) {
      if (!inWindow(d, todayISO, windowDays) || !days[d].review) return;
      (days[d].review.rules || []).forEach(function (r) {
        if (r.state !== "done" && r.state !== "not") return;
        const k = r.text.toLowerCase();
        if (!by[k]) by[k] = { text: r.text, answered: 0, kept: 0 };
        by[k].answered++; answered++;
        if (r.state === "done") { by[k].kept++; kept++; }
      });
    });
    return { answered: answered, kept: kept, rate: answered ? Math.round(100 * kept / answered) : null, byRule: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.answered - a.answered; }) };
  }

  // Up to three rules worth trying: aimed at the weakest scoring areas once there is data, otherwise starter ideas.
  //   -> [{ text, why, starter }]. Rules you already have are never offered again.
  function suggestRules(trend, rules) {
    const have = (rules || []).map(function (r) { return r.text.toLowerCase(); });
    const fresh = function (text) { return have.indexOf(text.toLowerCase()) === -1; };
    const out = [];
    if (trend && trend.categories) {
      trend.categories.filter(function (c) { return c.pct !== null && c.pct < 100; }).sort(function (a, b) { return a.pct - b.pct; }).forEach(function (c) {
        const text = AREA_RULES[c.key];
        if (text && fresh(text) && out.length < 3) out.push({ text: text, why: c.label + " averaged " + c.pct + "% of what was attainable.", starter: false });
      });
    }
    STARTER_RULES.forEach(function (text) {
      if (out.length < 3 && fresh(text) && !out.some(function (o) { return o.text === text; })) out.push({ text: text, why: "A starting idea. There isn't enough scored data yet to aim it at your weak spot.", starter: true });
    });
    return out;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(iso) { return MONTHS[Number(iso.slice(5, 7)) - 1] + " " + Number(iso.slice(8, 10)); }

  return {
    REASONS: REASONS, EXCUSES: EXCUSES, DEFAULT_TIMES: DEFAULT_TIMES, MAX_RULES: MAX_RULES, RULE_MAX: RULE_MAX, START_MINUTES: START_MINUTES, AREA_RULES: AREA_RULES,
    sanitizeRules: sanitizeRules, sanitizeProgram: sanitizeProgram, sanitizeAvoid: sanitizeAvoid, sanitizeTimer: sanitizeTimer, sanitizeTimes: sanitizeTimes, minutesOf: minutesOf,
    nextUp: nextUp, timerState: timerState, avoidSummary: avoidSummary, blockerSummary: blockerSummary, ruleSummary: ruleSummary,
    suggestRules: suggestRules, shortDate: shortDate, firstUseDate: firstUseDate,
    CATEGORIES: CATEGORIES, ITEMS: ITEMS, DAY_TYPES: DAY_TYPES, NOTE_FIELDS: NOTE_FIELDS,
    PRIORITY_MAX: PRIORITY_MAX, NOTE_MAX: NOTE_MAX, REFLECT_MAX: REFLECT_MAX, ruleAddedDate: ruleAddedDate, DEFAULT_PHONE_LIMIT: DEFAULT_PHONE_LIMIT,
    MIN_DAYS_FOR_AVERAGES: MIN_DAYS_FOR_AVERAGES, MIN_DAYS_FOR_WEEKDAYS: MIN_DAYS_FOR_WEEKDAYS,
    isISODate: isISODate, addDays: addDays, weekdayOf: weekdayOf, daysBetween: daysBetween,
    sanitizeDay: sanitizeDay, sanitizeStore: sanitizeStore,
    TASK_CATEGORIES: TASK_CATEGORIES, DISTRACTION_RESPONSES: DISTRACTION_RESPONSES, IF_THEN_EXAMPLES: IF_THEN_EXAMPLES, EXTRA_ITEMS: EXTRA_ITEMS,
    moveTask: moveTask, promoteTask: promoteTask, hasPlanItems: hasPlanItems, hasIfThen: hasIfThen, openItems: openItems, sanitizeDrafts: sanitizeDrafts, DRAFT_NOTE_KEYS: DRAFT_NOTE_KEYS,
    RUBRIC_VERSION: RUBRIC_VERSION, scoreSnapshot: scoreSnapshot, backfillSnapshots: backfillSnapshots,
    scoreDay: scoreDay, unanswered: unanswered, excusedFor: excusedFor,
    reviewStreak: reviewStreak, lastScored: lastScored, trendSummary: trendSummary
  };
});
