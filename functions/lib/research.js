/* ==========================================================================
   Competitor research runs (daily schedule + on demand).

   For each Instagram handle on the owner's watchlist, fetches the profile
   through insight.runInsightRequest (so caching, the monthly credit cap and
   the usage record all apply), keeps a per-handle history of the numeric
   fields InsightSocial returned (under InsightSocial's own field names), and
   writes a plain-language summary of what changed. The summary is built
   from the data itself; no AI call, so it costs nothing.

   Firestore (server-written, owner-readable):
     users/{uid}/marketingSnapshots/{handle}  { handle, updatedAt, latest, history[] }
     users/{uid}/marketingState/research      { lastRun, lastSuccessfulRunAt, runs[] }
   ========================================================================== */

"use strict";

const settingsLib = require("./settings");
const insight = require("./insight");

const HISTORY_LIMIT = 90;
const RUNS_LIMIT = 20;
const MANUAL_MIN_INTERVAL_MINUTES = 30;
const MAX_METRICS = 20;
const NON_METRIC_KEY = /(^|[._])(id|pk|fbid)$|timestamp|_at$|^credits_/i;

// Numeric fields from a profile response, keyed by their path in the
// response (one level of nesting), e.g. { followers: 1200, "stats.posts": 85 }.
function extractMetrics(body) {
  const root = body && typeof body === "object"
    ? (body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body)
    : {};
  const out = {};
  (function walk(obj, prefix, depth) {
    Object.keys(obj).forEach(function (k) {
      if (Object.keys(out).length >= MAX_METRICS) return;
      const name = prefix ? prefix + "." + k : k;
      const v = obj[k];
      if (NON_METRIC_KEY.test(name)) return;
      if (typeof v === "number" && Number.isFinite(v)) out[name] = v;
      else if (v && typeof v === "object" && !Array.isArray(v) && depth < 1) walk(v, name, depth + 1);
    });
  })(root, "", 0);
  return out;
}

function compareMetrics(prev, curr) {
  const changes = [];
  Object.keys(curr).forEach(function (name) {
    if (typeof prev[name] === "number" && prev[name] !== curr[name]) {
      changes.push({ name: name, before: prev[name], after: curr[name], delta: curr[name] - prev[name] });
    }
  });
  return changes.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
}

function fmt(n) { return Number(n).toLocaleString("en-US"); }

function describeChanges(handle, prev, changes, metricCount) {
  if (!prev) return "@" + handle + ": first snapshot saved (" + metricCount + " numeric field" + (metricCount === 1 ? "" : "s") + ").";
  if (!changes.length) return "@" + handle + ": no changes since " + prev.date + ".";
  const parts = changes.slice(0, 3).map(function (c) {
    return c.name + " " + fmt(c.before) + " → " + fmt(c.after) + " (" + (c.delta > 0 ? "+" : "") + fmt(c.delta) + ")";
  });
  return "@" + handle + ": " + parts.join(", ") + (changes.length > 3 ? ", +" + (changes.length - 3) + " more" : "") + " since " + prev.date + ".";
}

async function researchHandle(uid, handle, deps) {
  const res = await insight.runInsightRequest(uid, { endpoint: "instagram.profile", params: { handle: handle } }, deps);
  if (!res.ok) return { result: { handle: handle, ok: false, error: res.error }, line: "@" + handle + ": couldn't refresh (" + res.error + ").", credits: res.creditsUsed || 0 };

  const metrics = extractMetrics(res.body);
  const date = String(res.fetchedAt).slice(0, 10);
  const ref = deps.db.doc("users/" + uid + "/marketingSnapshots/" + handle);
  const snap = await ref.get();
  const history = snap.exists && Array.isArray(snap.data().history) ? snap.data().history : [];
  const earlier = history.filter(function (h) { return h.date < date; });
  const prev = earlier.length ? earlier[earlier.length - 1] : null;
  const entry = { date: date, fetchedAt: res.fetchedAt, metrics: metrics };
  const nextHistory = history.filter(function (h) { return h.date !== date; }).concat([entry])
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(-HISTORY_LIMIT);
  await ref.set({ handle: handle, updatedAt: res.fetchedAt, latest: entry, history: nextHistory });

  const changes = prev ? compareMetrics(prev.metrics || {}, metrics) : [];
  return {
    result: { handle: handle, ok: true, cached: !!res.cached, stale: !!res.stale, fetchedAt: res.fetchedAt, metricCount: Object.keys(metrics).length, changes: changes.slice(0, 10) },
    line: describeChanges(handle, prev, changes, Object.keys(metrics).length) + (res.stale ? " (saved data; monthly credit cap reached)" : ""),
    credits: res.creditsUsed || 0
  };
}

async function runResearch(uid, deps, opts) {
  insight.requireOwner(uid, deps);
  const trigger = (opts && opts.trigger) || "manual";
  const now = deps.now();
  const stateRef = deps.db.doc("users/" + uid + "/marketingState/research");
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() : {};

  if (trigger === "manual" && state.lastRun && state.lastRun.startedAt) {
    const minutes = (now.getTime() - new Date(state.lastRun.startedAt).getTime()) / 60000;
    if (minutes < MANUAL_MIN_INTERVAL_MINUTES) {
      return { ok: !!state.lastRun.ok, reused: true, run: state.lastRun, note: "Research ran less than " + MANUAL_MIN_INTERVAL_MINUTES + " minutes ago, so that run is shown instead of spending credits again." };
    }
  }

  const settings = await settingsLib.readSettings(deps.db, uid);
  const run = { id: now.toISOString(), trigger: trigger, startedAt: now.toISOString(), finishedAt: null, ok: false, creditsUsed: 0, results: [], summary: [] };

  if (!settings.watchlist.length) {
    run.summary.push("No competitors on your watchlist yet. Add Instagram handles in Competitors.");
  }
  let stopReason = null;
  for (const handle of settings.watchlist) {
    if (stopReason) {
      run.results.push({ handle: handle, ok: false, error: stopReason });
      continue;
    }
    try {
      const r = await researchHandle(uid, handle, deps);
      run.results.push(r.result);
      run.summary.push(r.line);
      run.creditsUsed += r.credits;
    } catch (err) {
      if (!(err instanceof insight.InsightError)) throw err;
      run.results.push({ handle: handle, ok: false, error: err.message });
      run.summary.push("@" + handle + ": " + err.message);
      if (err.code === "resource-exhausted" || err.code === "failed-precondition") stopReason = err.message;
    }
  }

  run.finishedAt = deps.now().toISOString();
  const anyOk = run.results.some(function (r) { return r.ok; });
  run.ok = run.results.length === 0 || anyOk;
  const compact = { id: run.id, trigger: run.trigger, startedAt: run.startedAt, finishedAt: run.finishedAt, ok: run.ok, creditsUsed: run.creditsUsed, handles: run.results.length, failures: run.results.filter(function (r) { return !r.ok; }).length };
  const runs = [compact].concat(Array.isArray(state.runs) ? state.runs : []).slice(0, RUNS_LIMIT);
  await stateRef.set({
    lastRun: run,
    lastSuccessfulRunAt: anyOk ? run.finishedAt : (state.lastSuccessfulRunAt || null),
    runs: runs
  });
  deps.log.info("marketingResearch", { trigger: trigger, ok: run.ok, handles: run.results.length, creditsUsed: run.creditsUsed });
  return { ok: run.ok, reused: false, run: run };
}

module.exports = { runResearch, extractMetrics, compareMetrics, MANUAL_MIN_INTERVAL_MINUTES, HISTORY_LIMIT };
