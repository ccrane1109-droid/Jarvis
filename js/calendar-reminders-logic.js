/* ==========================================================================
   JARVIS — Calendar reminders: the rules (pure functions, no page access, so they can be tested outside the browser).

   An event can carry reminders ("30 minutes before", "1 day before"). This file works out WHEN each one comes due,
   which of them are due now, which came due while JARVIS wasn't open, and what to say about it.

   What this can and can't do, plainly:
   - It runs inside JARVIS. Reminders are shown while JARVIS is open (in the app, and as a phone or computer
     notification if you allowed that). When JARVIS is closed nothing here runs, so nothing is sent: reminders that
     came due meanwhile are listed the next time you open it, marked as missed.
   - Your Habits reminders are different: your server sends those (js/reminders.js), so they can reach your phone when
     JARVIS is closed. Calendar reminders are not sent by the server.
   - Whether a notification is actually displayed is up to the browser and the phone; this file only decides what to ask for.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calendar-logic.js"));
  else root.JarvisCalendarReminders = factory(root.JarvisCalendarLogic);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const LIVE_MS = 2 * 60 * 1000;             // a reminder this fresh is "due now"; older than that it is "missed"
  const LOOKBACK_MS = 24 * 3600 * 1000;      // how far back "missed" looks
  const AHEAD_MS = 36 * 3600 * 1000;         // how far ahead it plans
  const LOG_KEEP_MS = 14 * 86400000, LOG_MAX = 500;
  const SNOOZES = [{ minutes: 5, label: "5 minutes" }, { minutes: 10, label: "10 minutes" }, { minutes: 60, label: "1 hour" }];

  function mins(t) { return C.minutesOf(t); }

  /* ---------------- when a reminder comes due ---------------- */

  // The moment one reminder is due. "N days before" keeps the same time of day (so it is still 9 AM after clocks change).
  // All-day items count from the time you chose for all-day reminders.
  function fireAtFor(item, offset, notify, zone) {
    const n = C.notifySettings(notify), day = offset >= 1440 && offset % 1440 === 0;
    if (item.allDay) {
      if (!C.isDate(item.date)) return null;
      if (day) return C.wallToInstant(C.addDays(item.date, -offset / 1440), n.allDayAt, zone);
      return C.wallToInstant(item.date, n.allDayAt, zone) - offset * 60000;
    }
    if (!Number.isFinite(item.startMs)) return null;
    if (day) { const w = C.instantToWall(item.startMs, zone); return C.wallToInstant(C.addDays(w.date, -offset / 1440), w.time, zone); }
    return item.startMs - offset * 60000;
  }

  // When the item is over, so a reminder is not shown for something that has already finished.
  function expiresAt(item, zone) {
    if (item.allDay) return C.wallToInstant(C.addDays(item.endDate || item.date, 1), "00:00", zone);
    return Math.max(Number.isFinite(item.endMs) ? item.endMs : 0, item.startMs);
  }

  /* ---------------- quiet hours ---------------- */

  function inQuiet(ms, notify, zone) {
    const n = C.notifySettings(notify);
    if (!n.quiet.enabled) return false;
    const m = mins(C.instantToWall(ms, zone).time), s = mins(n.quiet.start), e = mins(n.quiet.end);
    return s < e ? (m >= s && m < e) : (m >= s || m < e);
  }
  // The moment quiet hours end, for a moment that falls inside them.
  function quietEnd(ms, notify, zone) {
    const n = C.notifySettings(notify), w = C.instantToWall(ms, zone), m = mins(w.time), s = mins(n.quiet.start), e = mins(n.quiet.end);
    const sameDay = s < e || m < e;
    return C.wallToInstant(sameDay ? w.date : C.addDays(w.date, 1), n.quiet.end, zone);
  }

  /* ---------------- the list of reminders in a stretch of time ---------------- */

  // Every reminder that comes due between from and to (milliseconds). Held ones (inside quiet hours) come due when quiet
  // hours end, unless the item is over by then. Done items and deleted ones have no reminders.
  // -> [{ key, itemKey, id, occDate, offset, title, allDay, date, time, startMs, fireAt, deliverAt, held, expiresAt }]
  function entries(events, o) {
    const zone = o.zone, n = C.notifySettings(o.notify), out = [], saved = {};
    C.live(events).forEach(function (e) { saved[e.id] = Number(e.updatedAt) || 0; });
    const fromDate = C.instantToWall(o.from, zone).date, toDate = C.instantToWall(o.to, zone).date;
    C.expand(events, C.addDays(fromDate, -2), C.addDays(toDate, 9), zone).forEach(function (it) {
      if (it.completed || !it.reminders || !it.reminders.length) return;
      const ends = expiresAt(it, zone);
      it.reminders.forEach(function (offset) {
        const fire = fireAtFor(it, offset, n, zone);
        if (fire === null || !Number.isFinite(fire)) return;
        const held = inQuiet(fire, n, zone), deliver = held ? quietEnd(fire, n, zone) : fire;
        if (deliver < o.from || deliver > o.to || deliver > ends) return;
        out.push({ key: it.key + "#" + offset, itemKey: it.key, id: it.id, occDate: it.occDate, offset: offset, title: it.title, allDay: !!it.allDay, date: it.date, time: it.time, startMs: it.startMs, fireAt: fire, deliverAt: deliver, held: held, expiresAt: ends, savedAt: saved[it.id] || 0 });
      });
    });
    return out.sort(function (a, b) { return a.deliverAt - b.deliverAt || (a.key < b.key ? -1 : 1); });
  }

  // Sorts the list into what is due now, what was missed while JARVIS wasn't open, and what is still ahead.
  // log: what has already been shown or dismissed (see markShown). A snoozed one comes due again at its snooze time.
  // -> { due, missed, upcoming, next }  (next = the soonest moment something comes due, or null)
  function classify(list, log, now) {
    const due = [], missed = [], upcoming = [], lg = log && typeof log === "object" ? log : {};
    list.forEach(function (e) {
      const l = lg[e.key]; let at = e.deliverAt;
      if (l) { if (!(l.snoozeUntil > 0)) return; at = l.snoozeUntil; }
      if (now > e.expiresAt) return;
      // An event saved after this reminder's moment had already passed (made at the last minute, or edited since) was never
      // "missed": JARVIS was open when you saved it. (A snooze you chose ends after the save, so it still comes back.)
      if (e.savedAt > at) return;
      const x = Object.assign({}, e, { deliverAt: at, snoozed: !!(l && l.snoozeUntil) });
      if (at <= now) (now - at <= LIVE_MS ? due : missed).push(x); else upcoming.push(x);
    });
    const by = function (a, b) { return a.deliverAt - b.deliverAt; };
    upcoming.sort(by); due.sort(by); missed.sort(by);
    return { due: due, missed: missed, upcoming: upcoming, next: upcoming.length ? upcoming[0].deliverAt : null };
  }

  // Everything in one step: the lists for this moment. Looks back a day and ahead a day and a half.
  function plan(events, o) {
    const list = entries(events, { zone: o.zone, notify: o.notify, from: o.now - LOOKBACK_MS, to: o.now + AHEAD_MS });
    return classify(list, o.log, o.now);
  }

  /* ---------------- what has been shown (kept on this device only) ---------------- */

  function sanitizeLog(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (k) {
      const v = raw[k];
      if (typeof k !== "string" || k.length > 120 || !v || typeof v !== "object") return;
      const at = Number(v.at);
      if (!Number.isFinite(at) || at <= 0) return;
      const e = { at: at, via: ["app", "system", "seen"].indexOf(v.via) !== -1 ? v.via : "seen" };
      if (Number(v.snoozeUntil) > 0) e.snoozeUntil = Number(v.snoozeUntil);
      out[k] = e;
    });
    return out;
  }
  function markShown(log, key, now, via) { return Object.assign({}, log, (function () { const o = {}; o[key] = { at: now, via: via || "app" }; return o; })()); }
  function snooze(log, key, now, minutes, via) {
    const m = Number(minutes);
    if (!(m > 0 && m <= 60)) return log;
    const o = {}; o[key] = { at: now, via: via || "app", snoozeUntil: now + m * 60000 };
    return Object.assign({}, log, o);
  }
  // Old entries are forgotten so the log never grows without end.
  function prune(log, now) {
    const keys = Object.keys(log || {}).filter(function (k) { return now - log[k].at <= LOG_KEEP_MS; });
    keys.sort(function (a, b) { return log[b].at - log[a].at; });
    const out = {}; keys.slice(0, LOG_MAX).forEach(function (k) { out[k] = log[k]; });
    return out;
  }

  /* ---------------- what to say ---------------- */

  function timeWord(ms, zone, now) {
    const w = C.instantToWall(ms, zone), today = C.instantToWall(now, zone).date;
    return C.timeLabel(w.time) + (w.date === today ? "" : " " + C.fmtDate(w.date, { weekday: "short", month: "short", day: "numeric" }));
  }
  function span(minutes) {
    const m = Math.round(Math.abs(minutes));
    if (m < 1) return "less than a minute";
    if (m < 60) return m + (m === 1 ? " minute" : " minutes");
    if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return h + (h === 1 ? " hour" : " hours") + (r ? " " + r + " min" : ""); }
    const d = Math.round(m / 1440); return d + (d === 1 ? " day" : " days");
  }
  // One line about the item as of `now`: "Starts in 30 minutes · 3:00 PM".
  function whenLine(e, now, zone) {
    if (e.allDay) {
      const today = C.instantToWall(now, zone).date, d = C.diffDays(today, e.date);
      return d === 0 ? "All day today" : d === 1 ? "All day tomorrow" : d > 1 ? "All day " + C.fmtDate(e.date, { weekday: "long", month: "short", day: "numeric" }) : "All day, started " + C.fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" });
    }
    const diff = (e.startMs - now) / 60000;
    if (Math.abs(diff) < 1) return "Starting now · " + timeWord(e.startMs, zone, now);
    return (diff > 0 ? "Starts in " + span(diff) : "Started " + span(diff) + " ago") + " · " + timeWord(e.startMs, zone, now);
  }

  // What to hand to the notification. With hideTitles on, the lock screen shows no event name.
  function notificationFor(e, notify, now, zone) {
    const n = C.notifySettings(notify), when = whenLine(e, now, zone);
    return {
      title: n.hideTitles ? "JARVIS" : e.title,
      body: n.hideTitles ? "You have something coming up." : when,
      tag: "cal:" + e.key,
      data: { kind: "calendar", id: e.itemKey, url: "./index.html?calReminder=" + encodeURIComponent(e.itemKey) }
    };
  }

  /* ---------------- telling you the truth about what is on ---------------- */

  // env: { supported, permission: "granted" | "denied" | "default", ios, standalone }.
  // -> { system: { state, text, canAsk }, inApp, closed }. The text never says more than is known.
  function status(env, notify) {
    const n = C.notifySettings(notify), e = env || {};
    let system;
    if (!e.supported) system = { state: "unsupported", text: "This browser can't show system notifications, so reminders appear inside JARVIS while it is open.", canAsk: false };
    else if (e.ios && !e.standalone) system = { state: "needs-home-screen", text: "On an iPhone, system notifications only work after you add JARVIS to the Home Screen and open it from there.", canAsk: false };
    else if (e.permission === "denied") system = { state: "blocked", text: "Notifications are blocked for JARVIS. They can only be allowed again in the browser's or phone's settings.", canAsk: false };
    else if (e.permission === "granted") system = { state: n.system ? "on" : "allowed-off", text: n.system ? "On. A notification is shown when a reminder comes due while JARVIS is open." : "Allowed, but off here.", canAsk: false };
    else system = { state: "not-asked", text: "Not asked yet. Turning this on will ask for your permission.", canAsk: true };
    return {
      system: system,
      inApp: n.inApp ? "On. A banner appears in JARVIS when a reminder comes due while it is open." : "Off. Reminders won't appear in JARVIS.",
      closed: "JARVIS shows calendar reminders only while it is open. If it is closed when one comes due, it is listed as missed the next time you open JARVIS. Calendar reminders are not sent to your phone by the server. Your Habits reminders are different: your server sends those, if you have set that up under Habits › Reminders."
    };
  }

  return {
    LIVE_MS: LIVE_MS, LOOKBACK_MS: LOOKBACK_MS, AHEAD_MS: AHEAD_MS, SNOOZES: SNOOZES,
    fireAtFor: fireAtFor, expiresAt: expiresAt, inQuiet: inQuiet, quietEnd: quietEnd, entries: entries, classify: classify, plan: plan,
    sanitizeLog: sanitizeLog, markShown: markShown, snooze: snooze, prune: prune, whenLine: whenLine, notificationFor: notificationFor, status: status
  };
});
