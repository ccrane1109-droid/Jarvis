/* ==========================================================================
   What happened to each reminder: the rules shared by the server
   (functions/lib/reminder-log.js, delivery.js) and the browser
   (js/reminders.js loads this file straight from the site), so the page and
   the server can never disagree about whether something counts as done.

   Plain data and pure functions only: no requires, no network, no clock
   (callers pass "now"), no time zones.

   An "event" is one reminder moment: the 8:00 AM creatine on one particular
   day. It is named after the reminder and the exact moment, so there can only
   ever be one:  users/{uid}/reminderEvents/{reminderId}_{20261019120000000}

     status   what the delivery step did:
              queued -> sent | missed | failed | no-device | cancelled
     outcome  what YOU did about it: null | "done" | "skipped"
     snoozedUntil / snoozeCount   set when you ask to be reminded again

   Nothing in this file, or anywhere on the server, ever sets an outcome by
   itself. Only a tap from you does. That matters most for medication: JARVIS
   never marks it as taken.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisReminderEvents = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SNOOZE_MINUTES = [5, 10, 15, 30, 60];
  const MAX_SNOOZES = 6;
  const ID_RE = /^[a-f0-9]{16}_\d{17}$/;
  // A notification that went out under an hour ago isn't "unanswered" yet; you may simply not have seen it.
  const FRESH_MS = 60 * 60 * 1000;

  function eventIdFor(reminderId, momentIso) {
    return reminderId + "_" + String(momentIso).replace(/[^0-9]/g, "");
  }

  function reminderIdOf(eventId) {
    return typeof eventId === "string" && ID_RE.test(eventId) ? eventId.slice(0, 16) : null;
  }

  // The moment an event name was made from (the reverse of eventIdFor), or null.
  function momentOf(eventId) {
    if (typeof eventId !== "string" || !ID_RE.test(eventId)) return null;
    const d = eventId.slice(17);
    const iso = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) + "T" + d.slice(8, 10) + ":" + d.slice(10, 12) + ":" + d.slice(12, 14) + "." + d.slice(14, 17) + "Z";
    return isMomentIso(iso) ? iso : null;
  }

  // A moment in exactly the form toISOString() writes, so the same moment always gives the same event name.
  function isMomentIso(v) {
    if (typeof v !== "string" || v.length !== 24) return false;
    const t = Date.parse(v);
    return !isNaN(t) && new Date(t).toISOString() === v;
  }

  // One word for where an event stands right now.
  //   done | skipped         you answered it
  //   snoozed                you asked to be reminded again, and that time hasn't come
  //   sending                waiting for the next delivery run (or being retried)
  //   awaiting               sent to your phone; no answer from you yet
  //   missed | failed | no-device | cancelled   it didn't reach you (cancelled: you undid an early "done")
  //   test                   a test notification, not a reminder
  function stateOf(e, nowMs) {
    if (!e) return "none";
    if (e.kind === "test") return "test";
    if (e.outcome === "done") return "done";
    if (e.outcome === "skipped") return "skipped";
    if (e.status === "queued") return e.snoozedUntil && Date.parse(e.snoozedUntil) > nowMs ? "snoozed" : "sending";
    if (e.status === "sent") return "awaiting";
    if (e.status === "missed" || e.status === "failed" || e.status === "no-device" || e.status === "cancelled") return e.status;
    return "sending";
  }

  // States that mean "this reminder passed and you haven't dealt with it".
  const OPEN_STATES = ["awaiting", "sending", "missed", "failed", "no-device", "cancelled", "due"];

  // Today's plan against what happened. Pure: reminders are what the page already holds
  // ({ id, title, category, timezone, enabled, today[], updatedAt }); events are the recent records.
  //   items     one per reminder moment today, soonest first, each with its state
  //   counts    done, skipped, snoozed, open, upcoming, total
  //   percent   done out of everything you didn't deliberately skip (null when there is nothing to measure)
  //   open      the items that passed without an answer
  function dayView(reminders, events, nowMs) {
    const byId = {};
    (events || []).forEach(function (e) { if (e && typeof e.id === "string") byId[e.id] = e; });
    const items = [];
    (reminders || []).forEach(function (r) {
      if (!r || r.enabled === false) return;
      (r.today || []).forEach(function (iso) {
        const id = eventIdFor(r.id, iso);
        const e = byId[id] || null;
        const at = Date.parse(iso);
        let state;
        if (e) state = stateOf(e, nowMs);
        else if (at > nowMs) state = "upcoming";
        else if (r.updatedAt && Date.parse(r.updatedAt) >= at) return; // the reminder was made or changed after this moment: it was never due
        else state = "due";
        if (state === "test") return;
        items.push({
          reminderId: r.id, eventId: id, title: r.title, category: r.category, timezone: r.timezone, scheduledFor: iso,
          state: state, snoozedUntil: e ? e.snoozedUntil || null : null, outcomeAt: e ? e.outcomeAt || null : null,
          snoozeCount: e ? e.snoozeCount || 0 : 0, hasEvent: !!e
        });
      });
    });
    items.sort(function (a, b) { return a.scheduledFor < b.scheduledFor ? -1 : a.scheduledFor > b.scheduledFor ? 1 : a.title.localeCompare(b.title); });
    const counts = { done: 0, skipped: 0, snoozed: 0, open: 0, upcoming: 0, total: items.length };
    items.forEach(function (it) {
      if (it.state === "done") counts.done++;
      else if (it.state === "skipped") counts.skipped++;
      else if (it.state === "snoozed") counts.snoozed++;
      else if (it.state === "upcoming") counts.upcoming++;
      else counts.open++;
    });
    const measured = counts.total - counts.skipped;
    return {
      items: items, counts: counts,
      percent: measured > 0 ? Math.round(100 * counts.done / measured) : null,
      open: items.filter(function (it) { return OPEN_STATES.indexOf(it.state) !== -1; })
    };
  }

  // How each reminder went over a stretch of days, from the records alone.
  // done / skipped / open count reminders that passed; "pending" ones went out under an hour ago and wait for you.
  function summarize(events, nowMs) {
    const by = {};
    const order = [];
    (events || []).forEach(function (e) {
      if (!e || e.kind === "test" || !e.reminderId) return;
      const state = stateOf(e, nowMs);
      if (state === "snoozed" || state === "none") return;
      let s = by[e.reminderId];
      if (!s) { s = by[e.reminderId] = { reminderId: e.reminderId, title: e.title, category: e.category, done: 0, skipped: 0, open: 0, pending: 0, total: 0, latest: "" }; order.push(s); }
      if (e.scheduledFor > s.latest) { s.latest = e.scheduledFor; s.title = e.title; s.category = e.category; }
      s.total++;
      if (state === "done") s.done++;
      else if (state === "skipped") s.skipped++;
      else if (state === "awaiting" && nowMs - Date.parse(e.scheduledFor) < FRESH_MS) s.pending++;
      else s.open++;
    });
    order.forEach(function (s) {
      const measured = s.done + s.open;
      s.percent = measured > 0 ? Math.round(100 * s.done / measured) : null;
    });
    order.sort(function (a, b) { return a.title.localeCompare(b.title); });
    const all = { done: 0, skipped: 0, open: 0, pending: 0, total: 0 };
    order.forEach(function (s) { ["done", "skipped", "open", "pending", "total"].forEach(function (k) { all[k] += s[k]; }); });
    const measured = all.done + all.open;
    all.percent = measured > 0 ? Math.round(100 * all.done / measured) : null;
    return { reminders: order, all: all };
  }

  return { SNOOZE_MINUTES: SNOOZE_MINUTES, MAX_SNOOZES: MAX_SNOOZES, FRESH_MS: FRESH_MS, OPEN_STATES: OPEN_STATES, ID_RE: ID_RE, eventIdFor: eventIdFor, reminderIdOf: reminderIdOf, momentOf: momentOf, isMomentIso: isMomentIso, stateOf: stateOf, dayView: dayView, summarize: summarize };
});
