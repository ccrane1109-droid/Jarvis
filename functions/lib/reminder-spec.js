/* ==========================================================================
   Reminder rules shared by the server (functions/lib/reminders.js) and the
   browser (js/reminders.js loads this file straight from the site), so the
   form and the server agree on what a valid reminder is.

   Plain data and pure functions only: no requires, no network, no clock, no
   time zones. Anything that needs a time zone lives in reminder-time.js on
   the server.

   A schedule is a wall-clock description, not a list of moments:
     { type: "daily",  times: ["07:30", "20:00"], days: [],        date: null }
     { type: "weekly", times: ["18:00"],          days: [1, 3, 5], date: null }   0 = Sunday ... 6 = Saturday
     { type: "once",   times: ["09:00"],          days: [],        date: "2026-10-20" }
   The reminder's own time zone turns these into real moments.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisReminderSpec = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_REMINDERS = 100;
  const MAX_TIMES = 12;
  const TITLE_MAX = 80;
  const NOTES_MAX = 300;
  const SCHEDULE_TYPES = ["daily", "weekly", "once"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const ID_RE = /^[a-f0-9]{16}$/;
  const DEFAULT_TIMEZONE = "America/New_York";

  // privateText: the lock screen says only the category name, not the title you typed.
  const CATEGORIES = [
    { value: "glasses", label: "Blue-light glasses", icon: "👓", defaultTitle: "Put on blue-light glasses", privateText: false },
    { value: "medication", label: "Medication", icon: "💊", defaultTitle: "Medication", privateText: true },
    { value: "protein", label: "Protein shake", icon: "🥤", defaultTitle: "Protein shake", privateText: false },
    { value: "creatine", label: "Creatine", icon: "⚡", defaultTitle: "Creatine", privateText: false },
    { value: "water", label: "Drink water", icon: "💧", defaultTitle: "Drink water", privateText: false },
    { value: "workout", label: "Workout", icon: "🏋️", defaultTitle: "Workout", privateText: false },
    { value: "reading", label: "Reading", icon: "📖", defaultTitle: "Read", privateText: false },
    { value: "business", label: "Business task", icon: "💼", defaultTitle: "Business task", privateText: false },
    { value: "custom", label: "Custom", icon: "🔔", defaultTitle: "", privateText: false }
  ];

  function categoryOf(value) {
    return CATEGORIES.filter(function (c) { return c.value === value; })[0] || null;
  }

  function cleanText(v, max) {
    // eslint-disable-next-line no-control-regex
    return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ").replace(/[<>]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
  }

  // "7:5" / "07:05" -> "07:05"; anything that isn't a real 24-hour time -> "".
  function cleanTime(v) {
    if (typeof v !== "string") return "";
    const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    const t = (m[1].length === 1 ? "0" : "") + m[1] + ":" + m[2];
    return TIME_RE.test(t) ? t : "";
  }

  // Unique valid times, earliest first. bad counts the entries that were thrown away.
  function cleanTimes(list) {
    const seen = {};
    const times = [];
    let bad = 0;
    (Array.isArray(list) ? list : []).forEach(function (v) {
      const t = cleanTime(v);
      if (!t) { bad++; return; }
      if (!seen[t]) { seen[t] = true; times.push(t); }
    });
    times.sort();
    return { times: times, bad: bad };
  }

  function cleanDays(list) {
    const seen = {};
    const days = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (Number.isInteger(v) && v >= 0 && v <= 6 && !seen[v]) { seen[v] = true; days.push(v); }
    });
    return days.sort(function (a, b) { return a - b; });
  }

  function isRealDate(s) {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  // The editable part of a reminder, from anything.
  // -> { ok: true, value } | { ok: false, error }. value never carries server fields
  // (id, nextFireAt, createdAt ...): those can't be set from outside.
  // Checks that need a clock or a time zone (a "once" date in the past, an
  // unknown zone) are done by the server.
  function sanitizeReminder(raw) {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const category = categoryOf(r.category);
    if (!category) return { ok: false, error: "Pick a category." };
    const title = cleanText(r.title, TITLE_MAX).replace(/\s+/g, " ").trim() || cleanText(category.defaultTitle, TITLE_MAX);
    if (!title) return { ok: false, error: "Give the reminder a name." };

    const s = r.schedule && typeof r.schedule === "object" && !Array.isArray(r.schedule) ? r.schedule : {};
    if (SCHEDULE_TYPES.indexOf(s.type) === -1) return { ok: false, error: "Choose daily, weekly or one time." };
    const t = cleanTimes(s.times);
    if (t.bad) return { ok: false, error: "One of the times isn't valid." };
    if (!t.times.length) return { ok: false, error: "Add at least one time." };
    if (t.times.length > MAX_TIMES) return { ok: false, error: "A reminder can have up to " + MAX_TIMES + " times a day." };

    const schedule = { type: s.type, times: t.times, days: [], date: null };
    if (s.type === "weekly") {
      schedule.days = cleanDays(s.days);
      if (!schedule.days.length) return { ok: false, error: "Pick at least one day of the week." };
    } else if (s.type === "once") {
      if (!isRealDate(s.date)) return { ok: false, error: "Pick the date." };
      if (t.times.length !== 1) return { ok: false, error: "A one-time reminder has a single time." };
      schedule.date = s.date;
    }

    return {
      ok: true,
      value: {
        title: title,
        category: category.value,
        notes: cleanText(r.notes, NOTES_MAX),
        enabled: r.enabled !== false,
        schedule: schedule,
        timezone: typeof r.timezone === "string" ? r.timezone.trim().slice(0, 64) : "",
        privateText: typeof r.privateText === "boolean" ? r.privateText : category.privateText,
        respectQuietHours: r.respectQuietHours === true
      }
    };
  }

  // { enabled, start, end } for quiet hours, and the home time zone for new reminders.
  function sanitizeSettings(raw) {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const q = r.quiet && typeof r.quiet === "object" ? r.quiet : {};
    return {
      timezone: typeof r.timezone === "string" && r.timezone.trim() ? r.timezone.trim().slice(0, 64) : DEFAULT_TIMEZONE,
      quiet: {
        enabled: q.enabled === true,
        start: cleanTime(q.start) || "22:00",
        end: cleanTime(q.end) || "07:00"
      }
    };
  }

  // Plain-English summary of a schedule, e.g. "Every day at 7:30 AM and 8:00 PM".
  function describeSchedule(schedule) {
    if (!schedule || !Array.isArray(schedule.times)) return "";
    const at = schedule.times.map(formatTime);
    const list = at.length <= 2 ? at.join(" and ") : at.slice(0, -1).join(", ") + " and " + at[at.length - 1];
    if (schedule.type === "once") return "Once on " + schedule.date + " at " + list;
    if (schedule.type === "weekly") {
      const days = (schedule.days || []).map(function (d) { return DAY_NAMES[d].slice(0, 3); });
      const label = days.length === 7 ? "Every day" : days.length === 5 && schedule.days.join() === "1,2,3,4,5" ? "Weekdays" : days.join(", ");
      return label + " at " + list;
    }
    return "Every day at " + list;
  }

  // "07:30" -> "7:30 AM"
  function formatTime(hhmm) {
    const m = String(hhmm).match(/^(\d{2}):(\d{2})$/);
    if (!m) return String(hhmm);
    const h = Number(m[1]);
    return (h % 12 === 0 ? 12 : h % 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
  }

  // Times between start and end, every step hours, e.g. water 09:00-19:00 every 2 hours.
  // -> an array of "HH:MM" (possibly empty when the inputs aren't usable).
  function timesEvery(start, end, stepHours) {
    const s = cleanTime(start);
    const e = cleanTime(end);
    const step = Number(stepHours);
    if (!s || !e || !(step >= 0.5) || step > 12) return [];
    const toMin = function (t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); };
    const out = [];
    for (let m = toMin(s); m <= toMin(e) && out.length < MAX_TIMES; m += Math.round(step * 60)) {
      out.push(("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2));
    }
    return out;
  }

  return {
    MAX_REMINDERS: MAX_REMINDERS, MAX_TIMES: MAX_TIMES, TITLE_MAX: TITLE_MAX, NOTES_MAX: NOTES_MAX,
    SCHEDULE_TYPES: SCHEDULE_TYPES, DAY_NAMES: DAY_NAMES, CATEGORIES: CATEGORIES, DEFAULT_TIMEZONE: DEFAULT_TIMEZONE,
    TIME_RE: TIME_RE, DATE_RE: DATE_RE, ID_RE: ID_RE,
    categoryOf: categoryOf, cleanText: cleanText, cleanTime: cleanTime, cleanTimes: cleanTimes, cleanDays: cleanDays, isRealDate: isRealDate,
    sanitizeReminder: sanitizeReminder, sanitizeSettings: sanitizeSettings,
    describeSchedule: describeSchedule, formatTime: formatTime, timesEvery: timesEvery
  };
});
