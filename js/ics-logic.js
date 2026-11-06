/* ==========================================================================
   JARVIS — Calendar files (.ics): the rules (pure functions, no page access, so they can be tested outside the browser).

   An .ics file is the standard way calendars (Google Calendar, Apple Calendar, Outlook) swap events by file. This lets you
   take your JARVIS events out as a file and bring events in from one, without any account, password or key.

   What it does and does not do:
   - It moves events once. It is not a sync: changes made later in either place don't follow.
   - Import reads events (VEVENT) only: title, description, place, start and end (time zones, all-day), simple repeats
     (daily, weekly, monthly, yearly), skipped dates and "before" reminders. Things it can't represent are skipped or
     simplified, and each one is reported with the reason. Nothing is added until you press Add.
   - Events that came from a file remember their original ID, so importing the same file again adds nothing twice, and a
     file made by JARVIS never brings back events that are already here.
   - It has been checked against its own output and against hand-written files. It has not been checked against a file
     from Google, Apple or Outlook, or by importing JARVIS's file into them.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calendar-logic.js"));
  else root.JarvisICS = factory(root.JarvisCalendarLogic);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const PRODID = "-//JARVIS//Calendar//EN", MAX_IMPORT = 500, DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(date) { return date.replace(/-/g, ""); }
  function ymdhm(date, time) { return date.replace(/-/g, "") + "T" + time.slice(0, 2) + time.slice(3, 5) + "00"; }
  function utcStamp(ms) { const d = new Date(ms); return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + "T" + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + "Z"; }

  /* ---------------- writing a file ---------------- */

  function esc(t) { return String(t === undefined || t === null ? "" : t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n"); }
  // Lines are at most 75 bytes; a longer one continues on the next line after a space.
  function fold(line) {
    const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null, out = [];
    let cur = "", bytes = 0, limit = 75;
    Array.from(line).forEach(function (ch) {
      const b = enc ? enc.encode(ch).length : ch.length;
      if (bytes + b > limit) { out.push(cur); cur = " "; bytes = 1; limit = 75; }
      cur += ch; bytes += b;
    });
    out.push(cur);
    return out.join("\r\n");
  }

  function alarmTrigger(offset, allDay, allDayMin) {
    // Timed: N minutes before the start. All-day: JARVIS counts from the time you chose that day (9:00 AM to start), a file counts
    // from midnight, so the trigger is that many minutes after midnight, less the reminder's offset.
    const m = allDay ? allDayMin - offset : -offset, sign = m < 0 ? "-" : "";
    return sign + "PT" + Math.abs(m) + "M";
  }

  function vevent(ev, o) {
    const point = C.isPoint(ev.kind), dateOnly = ev.allDay || (point && !ev.time), L = [];
    const uid = ev.source === "ics" && ev.externalId ? ev.externalId : ev.id + "@jarvis";
    L.push("BEGIN:VEVENT", "UID:" + esc(uid), "DTSTAMP:" + utcStamp(o.now));
    if (dateOnly) {
      L.push("DTSTART;VALUE=DATE:" + ymd(ev.date), "DTEND;VALUE=DATE:" + ymd(C.addDays(ev.allDay ? ev.endDate || ev.date : ev.date, 1)));
    } else {
      L.push("DTSTART;TZID=" + ev.tz + ":" + ymdhm(ev.date, ev.time));
      if (!point && ev.endTime) L.push("DTEND;TZID=" + ev.tz + ":" + ymdhm(ev.endDate || ev.date, ev.endTime));
    }
    L.push("SUMMARY:" + esc(ev.title));
    const desc = [ev.description, ev.notes ? "Notes: " + ev.notes : ""].filter(Boolean).join("\n\n");
    if (desc) L.push("DESCRIPTION:" + esc(desc));
    L.push("CATEGORIES:" + esc(C.categoryInfo(ev.category).label), "PRIORITY:" + (ev.priority === "high" ? 1 : ev.priority === "low" ? 9 : 5), "X-JARVIS-KIND:" + ev.kind);
    if (ev.repeat) {
      const r = ev.repeat, parts = ["FREQ=" + r.freq.toUpperCase()];
      if (r.interval > 1) parts.push("INTERVAL=" + r.interval);
      if (r.freq === "weekly" && r.byDay && r.byDay.length) parts.push("BYDAY=" + r.byDay.map(function (d) { return DAYS[d]; }).join(","));
      if (r.until) parts.push("UNTIL=" + (dateOnly ? ymd(r.until) : utcStamp(C.wallToInstant(r.until, ev.time || "23:59", ev.tz))));
      else if (r.count) parts.push("COUNT=" + r.count);
      L.push("RRULE:" + parts.join(";"));
      (ev.exceptions || []).slice().sort().forEach(function (d) { L.push(dateOnly ? "EXDATE;VALUE=DATE:" + ymd(d) : "EXDATE;TZID=" + ev.tz + ":" + ymdhm(d, ev.time)); });
    }
    const allDayMin = C.minutesOf(o.allDayAt);
    (ev.reminders || []).forEach(function (m) { L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(ev.title), "TRIGGER:" + alarmTrigger(m, dateOnly, allDayMin), "END:VALARM"); });
    L.push("END:VEVENT");
    return L;
  }

  // The file text for these events (deleted ones are left out). o: { now, allDayAt, name }.
  function toICS(events, o) {
    const opts = Object.assign({ now: Date.now(), allDayAt: "09:00", name: "JARVIS" }, o || {});
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:" + PRODID, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc(opts.name)];
    C.live(events).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "") < (b.time || "") ? -1 : 1; }).forEach(function (ev) { Array.prototype.push.apply(L, vevent(ev, opts)); });
    L.push("END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }

  /* ---------------- reading a file ---------------- */

  function unescapeText(v) { return String(v).replace(/\\(.)/g, function (m, c) { return c === "n" || c === "N" ? "\n" : c; }); }
  function splitUnquoted(s, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '"') q = !q; if (ch === sep && !q) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur);
    return out;
  }
  function parseLine(line) {
    let i = 0, q = false;
    for (; i < line.length; i++) { const ch = line[i]; if (ch === '"') q = !q; else if (ch === ":" && !q) break; }
    if (i >= line.length) return null;
    const parts = splitUnquoted(line.slice(0, i), ";"), params = {};
    parts.slice(1).forEach(function (p) { const eq = p.indexOf("="); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ""); });
    return { name: parts[0].toUpperCase(), params: params, value: line.slice(i + 1) };
  }
  function get(props, name) { return props.filter(function (p) { return p.name === name; })[0] || null; }
  function all(props, name) { return props.filter(function (p) { return p.name === name; }); }

  // "PT30M", "-PT1H", "P1D", "P1W" -> signed minutes, or null.
  function duration(v) {
    const m = String(v).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m || m[0] === "P" || m[0] === "-P" || m[0] === "+P") return null;
    const mins = (Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 1440 + Number(m[4] || 0) * 60 + Number(m[5] || 0) + Math.round(Number(m[6] || 0) / 60);
    return m[1] === "-" ? -mins : mins;
  }

  function dateOf(s) { const m = s.match(/^(\d{4})(\d{2})(\d{2})$/); const d = m ? m[1] + "-" + m[2] + "-" + m[3] : ""; return C.isDate(d) ? d : ""; }
  // A start or end value -> { allDay, date, time, tz, ms, utc } or null. zone: where floating and UTC times are shown.
  function when(prop, zone, notes) {
    const v = prop.value.trim(), dateOnlyValue = prop.params.VALUE === "DATE" || /^\d{8}$/.test(v);
    if (dateOnlyValue) { const d = dateOf(v); return d ? { allDay: true, date: d } : null; }
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!m) return null;
    const date = m[1] + "-" + m[2] + "-" + m[3], time = m[4] + ":" + m[5];
    if (!C.isDate(date) || !C.isTime(time)) return null;
    if (m[7]) { const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)), w = C.instantToWall(ms, zone); return { allDay: false, date: w.date, time: w.time, tz: zone, ms: ms, utc: true }; }
    let tz = zone;
    if (prop.params.TZID) {
      if (C.isValidZone(prop.params.TZID)) tz = prop.params.TZID;
      else if (notes && notes.indexOf("The time zone \u201c" + prop.params.TZID + "\u201d isn\u2019t one I know, so its times are read in " + zone + ".") === -1) notes.push("The time zone \u201c" + prop.params.TZID + "\u201d isn\u2019t one I know, so its times are read in " + zone + ".");
    }
    return { allDay: false, date: date, time: time, tz: tz, ms: C.wallToInstant(date, time, tz), utc: false };
  }

  function parseRRule(value) {
    const out = {};
    String(value).split(";").forEach(function (kv) { const i = kv.indexOf("="); if (i > 0) out[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
    return out;
  }
  // The repeat for one event, or { unsupported: reason }. start: { date }.
  function repeatOf(rr, start, tz) {
    const freq = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }[rr.FREQ];
    if (!freq) return { unsupported: rr.FREQ ? "it repeats " + rr.FREQ.toLowerCase() + ", which I can" + String.fromCharCode(8217) + "t show" : "it uses a repeat rule I can" + String.fromCharCode(8217) + "t show" };
    const interval = rr.INTERVAL === undefined ? 1 : Number(rr.INTERVAL);
    if (!Number.isInteger(interval) || interval < 1 || interval > 99) return { unsupported: "its repeat interval is out of range" };
    const day = Number(start.date.slice(8, 10)), month = Number(start.date.slice(5, 7));
    const byDay = rr.BYDAY ? rr.BYDAY.split(",") : null;
    const plain = byDay && byDay.every(function (d) { return DAYS.indexOf(d) !== -1; });
    const bmd = rr.BYMONTHDAY ? rr.BYMONTHDAY.split(",").map(Number) : null, bm = rr.BYMONTH ? rr.BYMONTH.split(",").map(Number) : null;
    const r = { freq: freq, interval: interval };
    if (rr.BYSETPOS || rr.BYWEEKNO || rr.BYYEARDAY || rr.BYHOUR || rr.BYMINUTE || rr.BYSECOND) return { unsupported: "its repeat rule is more detailed than I can show" };
    if (freq === "weekly") {
      if (byDay && !plain) return { unsupported: "it repeats on a particular week of the month" };
      if (bmd || bm) return { unsupported: "its repeat rule is more detailed than I can show" };
      if (byDay) r.byDay = byDay.map(function (d) { return DAYS.indexOf(d); });
    } else if (freq === "daily") {
      if (byDay || bmd || bm) return { unsupported: "its repeat rule is more detailed than I can show" };
    } else if (freq === "monthly") {
      if (byDay || (bmd && !(bmd.length === 1 && bmd[0] === day)) || bm) return { unsupported: "it repeats on a particular weekday or day of the month other than its start" };
    } else if (byDay || (bmd && !(bmd.length === 1 && bmd[0] === day)) || (bm && !(bm.length === 1 && bm[0] === month))) return { unsupported: "its yearly repeat rule is more detailed than I can show" };
    if (rr.UNTIL) {
      const u = rr.UNTIL, d = /^\d{8}$/.test(u) ? dateOf(u) : (function () { const w = when({ value: u, params: {} }, tz); return w ? w.date : ""; })();
      if (d) r.until = d;
    } else if (rr.COUNT) { const n = Number(rr.COUNT); if (Number.isInteger(n) && n >= 1 && n <= 999) r.count = n; }
    return { repeat: r };
  }

  function unfold(text) { return String(text).replace(/\r?\n[ \t]/g, "").split(/\r\n|\n|\r/); }

  // Reads a file's text. -> { events: [{ uid, input, meta, notes }], skipped: [{ title, reason }], other: n, total, problem }
  // o: { zone (where UTC and floating times are shown), allDayAt }
  function parse(text, o) {
    const opts = Object.assign({ zone: C.deviceZone(), allDayAt: "09:00" }, o || {});
    const out = { events: [], skipped: [], other: 0, total: 0, problem: "" };
    const lines = unfold(text).map(function (l) { return l.trim() === "" ? null : parseLine(l); }).filter(Boolean);
    if (!lines.some(function (l) { return l.name === "BEGIN" && l.value.toUpperCase() === "VCALENDAR"; })) { out.problem = "This doesn\u2019t look like a calendar file (.ics)."; return out; }
    const vevents = []; let cur = null, alarm = null;
    lines.forEach(function (l) {
      const v = l.value.toUpperCase();
      if (l.name === "BEGIN") {
        if (v === "VEVENT") cur = { props: [], alarms: [] };
        else if (v === "VALARM" && cur) alarm = { props: [] };
        else if (["VCALENDAR", "VTIMEZONE", "STANDARD", "DAYLIGHT", "VALARM"].indexOf(v) === -1 && !cur) out.other++;
      } else if (l.name === "END") {
        if (v === "VEVENT" && cur) { vevents.push(cur); cur = null; }
        else if (v === "VALARM" && cur && alarm) { cur.alarms.push(alarm); alarm = null; }
      } else if (alarm) alarm.props.push(l);
      else if (cur) cur.props.push(l);
    });
    out.total = vevents.length;
    vevents.forEach(function (ve) {
      const P = ve.props, notes = [], titleProp = get(P, "SUMMARY"), title = titleProp ? unescapeText(titleProp.value).replace(/\s+/g, " ").trim() : "";
      const label = title || "(no title)";
      const skip = function (reason) { out.skipped.push({ title: label, reason: reason }); };
      const status = get(P, "STATUS");
      if (status && status.value.trim().toUpperCase() === "CANCELLED") { skip("it was cancelled"); return; }
      if (get(P, "RECURRENCE-ID")) { skip("it is one changed showing of a repeating event, which I can\u2019t import yet"); return; }
      const ds = get(P, "DTSTART");
      if (!ds) { skip("it has no start"); return; }
      const start = when(ds, opts.zone, notes);
      if (!start) { skip("its start isn\u2019t a date I can read"); return; }
      const input = { title: (title || "(no title)").slice(0, C.TITLE_MAX), kind: "event", category: "other", priority: "medium", allDay: start.allDay, date: start.date, tz: start.tz || opts.zone, reminders: [] };
      // the end
      const de = get(P, "DTEND"), du = get(P, "DURATION"), endV = de ? when(de, opts.zone, notes) : null;
      if (start.allDay) {
        let last = start.date;
        if (endV && endV.allDay) last = C.addDays(endV.date, -1);
        else if (!endV && du) { const m = duration(du.value); if (m !== null && m > 0) last = C.addDays(start.date, Math.max(0, Math.ceil(m / 1440) - 1)); }
        if (last < start.date) last = start.date;
        input.endDate = last;
      } else {
        input.time = start.time;
        let endMs = null;
        if (endV && !endV.allDay) endMs = endV.ms;
        else if (!endV && du) { const m = duration(du.value); if (m !== null && m > 0) endMs = start.ms + m * 60000; }
        if (endMs !== null && endMs > start.ms) { const w = C.instantToWall(endMs, start.tz); input.endDate = w.date; input.endTime = w.time; }
        else notes.push("It has no end time, so it was given your usual event length.");
      }
      // text
      const loc = get(P, "LOCATION"), desc = get(P, "DESCRIPTION");
      const place = loc ? unescapeText(loc.value).replace(/\s+/g, " ").trim() : "", body = desc ? unescapeText(desc.value).trim() : "";
      let description = [place ? "Location: " + place : "", body].filter(Boolean).join("\n");
      if (description.length > C.DESC_MAX) { description = description.slice(0, C.DESC_MAX); notes.push("Its description was longer than " + C.DESC_MAX + " characters and was shortened."); }
      input.description = description;
      // kind and priority
      const kind = get(P, "X-JARVIS-KIND"); if (kind && C.KINDS.some(function (k) { return k.value === kind.value.trim(); })) input.kind = kind.value.trim();
      const pr = get(P, "PRIORITY"), pn = pr ? Number(pr.value) : 0;
      input.priority = pn >= 1 && pn <= 4 ? "high" : pn >= 6 && pn <= 9 ? "low" : "medium";
      // repeats
      const meta = { source: "ics", externalId: "", exceptions: [] };
      const uid = get(P, "UID"); meta.externalId = uid ? unescapeText(uid.value).trim().slice(0, 200) : "";
      const rr = get(P, "RRULE");
      if (rr) {
        const rep = repeatOf(parseRRule(rr.value), start, input.tz);
        if (rep.unsupported) notes.push("Only its first showing was imported: " + rep.unsupported + ".");
        else {
          input.repeat = rep.repeat;
          all(P, "EXDATE").forEach(function (x) {
            x.value.split(",").forEach(function (one) {
              const w = when({ value: one, params: x.params }, input.tz, notes);
              if (!w) return;
              meta.exceptions.push(w.allDay ? w.date : (w.utc ? C.instantToWall(w.ms, input.tz).date : (w.tz === input.tz ? w.date : C.instantToWall(w.ms, input.tz).date)));
            });
          });
        }
      }
      // reminders: only "N minutes before the start"
      const allDayMin = C.minutesOf(opts.allDayAt), got = [];
      let dropped = 0;
      ve.alarms.forEach(function (al) {
        const t = get(al.props, "TRIGGER");
        if (!t || (t.params.VALUE && t.params.VALUE !== "DURATION") || (t.params.RELATED && t.params.RELATED.toUpperCase() === "END")) { dropped++; return; }
        const m = duration(t.value);
        if (m === null) { dropped++; return; }
        const offset = start.allDay ? allDayMin - m : -m;
        if (offset < 0 || offset > 10080) { dropped++; return; }
        if (got.indexOf(offset) === -1) got.push(offset);
      });
      got.sort(function (a, b) { return b - a; });
      if (got.length > 5) { dropped += got.length - 5; got.length = 5; }
      input.reminders = got;
      if (dropped) notes.push(dropped + (dropped === 1 ? " reminder" : " reminders") + " couldn\u2019t be imported (only \u201cbefore the start\u201d reminders up to a week, five at most).");
      out.events.push({ uid: meta.externalId, input: input, meta: meta, notes: notes });
    });
    return out;
  }

  /* ---------------- what would be added ---------------- */

  // Sorts a parsed file into what would be added, what is already here and what is skipped. Nothing is changed.
  // -> { add: [{ uid, input, meta, notes }], duplicates: [title], skipped: [{ title, reason }], capped }
  function plan(existing, parsed, ctx) {
    const c = ctx || {}, live = C.live(existing), byExternal = {}, byId = {};
    live.forEach(function (e) { if (e.externalId) byExternal[e.externalId] = true; byId[e.id] = true; });
    const out = { add: [], duplicates: [], skipped: parsed.skipped.slice(), capped: 0 }, seen = {};
    parsed.events.forEach(function (e) {
      const own = /^(.+)@jarvis$/.exec(e.uid);
      if ((e.uid && (byExternal[e.uid] || seen[e.uid])) || (own && byId[own[1]])) { out.duplicates.push(e.input.title); return; }
      const r = C.check(e.input, { zone: e.input.tz, defaultDuration: c.defaultDuration || 60 });
      if (!r.ok) { out.skipped.push({ title: e.input.title, reason: r.error }); return; }
      if (out.add.length >= MAX_IMPORT) { out.capped++; return; }
      if (e.uid) seen[e.uid] = true;
      out.add.push(e);
    });
    return out;
  }

  // Adds the planned events. -> { events, added, failed: [{ title, reason }] }
  function apply(events, planned, ctx) {
    let cur = events, added = 0; const failed = [];
    planned.add.forEach(function (e) {
      const r = C.addImported(cur, e.input, e.meta, ctx);
      if (r.ok) { cur = r.events; added++; } else failed.push({ title: e.input.title, reason: r.error });
    });
    return { events: cur, added: added, failed: failed };
  }

  return { MAX_IMPORT: MAX_IMPORT, toICS: toICS, parse: parse, plan: plan, apply: apply, fold: fold, unfold: unfold, duration: duration, esc: esc };
});
