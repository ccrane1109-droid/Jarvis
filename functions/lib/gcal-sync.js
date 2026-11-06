/* ==========================================================================
   JARVIS — Google Calendar sync: the rules (pure functions: no network, no clock, no secrets, no database).

   STATUS: NOT CONNECTED TO ANYTHING. Nothing in JARVIS calls this file yet. It exists so the hard part of a future Google
   Calendar sync (turning events from one side into the other, working out what changed, and handling the cases that go
   wrong) is written down as code and checked by tests BEFORE any credentials are involved. The tests use payloads shaped
   like Google's documentation, not real answers from Google, so passing them does not show it works against Google.
   See docs/google-calendar.md for the design, what has been verified, and what has not.

   Self-contained on purpose: the server folder is deployed on its own, so this file does not load anything from the
   website's js/ folder.

   What it covers:
   - ids: JARVIS ids as Google event ids (lowercase letters a-v and digits 0-9, 5 to 1024 characters)
   - JARVIS event <-> Google event (timed, all-day with Google's exclusive end date, repeats, skipped days, reminders)
   - pulling: a page of changes from Google (incremental sync token, cancelled events, a full resync after "410 Gone") into
     what to add, change and remove here
   - pushing: what changed here since the last sync into what to create, update and delete at Google
   - the policy when both sides changed (the newer edit wins; a deletion wins; every such case is reported)

   Only events with a length (kinds event, block, content) and milestones are synced. Tasks and reminders are not: Google
   Calendar has no event kind for them.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisGcalSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SYNC_KINDS = ["event", "block", "content", "milestone"];
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const GOOGLE_MAX_REMINDER_MIN = 40320, ID_PREFIX = "jarvis:";

  /* ---------------- dates and time zones ---------------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s; }
  function isTime(s) { return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function addDays(date, n) { const d = new Date(Date.parse(date + "T00:00:00Z") + n * 86400000); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function minutesOf(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); }
  const fmts = {};
  function formatter(zone) { if (!fmts[zone]) fmts[zone] = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); return fmts[zone]; }
  function isValidZone(z) { if (typeof z !== "string" || !z) return false; try { formatter(z); return true; } catch (e) { return false; } }
  function parts(ms, zone) { const o = {}; formatter(zone).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; }); return { y: Number(o.year), mo: Number(o.month), d: Number(o.day), h: Number(o.hour) % 24, mi: Number(o.minute), s: Number(o.second) }; }
  function offsetMs(ms, zone) { const w = parts(ms, zone); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - (ms - ((ms % 1000) + 1000) % 1000); }
  function instantToWall(ms, zone) { const w = parts(ms, zone); return { date: w.y + "-" + pad(w.mo) + "-" + pad(w.d), time: pad(w.h) + ":" + pad(w.mi) }; }
  function wallToInstant(date, time, zone) {
    const p = date.split("-").map(Number), t = time.split(":").map(Number), asUtc = Date.UTC(p[0], p[1] - 1, p[2], t[0], t[1]);
    const cands = [offsetMs(asUtc - 86400000, zone), offsetMs(asUtc + 86400000, zone)].map(function (o) { return asUtc - o; });
    const valid = cands.filter(function (c) { const w = instantToWall(c, zone); return w.date + " " + w.time === date + " " + time; });
    return valid.length ? Math.min.apply(null, valid) : cands[0];
  }
  function offsetText(ms, zone) { const m = Math.round(offsetMs(ms, zone) / 60000), a = Math.abs(m); return (m < 0 ? "-" : "+") + pad(Math.floor(a / 60)) + ":" + pad(a % 60); }
  function utcStamp(ms) { const d = new Date(ms); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"; }
  function ymd(date) { return date.replace(/-/g, ""); }
  function ymdhm(date, time) { return date.replace(/-/g, "") + "T" + time.slice(0, 2) + time.slice(3, 5) + "00"; }
  function ms(v) { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }

  /* ---------------- ids ---------------- */

  const B32 = "0123456789abcdefghijklmnopqrstuv";
  // Two trailing characters that depend on all the others, so a damaged or foreign id is recognised as not ours.
  function check2(body) { let h = 7; for (let i = 0; i < body.length; i++) h = (h * 33 + body.charCodeAt(i)) % 1024; return B32[h >> 5] + B32[h & 31]; }
  // JARVIS id -> a Google event id. Deterministic, so a retried create uses the same id.
  function idFor(jarvisId) {
    const bytes = Array.from(typeof TextEncoder !== "undefined" ? new TextEncoder().encode(ID_PREFIX + jarvisId) : Buffer.from(ID_PREFIX + jarvisId, "utf8"));
    let bits = "", out = "";
    bytes.forEach(function (b) { bits += ("00000000" + b.toString(2)).slice(-8); });
    for (let i = 0; i < bits.length; i += 5) out += B32[parseInt((bits.slice(i, i + 5) + "0000").slice(0, 5), 2)];
    return out + check2(out);
  }
  // A Google event id that was made by idFor -> the JARVIS id, or null if it came from somewhere else (or was damaged).
  function jarvisIdOf(googleId) {
    if (typeof googleId !== "string" || !/^[0-9a-v]{7,1024}$/.test(googleId)) return null;
    const body = googleId.slice(0, -2);      // the last two characters are the checksum; the comparison at the end checks them
    let bits = ""; for (let i = 0; i < body.length; i++) bits += ("00000" + B32.indexOf(body[i]).toString(2)).slice(-5);
    const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    let s; try { s = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)) : Buffer.from(bytes).toString("utf8"); } catch (e) { return null; }
    if (s.indexOf(ID_PREFIX) !== 0 || /[\u0000-\u001f\u007f]/.test(s)) return null;
    const id = s.slice(ID_PREFIX.length);
    return id && idFor(id) === googleId ? id : null;
  }

  /* ---------------- JARVIS -> Google ---------------- */

  function syncable(ev) { return !!ev && SYNC_KINDS.indexOf(ev.kind) !== -1 && /^\d{4}-\d{2}-\d{2}$/.test(ev.date || ""); }

  // The body to send when creating or changing an event at Google. -> { body, dropped: [text] } or { skip: reason }.
  // o: { allDayAt }  (what time of day all-day reminders count from)
  function toGoogle(ev, o) {
    if (!syncable(ev)) return { skip: "its kind (" + (ev && ev.kind) + ") has no Google Calendar equivalent" };
    const opts = Object.assign({ allDayAt: "09:00" }, o || {}), dropped = [];
    const dateOnly = !!ev.allDay || (ev.kind === "milestone" && !ev.time);
    const body = { summary: ev.title, status: "confirmed" };
    const desc = [ev.description, ev.notes ? "Notes: " + ev.notes : ""].filter(Boolean).join("\n\n");
    if (desc) body.description = desc;
    if (dateOnly) {
      body.start = { date: ev.date }; body.end = { date: addDays(ev.allDay ? ev.endDate || ev.date : ev.date, 1) };
    } else {
      const startMs = wallToInstant(ev.date, ev.time, ev.tz);
      const endMs = ev.kind === "milestone" || !ev.endTime ? startMs + 15 * 60000 : wallToInstant(ev.endDate || ev.date, ev.endTime, ev.tz);
      body.start = { dateTime: ev.date + "T" + ev.time + ":00" + offsetText(startMs, ev.tz), timeZone: ev.tz };
      const e = instantToWall(endMs, ev.tz);
      body.end = { dateTime: e.date + "T" + e.time + ":00" + offsetText(endMs, ev.tz), timeZone: ev.tz };
      if (ev.kind === "milestone") dropped.push("a milestone has no length, so it was sent as 15 minutes");
    }
    if (ev.repeat) {
      const r = ev.repeat, rule = ["FREQ=" + r.freq.toUpperCase()];
      if (r.interval > 1) rule.push("INTERVAL=" + r.interval);
      if (r.freq === "weekly" && r.byDay && r.byDay.length) rule.push("BYDAY=" + r.byDay.map(function (d) { return DAYS[d]; }).join(","));
      if (r.until) rule.push("UNTIL=" + (dateOnly ? ymd(r.until) : utcStamp(wallToInstant(r.until, ev.time || "23:59", ev.tz))));
      else if (r.count) rule.push("COUNT=" + r.count);
      body.recurrence = ["RRULE:" + rule.join(";")];
      (ev.exceptions || []).slice().sort().forEach(function (d) { body.recurrence.push(dateOnly ? "EXDATE;VALUE=DATE:" + ymd(d) : "EXDATE;TZID=" + ev.tz + ":" + ymdhm(d, ev.time)); });
    }
    const overrides = [], allDayMin = minutesOf(isTime(opts.allDayAt) ? opts.allDayAt : "09:00");
    (ev.reminders || []).forEach(function (m) {
      // For an all-day item Google counts back from midnight, JARVIS from the all-day time; a reminder earlier than midnight can't be sent.
      const minutes = dateOnly ? m - allDayMin : m;
      if (minutes < 0 || minutes > GOOGLE_MAX_REMINDER_MIN) dropped.push("a reminder of " + m + " minutes can't be expressed at Google"); else overrides.push({ method: "popup", minutes: minutes });
    });
    body.reminders = { useDefault: false, overrides: overrides };
    return { body: body, dropped: dropped };
  }

  /* ---------------- Google -> JARVIS ---------------- */

  function repeatOf(rule, startDate) {
    const rr = {}; String(rule).split(";").forEach(function (kv) { const i = kv.indexOf("="); if (i > 0) rr[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
    const freq = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }[rr.FREQ];
    if (!freq) return { unsupported: rr.FREQ ? "it repeats " + rr.FREQ.toLowerCase() : "its repeat rule has no frequency" };
    const interval = rr.INTERVAL === undefined ? 1 : Number(rr.INTERVAL);
    if (!Number.isInteger(interval) || interval < 1 || interval > 99) return { unsupported: "its repeat interval is out of range" };
    const day = Number(startDate.slice(8, 10)), month = Number(startDate.slice(5, 7));
    const byDay = rr.BYDAY ? rr.BYDAY.split(",") : null, plain = byDay && byDay.every(function (d) { return DAYS.indexOf(d) !== -1; });
    const bmd = rr.BYMONTHDAY ? rr.BYMONTHDAY.split(",").map(Number) : null, bm = rr.BYMONTH ? rr.BYMONTH.split(",").map(Number) : null;
    if (rr.BYSETPOS || rr.BYWEEKNO || rr.BYYEARDAY || rr.BYHOUR || rr.BYMINUTE || rr.BYSECOND) return { unsupported: "its repeat rule is more detailed than JARVIS can show" };
    const r = { freq: freq, interval: interval };
    if (freq === "weekly") { if ((byDay && !plain) || bmd || bm) return { unsupported: "its repeat rule is more detailed than JARVIS can show" }; if (byDay) r.byDay = byDay.map(function (d) { return DAYS.indexOf(d); }); }
    else if (freq === "daily") { if (byDay || bmd || bm) return { unsupported: "its repeat rule is more detailed than JARVIS can show" }; }
    else if (freq === "monthly") { if (byDay || (bmd && !(bmd.length === 1 && bmd[0] === day)) || bm) return { unsupported: "it repeats on a particular weekday or day other than its start" }; }
    else if (byDay || (bmd && !(bmd.length === 1 && bmd[0] === day)) || (bm && !(bm.length === 1 && bm[0] === month))) return { unsupported: "its yearly repeat rule is more detailed than JARVIS can show" };
    if (rr.UNTIL) r.until = rr.UNTIL;      // resolved to a date by the caller, who knows the zone
    else if (rr.COUNT) { const n = Number(rr.COUNT); if (Number.isInteger(n) && n >= 1 && n <= 999) r.count = n; }
    return { repeat: r };
  }
  function dateOfStamp(v, zone) {
    if (/^\d{8}$/.test(v)) return v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8);
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!m) return "";
    if (m[7]) return instantToWall(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), zone).date;
    return m[1] + "-" + m[2] + "-" + m[3];
  }

  // One event from Google's list. o: { zone (where times without a zone are shown), allDayAt }
  // -> { kind: "upsert", externalId, input, meta, notes } | { kind: "delete", externalId }
  //  | { kind: "exception", parentId, date } | { kind: "skip", externalId, reason }
  function fromGoogle(g, o) {
    const opts = Object.assign({ zone: "UTC", allDayAt: "09:00" }, o || {}), id = g && typeof g.id === "string" ? g.id : "";
    if (!id) return { kind: "skip", externalId: "", reason: "it has no id" };
    if (g.recurringEventId) {
      const od = g.originalStartTime && (g.originalStartTime.date || (g.originalStartTime.dateTime && instantToWall(ms(g.originalStartTime.dateTime), g.originalStartTime.timeZone && isValidZone(g.originalStartTime.timeZone) ? g.originalStartTime.timeZone : opts.zone).date));
      if (g.status === "cancelled" && od && isDate(od)) return { kind: "exception", parentId: g.recurringEventId, date: od, externalId: id };
      return { kind: "skip", externalId: id, reason: "it is one changed showing of a repeating event, which JARVIS can't show" };
    }
    if (g.status === "cancelled") return { kind: "delete", externalId: id };
    const notes = [], s = g.start || {}, e = g.end || {};
    const input = { title: String(g.summary || "(no title)").replace(/\s+/g, " ").trim().slice(0, 140) || "(no title)", kind: "event", category: "other", priority: "medium", reminders: [] };
    let allDayAt = isTime(opts.allDayAt) ? opts.allDayAt : "09:00";
    if (s.date) {
      if (!isDate(s.date)) return { kind: "skip", externalId: id, reason: "its start date isn't readable" };
      input.allDay = true; input.date = s.date; input.tz = opts.zone;
      const last = isDate(e.date) ? addDays(e.date, -1) : s.date; input.endDate = last < s.date ? s.date : last;
    } else if (s.dateTime) {
      const startMs = ms(s.dateTime);
      if (!startMs) return { kind: "skip", externalId: id, reason: "its start time isn't readable" };
      const tz = isValidZone(s.timeZone) ? s.timeZone : opts.zone, w = instantToWall(startMs, tz);
      input.allDay = false; input.date = w.date; input.time = w.time; input.tz = tz;
      const endMs = ms(e.dateTime);
      if (endMs > startMs) { const x = instantToWall(endMs, tz); input.endDate = x.date; input.endTime = x.time; } else notes.push("it has no usable end time, so it gets your usual event length");
    } else return { kind: "skip", externalId: id, reason: "it has no start" };
    const place = g.location ? String(g.location).replace(/\s+/g, " ").trim() : "", body = g.description ? String(g.description).trim() : "";
    input.description = [place ? "Location: " + place : "", body].filter(Boolean).join("\n").slice(0, 2000);
    // repeats and skipped days
    const meta = { source: "google", externalId: id, updated: ms(g.updated), exceptions: [] };
    if (Array.isArray(g.recurrence) && g.recurrence.length) {
      const rrule = g.recurrence.filter(function (r) { return /^RRULE:/i.test(r); })[0];
      if (rrule) {
        const rep = repeatOf(rrule.slice(6), input.date);
        if (rep.unsupported) notes.push("only its first showing was kept: " + rep.unsupported);
        else {
          input.repeat = rep.repeat;
          if (input.repeat.until) { const d = dateOfStamp(input.repeat.until, input.tz); if (d) input.repeat.until = d; else delete input.repeat.until; }
          g.recurrence.filter(function (r) { return /^EXDATE/i.test(r); }).forEach(function (x) {
            const i = x.indexOf(":"); if (i < 0) return;
            x.slice(i + 1).split(",").forEach(function (v) { const d = dateOfStamp(v.trim(), input.tz); if (d && isDate(d)) meta.exceptions.push(d); });
          });
        }
      }
      if (g.recurrence.some(function (r) { return /^(RDATE|EXRULE)/i.test(r); })) notes.push("extra dates or exclusion rules were ignored");
    }
    // reminders: only pop-ups with a fixed number of minutes are copied
    const rem = g.reminders || {};
    if (rem.useDefault) notes.push("it uses your Google default reminders, which are not copied");
    const got = [];
    (Array.isArray(rem.overrides) ? rem.overrides : []).forEach(function (r) {
      if (!r || r.method !== "popup" || !Number.isInteger(r.minutes) || r.minutes < 0) { notes.push("a " + (r && r.method ? r.method : "") + " reminder was not copied"); return; }
      const offset = input.allDay ? minutesOf(allDayAt) + r.minutes : r.minutes;
      if (offset > 10080) { notes.push("a reminder more than a week ahead was not copied"); return; }
      if (got.indexOf(offset) === -1) got.push(offset);
    });
    got.sort(function (a, b) { return b - a; }); if (got.length > 5) { notes.push("only five reminders can be kept"); got.length = 5; }
    input.reminders = got;
    return { kind: "upsert", externalId: id, input: input, meta: meta, notes: notes };
  }

  /* ---------------- pulling: a page of changes from Google ---------------- */

  // state: { syncToken, map: { jarvisId: { googleId, syncedAt, googleUpdated } } }   events: this side's events (with updatedAt, deletedAt)
  // resp: { status: 200, items, nextPageToken, nextSyncToken } or { status: 410, reason }
  // -> { done, nextSyncToken, resetSync, upserts, deletes, exceptions, skipped, conflicts }
  function planPull(state, resp, events, o) {
    const st = state || { syncToken: "", map: {} }, out = { done: false, nextSyncToken: null, resetSync: false, upserts: [], deletes: [], exceptions: [], skipped: [], conflicts: [] };
    if (!resp || typeof resp !== "object") return Object.assign(out, { error: "no answer from Google" });
    if (resp.status === 410) {
      // Google: "wipe the store and do a full sync", except for "deleted" (an already-deleted event), which needs nothing.
      if (resp.reason === "deleted") return Object.assign(out, { done: true });
      return Object.assign(out, { resetSync: true, done: true });
    }
    if (resp.status !== 200) return Object.assign(out, { error: "Google answered " + resp.status });
    const byGoogle = {}; Object.keys(st.map || {}).forEach(function (j) { byGoogle[st.map[j].googleId] = j; });
    const local = {}; (events || []).forEach(function (e) { local[e.id] = e; });
    const latest = {};
    (Array.isArray(resp.items) ? resp.items : []).forEach(function (g) { if (g && g.id && (!latest[g.id] || ms(g.updated) >= ms(latest[g.id].updated))) latest[g.id] = g; });
    Object.keys(latest).forEach(function (gid) {
      const r = fromGoogle(latest[gid], o), jid = byGoogle[gid] || null, mine = jid ? local[jid] : null, link = jid ? st.map[jid] : null;
      const editedHere = !!(mine && link && Number(mine.updatedAt) > Number(link.syncedAt));
      if (r.kind === "skip") { out.skipped.push({ externalId: gid, reason: r.reason }); return; }
      if (r.kind === "exception") { const pj = byGoogle[r.parentId]; if (pj) out.exceptions.push({ jarvisId: pj, date: r.date }); else out.skipped.push({ externalId: gid, reason: "its repeating event isn't here" }); return; }
      if (r.kind === "delete") {
        if (!jid || !mine || mine.deletedAt) { if (jid) out.deletes.push({ googleId: gid, jarvisId: jid, already: true }); return; }
        if (editedHere) out.conflicts.push({ jarvisId: jid, googleId: gid, winner: "google", why: "deleted at Google after you changed it here; the deletion wins, and the event is kept in the calendar's trash for 30 days" });
        out.deletes.push({ googleId: gid, jarvisId: jid });
        return;
      }
      if (editedHere && mine && !mine.deletedAt && Number(mine.updatedAt) >= r.meta.updated) { out.conflicts.push({ jarvisId: jid, googleId: gid, winner: "jarvis", why: "changed in both places; your newer edit is kept and will be sent to Google" }); return; }
      if (editedHere) out.conflicts.push({ jarvisId: jid, googleId: gid, winner: "google", why: "changed in both places; Google's newer edit replaces yours" });
      out.upserts.push({ googleId: gid, jarvisId: jid, input: r.input, meta: r.meta, notes: r.notes, isNew: !jid });
    });
    out.done = !resp.nextPageToken;
    // The sync token comes only with the last page. Keeping it any earlier would skip the pages still to come.
    out.nextSyncToken = out.done && typeof resp.nextSyncToken === "string" ? resp.nextSyncToken : null;
    return out;
  }

  // After a full sync (no token): Google events this side has linked but Google no longer returned were deleted there.
  function planFullReconcile(state, seenGoogleIds, events) {
    const seen = {}; (seenGoogleIds || []).forEach(function (g) { seen[g] = true; });
    const local = {}; (events || []).forEach(function (e) { local[e.id] = e; });
    const deletes = [];
    Object.keys((state && state.map) || {}).forEach(function (j) { const link = state.map[j]; if (!seen[link.googleId] && local[j] && !local[j].deletedAt) deletes.push({ googleId: link.googleId, jarvisId: j }); });
    return { deletes: deletes };
  }

  /* ---------------- pushing: what changed here ---------------- */

  // -> { creates: [{ jarvisId, id, body }], updates: [{ jarvisId, googleId, body }], deletes: [{ jarvisId, googleId }], skipped: [{ jarvisId, reason }], dropped: [{ jarvisId, text }] }
  function planPush(state, events, o) {
    const st = state || { syncToken: "", map: {} }, out = { creates: [], updates: [], deletes: [], skipped: [], dropped: [] };
    (events || []).forEach(function (ev) {
      const link = st.map && st.map[ev.id];
      if (ev.deletedAt) { if (link) out.deletes.push({ jarvisId: ev.id, googleId: link.googleId }); return; }
      if (ev.source === "google" && !link) { out.skipped.push({ jarvisId: ev.id, reason: "it came from Google but its link is missing, so it was not sent back" }); return; }
      if (link && !(Number(ev.updatedAt) > Number(link.syncedAt))) return;        // nothing new here since the last sync (also stops an echo of what was just pulled)
      const t = toGoogle(ev, o);
      if (t.skip) { if (!link) out.skipped.push({ jarvisId: ev.id, reason: t.skip }); return; }
      t.dropped.forEach(function (d) { out.dropped.push({ jarvisId: ev.id, text: d }); });
      if (link) out.updates.push({ jarvisId: ev.id, googleId: link.googleId, body: t.body });
      else out.creates.push({ jarvisId: ev.id, id: idFor(ev.id), body: Object.assign({ id: idFor(ev.id) }, t.body) });
    });
    return out;
  }

  /* ---------------- remembering what has been done ---------------- */

  // done: { pulled: [{ googleId, jarvisId, updatedAt (this side, after saving), googleUpdated }], removed: [googleId], pushed: [{ jarvisId, googleId, updatedAt, googleUpdated }], deletedHere: [jarvisId], syncToken }
  function commit(state, done) {
    const st = state || { syncToken: "", map: {} }, map = Object.assign({}, st.map), d = done || {};
    (d.pulled || []).forEach(function (p) { map[p.jarvisId] = { googleId: p.googleId, syncedAt: p.updatedAt, googleUpdated: p.googleUpdated || 0 }; });
    (d.pushed || []).forEach(function (p) { map[p.jarvisId] = { googleId: p.googleId, syncedAt: p.updatedAt, googleUpdated: p.googleUpdated || 0 }; });
    (d.removed || []).forEach(function (g) { Object.keys(map).forEach(function (j) { if (map[j].googleId === g) delete map[j]; }); });
    (d.deletedHere || []).forEach(function (j) { delete map[j]; });
    // After a reset the links are kept: the full sync that follows delivers every event again onto the same ones.
    return { syncToken: d.resetSync ? "" : (typeof d.syncToken === "string" && d.syncToken ? d.syncToken : st.syncToken), map: map };
  }

  return {
    SYNC_KINDS: SYNC_KINDS, idFor: idFor, jarvisIdOf: jarvisIdOf, syncable: syncable, toGoogle: toGoogle, fromGoogle: fromGoogle,
    planPull: planPull, planFullReconcile: planFullReconcile, planPush: planPush, commit: commit, isValidZone: isValidZone
  };
});
