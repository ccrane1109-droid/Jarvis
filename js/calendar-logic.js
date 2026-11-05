/* ==========================================================================
   JARVIS — Calendar: the rules (pure functions, no page access, so they can be tested outside the browser).

   Events are saved in two keys: jarvisCalendarEvents (a list) and jarvisCalendarSettings. An event is
   { id, title, description, notes, kind, category, priority, allDay, date, time, endDate, endTime, tz,
     repeat, exceptions, doneDates, completed, reminders, linked, status, source, externalId,
     createdAt, updatedAt, deletedAt }.

   Times: a timed event is a wall-clock time in the zone it was made in (date + "HH:MM" + tz), so a weekly
   9 AM meeting stays at 9 AM through a clock change. It is shown in the zone you are viewing the calendar in
   (your device's, unless you choose another). All-day events and untimed tasks are plain dates and do not
   move between zones.

   Deleting only marks an event (deletedAt). That is what lets a deletion on one device reach the others
   through the merge-based backup; marked events are dropped for good after 30 days.

   Nothing here changes what it is given: every edit returns a new list.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisCalendarLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TITLE_MAX = 140, DESC_MAX = 2000, NOTES_MAX = 4000;
  const MAX_EVENTS = 3000, STORE_LIMIT_CHARS = 400000, TOMBSTONE_DAYS = 30, MAX_SPAN_DAYS = 31, MAX_PERIODS = 6000;
  const REMINDER_MAX_MIN = 10080, REMINDER_MAX_COUNT = 5;

  const KINDS = [
    { value: "event", label: "Event", point: false },
    { value: "task", label: "Task", point: true },
    { value: "block", label: "Work block", point: false },
    { value: "content", label: "Content", point: false },
    { value: "milestone", label: "Milestone", point: true },
    { value: "reminder", label: "Reminder", point: true }
  ];
  const CATEGORIES = [
    { value: "work", label: "Work", color: "#4f8cff" },
    { value: "business", label: "Business", color: "#9b6bff" },
    { value: "content", label: "Content", color: "#ff7ab6" },
    { value: "launch", label: "Launch", color: "#ffc857" },
    { value: "personal", label: "Personal", color: "#33d17a" },
    { value: "health", label: "Health", color: "#2ec4b6" },
    { value: "study", label: "Study", color: "#ff9f43" },
    { value: "other", label: "Other", color: "#9aa3b8" }
  ];
  const PRIORITIES = ["low", "medium", "high"];
  const FREQS = ["daily", "weekly", "monthly", "yearly"];
  const REMINDER_CHOICES = [
    { value: 0, label: "At the time" }, { value: 5, label: "5 minutes before" }, { value: 10, label: "10 minutes before" },
    { value: 30, label: "30 minutes before" }, { value: 60, label: "1 hour before" }, { value: 1440, label: "1 day before" }
  ];
  const DEFAULT_SETTINGS = { weekStart: 1, timeZone: "", defaultView: "", defaultDuration: 60, defaultReminder: -1, updatedAt: 0 };

  function kindInfo(v) { return KINDS.filter(function (k) { return k.value === v; })[0] || KINDS[0]; }
  function categoryInfo(v) { return CATEGORIES.filter(function (c) { return c.value === v; })[0] || CATEGORIES[CATEGORIES.length - 1]; }
  function isPoint(kind) { return kindInfo(kind).point; }

  /* ---------------- calendar dates (no time zone involved) ---------------- */

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isDate(s) {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const p = s.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function isTime(s) { return typeof s === "string" && TIME_RE.test(s); }
  function toUTC(date) { const p = date.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function fromUTC(ms) { const d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function addDays(date, n) { return fromUTC(toUTC(date) + n * 86400000); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  function weekday(date) { return new Date(toUTC(date)).getUTCDay(); }   // 0 = Sunday
  function minutesOf(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); }
  function timeOf(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m is 1-12
  // Whole months later, keeping the day of the month where there is one (31 Jan + 1 month = 28 Feb, 29 Feb in a leap year).
  function addMonths(date, n) {
    const p = date.split("-").map(Number), mi = p[0] * 12 + (p[1] - 1) + n, y = Math.floor(mi / 12), m = mi % 12 + 1;
    return y + "-" + pad(m) + "-" + pad(Math.min(p[2], daysInMonth(y, m)));
  }

  /* ---------------- time zones ---------------- */

  const fmts = {};
  function formatter(zone) {
    if (!fmts[zone]) fmts[zone] = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return fmts[zone];
  }
  function isValidZone(zone) { if (typeof zone !== "string" || !zone) return false; try { formatter(zone); return true; } catch (e) { return false; } }
  function deviceZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } }
  function wallParts(ms, zone) {
    const o = {};
    formatter(zone).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: Number(o.year), mo: Number(o.month), d: Number(o.day), h: Number(o.hour) % 24, mi: Number(o.minute), s: Number(o.second) };
  }
  function offsetMs(ms, zone) { const w = wallParts(ms, zone); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - (ms - ((ms % 1000) + 1000) % 1000); }
  // The date and "HH:MM" on the wall in that zone at that instant.
  function instantToWall(ms, zone) { const w = wallParts(ms, zone); return { date: w.y + "-" + pad(w.mo) + "-" + pad(w.d), time: pad(w.h) + ":" + pad(w.mi) }; }
  // The instant a wall time is, in that zone. A time that happens twice (clocks going back) is the first one;
  // a time that does not exist (clocks going forward) lands after the jump, as the clock would show it.
  function wallToInstant(date, time, zone) {
    const p = date.split("-").map(Number), t = time.split(":").map(Number);
    const asUtc = Date.UTC(p[0], p[1] - 1, p[2], t[0], t[1]);
    const want = date + " " + time;
    const cands = [offsetMs(asUtc - 86400000, zone), offsetMs(asUtc + 86400000, zone)].map(function (o) { return asUtc - o; });
    const valid = cands.filter(function (c) { const w = instantToWall(c, zone); return w.date + " " + w.time === want; });
    return valid.length ? Math.min.apply(null, valid) : cands[0];
  }
  function todayIn(nowMs, zone) { return instantToWall(nowMs, zone).date; }

  /* ---------------- settings ---------------- */

  function settings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const dur = Number(r.defaultDuration);
    return {
      weekStart: r.weekStart === 0 ? 0 : 1,
      timeZone: isValidZone(r.timeZone) ? r.timeZone : "",
      defaultView: ["month", "week", "day", "agenda"].indexOf(r.defaultView) !== -1 ? r.defaultView : "",
      defaultDuration: Number.isInteger(dur) && dur >= 15 && dur <= 480 ? dur : 60,
      defaultReminder: Number.isInteger(Number(r.defaultReminder)) && Number(r.defaultReminder) >= -1 && Number(r.defaultReminder) <= REMINDER_MAX_MIN ? Number(r.defaultReminder) : -1,
      updatedAt: Number(r.updatedAt) || 0
    };
  }
  function viewZone(s) { return (s && isValidZone(s.timeZone)) ? s.timeZone : deviceZone(); }

  /* ---------------- checking one event ---------------- */

  function oneLine(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }
  function text(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, max); }

  // input: the fields of an event (all optional but title and date). ctx: { zone, defaultDuration }.
  // -> { ok, event, errors: { field: message }, error: first message }
  function check(input, ctx) {
    const c = ctx || {}, i = input || {}, errors = {};
    const kind = KINDS.some(function (k) { return k.value === i.kind; }) ? i.kind : "event";
    const point = isPoint(kind);
    const title = oneLine(i.title);
    if (!title) errors.title = "Give it a title.";
    else if (title.length > TITLE_MAX) errors.title = "Keep the title to " + TITLE_MAX + " characters or fewer.";
    const description = text(i.description, DESC_MAX + 1), notes = text(i.notes, NOTES_MAX + 1);
    if (description.length > DESC_MAX) errors.description = "Keep the description to " + DESC_MAX + " characters or fewer.";
    if (notes.length > NOTES_MAX) errors.notes = "Keep the notes to " + NOTES_MAX + " characters or fewer.";

    const category = CATEGORIES.some(function (x) { return x.value === i.category; }) ? i.category : "other";
    const priority = PRIORITIES.indexOf(i.priority) !== -1 ? i.priority : "medium";
    const tz = isValidZone(i.tz) ? i.tz : (isValidZone(c.zone) ? c.zone : deviceZone());
    const allDay = !point && !!i.allDay;
    const date = i.date;
    if (!isDate(date)) errors.date = "Pick a date.";

    let time = "", endDate = date, endTime = "";
    if (isDate(date)) {
      if (allDay) {
        endDate = i.endDate === undefined || i.endDate === "" || i.endDate === null ? date : i.endDate;
        if (!isDate(endDate)) errors.endDate = "Pick the last day.";
        else if (endDate < date) errors.endDate = "The last day can't be before the first.";
        else if (diffDays(date, endDate) >= MAX_SPAN_DAYS) errors.endDate = "Keep it to " + MAX_SPAN_DAYS + " days or fewer.";
      } else if (point) {
        time = i.time === undefined || i.time === null ? "" : String(i.time);
        if (time !== "" && !isTime(time)) errors.time = "Pick a time.";
        endDate = date; endTime = "";
      } else {
        time = i.time === undefined || i.time === null ? "" : String(i.time);
        if (!isTime(time)) errors.time = "Pick a start time.";
        else {
          endDate = i.endDate === undefined || i.endDate === "" || i.endDate === null ? date : i.endDate;
          if (!isDate(endDate)) errors.endDate = "Pick the end date.";
          else {
            const given = i.endTime === undefined || i.endTime === null || i.endTime === "" ? "" : String(i.endTime);
            if (given !== "" && !isTime(given)) errors.endTime = "Pick an end time.";
            else {
              const startMin = minutesOf(time);
              if (given === "") {
                const total = startMin + (Number(c.defaultDuration) || 60);
                endDate = addDays(endDate, Math.floor(total / 1440)); endTime = timeOf(total % 1440);
              } else endTime = given;
              if (!errors.endTime && (endDate < date || (endDate === date && minutesOf(endTime) <= startMin))) errors.endTime = "The end has to be after the start.";
              else if (diffDays(date, endDate) >= MAX_SPAN_DAYS) errors.endDate = "Keep it to " + MAX_SPAN_DAYS + " days or fewer.";
            }
          }
        }
      }
    }

    let repeat = null;
    if (i.repeat) {
      const r = i.repeat, interval = r.interval === undefined || r.interval === "" ? 1 : Number(r.interval);
      if (FREQS.indexOf(r.freq) === -1) errors.repeat = "Pick how often it repeats.";
      else if (!Number.isInteger(interval) || interval < 1 || interval > 99) errors.repeat = "Repeat every 1 to 99.";
      else {
        repeat = { freq: r.freq, interval: interval };
        if (r.freq === "weekly") {
          const by = (Array.isArray(r.byDay) ? r.byDay : []).map(Number).filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; });
          const uniq = by.filter(function (d, k) { return by.indexOf(d) === k; }).sort(function (a, b) { return a - b; });
          repeat.byDay = uniq.length ? uniq : (isDate(date) ? [weekday(date)] : [1]);
        }
        if (r.until) { if (!isDate(r.until) || (isDate(date) && r.until < date)) errors.repeat = "Repeat until a day on or after the first one."; else repeat.until = r.until; }
        const n = r.count === undefined || r.count === "" || r.count === null ? 0 : Number(r.count);
        if (n) { if (!Number.isInteger(n) || n < 1 || n > 999) errors.repeat = "Repeat 1 to 999 times."; else repeat.count = n; }
        if (repeat.until && repeat.count) delete repeat.count;
      }
    }

    let reminders = [];
    if (Array.isArray(i.reminders)) {
      const vals = i.reminders.map(Number);
      if (vals.some(function (v) { return !Number.isInteger(v) || v < 0 || v > REMINDER_MAX_MIN; })) errors.reminders = "A reminder can be up to a week before.";
      else {
        reminders = vals.filter(function (v, k) { return vals.indexOf(v) === k; }).sort(function (a, b) { return b - a; });
        if (reminders.length > REMINDER_MAX_COUNT) errors.reminders = "Up to " + REMINDER_MAX_COUNT + " reminders.";
      }
    }

    const keys = Object.keys(errors);
    if (keys.length) return { ok: false, errors: errors, error: errors[keys[0]] };
    let linked = i.linked && typeof i.linked === "object" && typeof i.linked.type === "string" && typeof i.linked.id === "string" ? { type: i.linked.type.slice(0, 30), id: i.linked.id.slice(0, 80) } : null;
    // A filming session can point at several ideas at once.
    if (linked && Array.isArray(i.linked.ids)) {
      const ids = i.linked.ids.filter(function (x) { return typeof x === "string" && x; }).map(function (x) { return x.slice(0, 80); }).filter(function (x, k, a) { return a.indexOf(x) === k; }).slice(0, 20);
      if (ids.length) linked.ids = ids;
    }
    return {
      ok: true, errors: {},
      event: {
        title: title, description: description, notes: notes, kind: kind, category: category, priority: priority,
        allDay: allDay, date: date, time: time, endDate: endDate, endTime: endTime, tz: tz,
        repeat: repeat, reminders: reminders, linked: linked, status: oneLine(i.status).slice(0, 20),
        completed: !!i.completed
      }
    };
  }

  // A list read from storage: keeps what is usable, drops what is not.
  function sanitizeList(list) {
    const out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || seen[raw.id]) return;
      const c = check(raw, { zone: raw.tz, defaultDuration: 60 });
      if (!c.ok) return;
      seen[raw.id] = true;
      const e = Object.assign({ id: raw.id }, c.event, {
        exceptions: (Array.isArray(raw.exceptions) ? raw.exceptions : []).filter(isDate),
        doneDates: (Array.isArray(raw.doneDates) ? raw.doneDates : []).filter(isDate),
        source: raw.source === "google" ? "google" : "local",
        externalId: typeof raw.externalId === "string" ? raw.externalId.slice(0, 200) : "",
        createdAt: Number(raw.createdAt) || 0, updatedAt: Number(raw.updatedAt) || 0
      });
      if (Number(raw.deletedAt)) e.deletedAt = Number(raw.deletedAt);
      out.push(e);
    });
    return out;
  }

  function live(events) { return (events || []).filter(function (e) { return e && !e.deletedAt; }); }
  function byId(events, id) { return (events || []).filter(function (e) { return e.id === id && !e.deletedAt; })[0] || null; }
  function sizeOk(events) { return live(events).length < MAX_EVENTS && JSON.stringify(events || []).length < STORE_LIMIT_CHARS; }

  /* ---------------- repeating ---------------- */

  function spanDays(ev) { return ev.endDate && isDate(ev.endDate) ? Math.max(0, diffDays(ev.date, ev.endDate)) : 0; }
  function mondayOf(date) { return addDays(date, -((weekday(date) + 6) % 7)); }

  // The dates (in the event's own zone) on which it starts, from..to inclusive.
  function repeatDates(ev, from, to) {
    const r = ev.repeat, skip = ev.exceptions || [];
    if (!r) return ev.date >= from && ev.date <= to && skip.indexOf(ev.date) === -1 ? [ev.date] : [];
    const last = r.until && r.until < to ? r.until : to, step = r.interval || 1, out = [];
    let produced = 0;
    const take = function (d) {
      if (d < ev.date) return true;
      if (r.count && produced >= r.count) return false;
      if (d > last) return false;
      produced++;
      if (d >= from && skip.indexOf(d) === -1) out.push(d);
      return true;
    };
    // A count needs every earlier occurrence counted; without one, start near the range.
    let i = 0;
    if (!r.count) {
      const gap = Math.max(0, diffDays(ev.date, from));
      if (r.freq === "daily") i = Math.max(0, Math.floor(gap / step) - 1);
      else if (r.freq === "weekly") i = Math.max(0, Math.floor(gap / (7 * step)) - 1);
      else if (r.freq === "monthly") i = Math.max(0, Math.floor(gap / (31 * step)) - 1);
      else i = Math.max(0, Math.floor(gap / (366 * step)) - 1);
    }
    for (let n = 0; n < MAX_PERIODS; n++, i++) {
      if (r.freq === "daily") { if (!take(addDays(ev.date, i * step))) break; }
      else if (r.freq === "weekly") {
        const anchor = addDays(mondayOf(ev.date), 7 * step * i);
        if (anchor > last) break;
        const days = (r.byDay && r.byDay.length ? r.byDay : [weekday(ev.date)]).map(function (d) { return addDays(anchor, (d + 6) % 7); }).sort();
        let go = true;
        for (let k = 0; k < days.length && go; k++) go = take(days[k]);
        if (!go) break;
      } else if (r.freq === "monthly") { if (!take(addMonths(ev.date, i * step))) break; }
      else if (!take(addMonths(ev.date, 12 * i * step))) break;
    }
    return out;
  }

  /* ---------------- what shows on a day ---------------- */

  // One showing of an event on a day it starts, in the zone you are viewing the calendar in.
  function occurrence(ev, od, zone) {
    const span = spanDays(ev), endD = addDays(od, span);
    const base = {
      key: ev.id + "@" + od, id: ev.id, occDate: od, source: "event", title: ev.title, description: ev.description || "", kind: ev.kind, category: ev.category,
      priority: ev.priority, recurring: !!ev.repeat, linked: ev.linked || null, status: ev.status || "", reminders: ev.reminders || [],
      completed: ev.repeat ? (ev.doneDates || []).indexOf(od) !== -1 : !!ev.completed, point: isPoint(ev.kind), tz: ev.tz, readOnly: false
    };
    if (ev.allDay || !ev.time) return Object.assign(base, { allDay: true, date: od, endDate: endD, time: "", endTime: "", startMin: null, endMin: null, startMs: null, endMs: null });
    const startMs = wallToInstant(od, ev.time, ev.tz);
    const endMs = ev.endTime ? wallToInstant(endD, ev.endTime, ev.tz) : startMs;
    const s = instantToWall(startMs, zone), e = instantToWall(endMs, zone);
    return Object.assign(base, { allDay: false, date: s.date, time: s.time, endDate: e.date, endTime: e.time, startMin: minutesOf(s.time), endMin: minutesOf(e.time), startMs: startMs, endMs: endMs });
  }
  function byStart(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.startMin || 0) - (b.startMin || 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  }
  // Every showing that touches from..to (dates in the view zone).
  function expand(events, from, to, zone) {
    const out = [];
    live(events).forEach(function (ev) {
      repeatDates(ev, addDays(from, -spanDays(ev) - 2), addDays(to, 2)).forEach(function (od) {
        const it = occurrence(ev, od, zone);
        if (it.endDate >= from && it.date <= to) out.push(it);
      });
    });
    return out.sort(byStart);
  }

  // Your ordinary tasks (the To-Do list and the Habits planner) as calendar items. A task has no length, so
  // a timed one is drawn as a half hour; that is only how it looks.
  function taskItems(tasks, from, to) {
    return (Array.isArray(tasks) ? tasks : []).filter(function (t) { return t && typeof t.id === "string" && isDate(t.date) && t.date >= from && t.date <= to && t.text; }).map(function (t) {
      const timed = isTime(t.time), startMin = timed ? minutesOf(t.time) : null;
      return {
        key: "task:" + t.id, id: t.id, occDate: t.date, source: "task", title: String(t.text), description: "", kind: "task", category: "other", priority: PRIORITIES.indexOf(t.priority) !== -1 ? t.priority : "medium",
        recurring: false, linked: null, status: "", reminders: [], completed: !!t.completed, point: true, tz: "",
        allDay: !timed, date: t.date, endDate: t.date, time: timed ? t.time : "", endTime: timed ? timeOf(Math.min(1439, startMin + 30)) : "",
        startMin: startMin, endMin: timed ? Math.min(1439, startMin + 30) : null, startMs: null, endMs: null, readOnly: false
      };
    });
  }

  function allDayFor(items, date) { return items.filter(function (it) { return it.allDay && it.date <= date && it.endDate >= date; }); }
  // The timed items on a day, clipped to it, laid out in side-by-side columns where they overlap.
  function layoutDay(items, date, minLength) {
    const min = minLength || 30;
    const segs = items.filter(function (it) { return !it.allDay && it.date <= date && it.endDate >= date; }).map(function (it) {
      const s = it.date === date ? it.startMin : 0;
      let e = it.endDate === date ? it.endMin : 1440;
      if (e - s < min) e = Math.min(1440, s + min);
      return { item: it, startMin: s, endMin: e, col: 0, cols: 1 };
    }).sort(function (a, b) { return a.startMin - b.startMin || b.endMin - a.endMin; });
    let cluster = [], clusterEnd = -1;
    const close = function () { const n = cluster.reduce(function (m, x) { return Math.max(m, x.col + 1); }, 1); cluster.forEach(function (x) { x.cols = n; }); cluster = []; };
    segs.forEach(function (s) {
      if (cluster.length && s.startMin >= clusterEnd) { close(); clusterEnd = -1; }
      const used = cluster.filter(function (x) { return x.endMin > s.startMin; }).map(function (x) { return x.col; });
      let col = 0;
      while (used.indexOf(col) !== -1) col++;
      s.col = col; cluster.push(s); clusterEnd = Math.max(clusterEnd, s.endMin);
    });
    close();
    return segs;
  }

  // Timed items with a real length that overlap each other: [{ a, b, minutes }].
  function findConflicts(items) {
    const timed = items.filter(function (it) { return it.source === "event" && !it.allDay && !it.point && it.endMs > it.startMs && !it.completed; }).sort(function (a, b) { return a.startMs - b.startMs; });
    const out = [];
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length && timed[j].startMs < timed[i].endMs; j++) {
      out.push({ a: timed[i], b: timed[j], minutes: Math.round((Math.min(timed[i].endMs, timed[j].endMs) - timed[j].startMs) / 60000) });
    }
    return out;
  }
  // Anything that overlaps a start and end instant (the item with the same key is not counted).
  function conflictsWith(items, startMs, endMs, exceptKey) {
    return items.filter(function (it) { return it.source === "event" && !it.allDay && !it.point && it.key !== exceptKey && it.endMs > it.startMs && it.startMs < endMs && it.endMs > startMs && !it.completed; });
  }

  /* ---------------- search and filter ---------------- */

  // f: { q, categories: [..] (none = all), kinds: [..], hideDone }
  function filterItems(items, f) {
    const q = oneLine(f && f.q).toLowerCase(), cats = f && f.categories || [], kinds = f && f.kinds || [];
    return items.filter(function (it) {
      if (f && f.hideDone && it.completed) return false;
      if (cats.length && cats.indexOf(it.category) === -1) return false;
      if (kinds.length && kinds.indexOf(it.kind) === -1) return false;
      if (q && (it.title + " " + (it.description || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function matchesSearch(ev, q) {
    const s = oneLine(q).toLowerCase();
    return !s || (ev.title + " " + (ev.description || "") + " " + (ev.notes || "")).toLowerCase().indexOf(s) !== -1;
  }

  /* ---------------- looking around: ranges, titles ---------------- */

  function startOfWeek(date, weekStart) { return addDays(date, -((weekday(date) - weekStart + 7) % 7)); }
  function monthGrid(anchor, weekStart) {
    const first = anchor.slice(0, 8) + "01", from = startOfWeek(first, weekStart), weeks = [];
    for (let w = 0; w < 6; w++) { const row = []; for (let d = 0; d < 7; d++) row.push(addDays(from, w * 7 + d)); weeks.push(row); }
    return { from: from, to: addDays(from, 41), weeks: weeks, month: anchor.slice(0, 7) };
  }
  function rangeFor(view, anchor, weekStart) {
    if (view === "month") { const g = monthGrid(anchor, weekStart); return { from: g.from, to: g.to }; }
    if (view === "week") { const f = startOfWeek(anchor, weekStart); return { from: f, to: addDays(f, 6) }; }
    if (view === "day") return { from: anchor, to: anchor };
    return { from: anchor, to: addDays(anchor, 29) };
  }
  function shiftAnchor(view, anchor, dir) {
    if (view === "month") return addMonths(anchor.slice(0, 8) + "01", dir);
    if (view === "week") return addDays(anchor, 7 * dir);
    if (view === "day") return addDays(anchor, dir);
    return addDays(anchor, 30 * dir);
  }
  function fmtDate(date, opts) { return new Date(toUTC(date)).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, opts)); }
  function viewTitle(view, anchor, weekStart) {
    if (view === "month") return fmtDate(anchor, { month: "long", year: "numeric" });
    if (view === "day") return fmtDate(anchor, { weekday: "long", month: "long", day: "numeric" });
    const r = rangeFor(view, anchor, weekStart);
    const a = fmtDate(r.from, { month: "short", day: "numeric" }), b = fmtDate(r.to, r.from.slice(0, 7) === r.to.slice(0, 7) ? { day: "numeric" } : { month: "short", day: "numeric" });
    return a + " – " + b + ", " + r.to.slice(0, 4);
  }
  function timeLabel(t) { return isTime(t) ? ((Number(t.slice(0, 2)) + 11) % 12 + 1) + ":" + t.slice(3) + (Number(t.slice(0, 2)) < 12 ? " AM" : " PM") : ""; }
  function hourLabel(h) { return ((h + 11) % 12 + 1) + (h < 12 ? " AM" : " PM"); }

  // Agenda: [{ date, items }] for each day from..to that has something, items in time order.
  function agenda(items, from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const day = items.filter(function (it) { return it.date <= d && it.endDate >= d; }).sort(byStart);
      if (day.length) out.push({ date: d, items: day });
    }
    return out;
  }

  /* ---------------- changing events ---------------- */

  function stamp(e, now) { return Object.assign({}, e, { updatedAt: now }); }
  function replace(events, id, fn) {
    let found = null;
    const next = (events || []).map(function (e) { if (e.id !== id || e.deletedAt) return e; found = fn(e); return found; });
    return found ? { ok: true, events: next, event: found } : { ok: false, events: events, error: "That isn't there any more." };
  }
  function ctxOf(ctx) { return Object.assign({ now: Date.now(), zone: deviceZone(), defaultDuration: 60, makeId: function () { return "ev_" + Math.random().toString(36).slice(2, 10); } }, ctx || {}); }

  // -> { ok, events, event, error, errors }
  function add(events, input, ctx) {
    const c = ctxOf(ctx), r = check(input, c);
    if (!r.ok) return { ok: false, events: events, error: r.error, errors: r.errors };
    if (!sizeOk(events)) return { ok: false, events: events, error: "The calendar is full. Delete some old events first." };
    const ev = Object.assign({ id: c.makeId() }, r.event, { exceptions: [], doneDates: [], source: "local", externalId: "", createdAt: c.now, updatedAt: c.now });
    return { ok: true, events: (events || []).concat([ev]), event: ev };
  }

  // Change an event (all of a repeating one). input: any of the fields; the rest stay.
  function edit(events, id, input, ctx) {
    const c = ctxOf(ctx), cur = byId(events, id);
    if (!cur) return { ok: false, events: events, error: "That isn't there any more." };
    const merged = Object.assign({}, cur, input);
    if (input && input.repeat === undefined) merged.repeat = cur.repeat;
    const r = check(merged, Object.assign({}, c, { zone: merged.tz }));
    if (!r.ok) return { ok: false, events: events, error: r.error, errors: r.errors };
    return replace(events, id, function (e) { return stamp(Object.assign({}, e, r.event), c.now); });
  }

  // Change one showing of a repeating event. scope: "all" | "this". "this" leaves the series without that day and adds a one-off.
  function editOccurrence(events, id, occDate, input, scope, ctx) {
    const cur = byId(events, id);
    if (!cur) return { ok: false, events: events, error: "That isn't there any more." };
    if (!cur.repeat || scope === "all") return edit(events, id, input, ctx);
    const c = ctxOf(ctx);
    const one = Object.assign({}, cur, input, { repeat: null });
    const r = check(one, Object.assign({}, c, { zone: one.tz }));
    if (!r.ok) return { ok: false, events: events, error: r.error, errors: r.errors };
    const made = add(events, r.event, c);
    if (!made.ok) return made;
    const closed = replace(made.events, id, function (e) { return stamp(Object.assign({}, e, { exceptions: (e.exceptions || []).concat([occDate]) }), c.now); });
    return { ok: true, events: closed.events, event: made.event };
  }

  function duplicate(events, id, ctx) {
    const c = ctxOf(ctx), cur = byId(events, id);
    if (!cur) return { ok: false, events: events, error: "That isn't there any more." };
    if (!sizeOk(events)) return { ok: false, events: events, error: "The calendar is full. Delete some old events first." };
    const copy = Object.assign({}, cur, { id: c.makeId(), exceptions: [], doneDates: [], completed: false, source: "local", externalId: "", createdAt: c.now, updatedAt: c.now });
    delete copy.deletedAt;
    return { ok: true, events: (events || []).concat([copy]), event: copy };
  }

  // Marks the event deleted (so the deletion can sync), or one day of a repeating one.
  function remove(events, id, ctx) {
    const c = ctxOf(ctx);
    return replace(events, id, function (e) { return Object.assign({}, e, { deletedAt: c.now, updatedAt: c.now }); });
  }
  function removeOccurrence(events, id, occDate, ctx) {
    const c = ctxOf(ctx);
    return replace(events, id, function (e) { return stamp(Object.assign({}, e, { exceptions: (e.exceptions || []).filter(function (d) { return d !== occDate; }).concat([occDate]) }), c.now); });
  }
  function restore(events, id, ctx) {
    const c = ctxOf(ctx);
    let found = null;
    const next = (events || []).map(function (e) { if (e.id !== id || !e.deletedAt) return e; found = Object.assign({}, e, { updatedAt: c.now }); delete found.deletedAt; return found; });
    return found ? { ok: true, events: next, event: found } : { ok: false, events: events, error: "That can't be brought back." };
  }
  function unremoveOccurrence(events, id, occDate, ctx) {
    const c = ctxOf(ctx);
    return replace(events, id, function (e) { return stamp(Object.assign({}, e, { exceptions: (e.exceptions || []).filter(function (d) { return d !== occDate; }) }), c.now); });
  }
  // Drops events deleted more than 30 days ago.
  function purge(events, now) {
    const cutoff = now - TOMBSTONE_DAYS * 86400000;
    return (events || []).filter(function (e) { return !(e.deletedAt && e.deletedAt < cutoff); });
  }

  function setDone(events, id, occDate, done, ctx) {
    const c = ctxOf(ctx);
    return replace(events, id, function (e) {
      if (!e.repeat) return stamp(Object.assign({}, e, { completed: !!done }), c.now);
      const rest = (e.doneDates || []).filter(function (d) { return d !== occDate; });
      return stamp(Object.assign({}, e, { doneDates: done ? rest.concat([occDate]) : rest }), c.now);
    });
  }

  // Move one showing to a new start in the view zone: target { date, time } (time is ignored for a date-only item;
  // a task or reminder with no time that is dropped on a time gets that time). scope "all" moves a whole repeating
  // series by the same amount; "this" turns just that day into its own event.
  function moveTo(events, id, occDate, target, scope, ctx) {
    const c = ctxOf(ctx), cur = byId(events, id);
    if (!cur) return { ok: false, events: events, error: "That isn't there any more." };
    if (!isDate(target && target.date)) return { ok: false, events: events, error: "Pick a day." };
    const occ = occurrence(cur, occDate, c.zone), span = spanDays(cur);
    let newDate, newTime = cur.time, newEndDate, newEndTime = cur.endTime;
    if (occ.allDay && !(isPoint(cur.kind) && !cur.allDay && isTime(target.time))) {
      newDate = target.date; newEndDate = addDays(target.date, span);
    } else if (occ.allDay) {
      const s = instantToWall(wallToInstant(target.date, target.time, c.zone), cur.tz);
      newDate = s.date; newTime = s.time; newEndDate = s.date; newEndTime = "";
    } else {
      if (!isTime(target.time)) return { ok: false, events: events, error: "Pick a time." };
      const startMs = wallToInstant(target.date, target.time, c.zone), len = occ.endMs - occ.startMs;
      const s = instantToWall(startMs, cur.tz), e = instantToWall(startMs + len, cur.tz);
      newDate = s.date; newTime = s.time; newEndDate = e.date; newEndTime = isPoint(cur.kind) ? "" : e.time;
    }
    if (cur.repeat && scope !== "all") return editOccurrence(events, id, occDate, { date: newDate, endDate: newEndDate, time: newTime, endTime: newEndTime }, "this", c);
    const delta = diffDays(occDate, newDate), start = addDays(cur.date, delta);
    const patch = { date: start, endDate: addDays(start, diffDays(newDate, newEndDate)), time: newTime, endTime: newEndTime };
    if (cur.repeat && cur.repeat.freq === "weekly" && cur.repeat.byDay) {
      const shift = ((weekday(start) - weekday(cur.date)) % 7 + 7) % 7;
      patch.repeat = Object.assign({}, cur.repeat, { byDay: cur.repeat.byDay.map(function (d) { return (d + shift) % 7; }).sort(function (a, b) { return a - b; }) });
    }
    return edit(events, id, patch, c);
  }

  // Change where a timed showing ends (in the view zone). Repeating events change the whole series.
  function resizeTo(events, id, occDate, end, ctx) {
    const c = ctxOf(ctx), cur = byId(events, id);
    if (!cur) return { ok: false, events: events, error: "That isn't there any more." };
    if (cur.allDay || !cur.time || isPoint(cur.kind)) return { ok: false, events: events, error: "This one has no length to change." };
    if (!isDate(end && end.date) || !isTime(end && end.time)) return { ok: false, events: events, error: "Pick an end time." };
    const occ = occurrence(cur, occDate, c.zone);
    const endMs = wallToInstant(end.date, end.time, c.zone);
    if (endMs <= occ.startMs) return { ok: false, events: events, error: "The end has to be after the start." };
    const e = instantToWall(endMs, cur.tz);
    return edit(events, id, { endDate: addDays(cur.date, diffDays(occDate, e.date)), endTime: e.time }, c);
  }

  return {
    TITLE_MAX: TITLE_MAX, DESC_MAX: DESC_MAX, NOTES_MAX: NOTES_MAX, MAX_EVENTS: MAX_EVENTS, TOMBSTONE_DAYS: TOMBSTONE_DAYS,
    KINDS: KINDS, CATEGORIES: CATEGORIES, PRIORITIES: PRIORITIES, FREQS: FREQS, REMINDER_CHOICES: REMINDER_CHOICES, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    kindInfo: kindInfo, categoryInfo: categoryInfo, isPoint: isPoint,
    isDate: isDate, isTime: isTime, addDays: addDays, diffDays: diffDays, weekday: weekday, minutesOf: minutesOf, timeOf: timeOf, addMonths: addMonths,
    isValidZone: isValidZone, deviceZone: deviceZone, instantToWall: instantToWall, wallToInstant: wallToInstant, todayIn: todayIn,
    settings: settings, viewZone: viewZone,
    check: check, sanitizeList: sanitizeList, live: live, byId: byId, sizeOk: sizeOk,
    repeatDates: repeatDates, occurrence: occurrence, expand: expand, taskItems: taskItems, allDayFor: allDayFor, layoutDay: layoutDay,
    findConflicts: findConflicts, conflictsWith: conflictsWith, filterItems: filterItems, matchesSearch: matchesSearch,
    startOfWeek: startOfWeek, monthGrid: monthGrid, rangeFor: rangeFor, shiftAnchor: shiftAnchor, viewTitle: viewTitle, timeLabel: timeLabel, hourLabel: hourLabel, fmtDate: fmtDate, agenda: agenda,
    add: add, edit: edit, editOccurrence: editOccurrence, duplicate: duplicate, remove: remove, removeOccurrence: removeOccurrence, restore: restore, unremoveOccurrence: unremoveOccurrence, purge: purge,
    setDone: setDone, moveTo: moveTo, resizeTo: resizeTo
  };
});
