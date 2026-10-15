/* ==========================================================================
   "Research My Niche": searches Instagram and TikTok for the owner's niche
   keywords through InsightSocial, on the server.

   Every search goes through insight.runInsightRequest, so the same rules
   apply as for any InsightSocial request: owner only, allow-listed endpoints,
   saved results reused for 20 hours, and the monthly credit cap. On top of
   that a run has its own credit limit, and the plan (what is searched and what
   it costs) comes from niche-spec.js, the same file the browser uses to show
   the cost before you press the button.

   Nothing here is invented: each source records what really happened
   (completed, cached, unavailable or failed) and every post is exactly what
   InsightSocial returned, validated and trimmed by posts.js.

   Firestore (server-written, owner-readable):
     users/{uid}/marketingState/niche  { profile, lastRun, lastSuccessfulRunAt, runs[] }
   ========================================================================== */

"use strict";

const settingsLib = require("./settings");
const insight = require("./insight");
const nicheSpec = require("./niche-spec");

const RUNS_LIMIT = 20;
// A run that started this recently and hasn't finished blocks another one, so
// two devices (or a retry) can't both spend credits at once. A crashed run
// stops blocking after this long.
const RUN_LOCK_MINUTES = 5;

function plural(n, word, many) { return n + " " + (n === 1 ? word : many || word + "s"); }

function emptySource(step) {
  return {
    id: step.id, platform: step.platform, kind: step.kind, label: step.label,
    status: "unavailable", items: [], dropped: 0, total: null,
    creditsUsed: 0, cached: false, stale: false, fetchedAt: null, note: "", error: ""
  };
}

async function runStep(uid, step, remainingCredits, deps) {
  const source = emptySource(step);
  try {
    const res = await insight.runInsightRequest(uid, { endpoint: step.endpoint, params: step.params, maxCredits: remainingCredits }, deps);
    if (!res.ok) {
      source.status = "failed";
      source.error = res.error || "The search failed.";
      source.creditsUsed = res.creditsUsed || 0;
      return source;
    }
    const body = res.body && typeof res.body === "object" ? res.body : {};
    source.status = res.cached ? "cached" : "completed";
    source.items = Array.isArray(body.items) ? body.items : [];
    source.dropped = Number.isFinite(body.dropped) ? body.dropped : 0;
    source.total = Number.isFinite(body.total) ? body.total : null;
    source.cached = !!res.cached;
    source.stale = !!res.stale;
    source.fetchedAt = res.fetchedAt || null;
    source.note = res.note || "";
    // A live call that didn't report its cost is counted at its documented price, so the run limit stays safe.
    source.creditsUsed = res.cached ? 0 : (typeof res.creditsUsed === "number" ? res.creditsUsed : step.credits);
  } catch (err) {
    if (err instanceof insight.InsightError) {
      source.status = err.code === "resource-exhausted" ? "unavailable" : "failed";
      source.error = err.message;
    } else {
      deps.log.error("nicheResearch: unexpected error", { step: step.id, message: err && err.message });
      source.status = "failed";
      source.error = "Something went wrong on the server for this search.";
    }
  }
  return source;
}

async function runNicheResearch(uid, deps, opts) {
  insight.requireOwner(uid, deps);
  if (!insight.keyConfigured(deps)) throw new insight.InsightError("failed-precondition", "The InsightSocial key isn't set on the server yet.");
  const o = opts || {};
  if (o.settings) await settingsLib.syncSettings(deps.db, uid, o.settings);

  const now = deps.now();
  const stateRef = deps.db.doc("users/" + uid + "/marketingState/niche");
  const [settings, stateSnap] = await Promise.all([settingsLib.readSettings(deps.db, uid), stateRef.get()]);
  const state = stateSnap.exists ? stateSnap.data() : {};

  // A profile sent with the request becomes the saved one (the daily run and
  // later runs use it); otherwise the last saved profile is used.
  const profile = nicheSpec.sanitizeProfile(o.niche || state.profile);
  const plan = nicheSpec.planSearches(profile);
  const savedProfile = Object.assign({}, profile, { updatedAt: now.toISOString() });
  const base = Object.assign({}, state, { profile: savedProfile });
  if (o.niche) await stateRef.set(base);

  if (!plan.steps.length) {
    throw new insight.InsightError("failed-precondition", profile.keywords.length
      ? "Pick Instagram or TikTok in Edit niche, then try again."
      : "Add at least one research keyword in Edit niche, then try again.");
  }

  if (state.running && state.running.startedAt) {
    const minutes = (now.getTime() - new Date(state.running.startedAt).getTime()) / 60000;
    if (minutes >= 0 && minutes < RUN_LOCK_MINUTES) {
      throw new insight.InsightError("failed-precondition", "A research run is already in progress. Wait for it to finish, then check the results.");
    }
  }
  await stateRef.set(Object.assign({}, base, { running: { startedAt: now.toISOString() } }));

  const cap = settings.researchRunCreditCap;
  const run = {
    id: now.toISOString(), trigger: o.trigger || "manual", startedAt: now.toISOString(), finishedAt: null, ok: false,
    creditsUsed: 0, runCreditCap: cap, plannedCredits: plan.credits, omitted: plan.omitted, sources: [], summary: []
  };

  try {
    // One at a time, so the run's credit limit is checked against what was really spent.
    for (const step of plan.steps) {
      const source = await runStep(uid, step, Math.max(0, cap - run.creditsUsed), deps);
      run.creditsUsed += source.creditsUsed;
      run.sources.push(source);
    }

    run.finishedAt = deps.now().toISOString();
    const good = run.sources.filter(function (s) { return s.status === "completed" || s.status === "cached"; });
    // The same post can turn up in several searches; count it once.
    const postKeys = {};
    run.sources.forEach(function (s) { s.items.forEach(function (it) { postKeys[s.platform + ":" + it.id] = true; }); });
    const posts = Object.keys(postKeys).length;
    const failed = run.sources.filter(function (s) { return s.status === "failed"; }).length;
    const skipped = run.sources.filter(function (s) { return s.status === "unavailable"; }).length;
    run.ok = good.length > 0;
    run.summary.push(plural(good.length, "search", "searches") + " of " + run.sources.length + " returned results (" + plural(posts, "post") + " found).");
    run.summary.push(run.creditsUsed > 0
      ? "Used " + run.creditsUsed + " InsightSocial credits."
      : "No credits used" + (good.some(function (s) { return s.cached; }) ? " (saved results from the last " + nicheSpec.RESULT_TTL_HOURS + " hours were reused)." : "."));
    if (failed) run.summary.push(plural(failed, "search", "searches") + " failed.");
    if (skipped) run.summary.push(plural(skipped, "search", "searches") + " skipped to stay within your credit limits.");
    const limits = [];
    if (plan.omitted.tiktok) limits.push("the first " + nicheSpec.TIKTOK_MAX_QUERIES + " keywords on TikTok");
    if (plan.omitted.instagram) limits.push("the first " + nicheSpec.INSTAGRAM_MAX_HASHTAGS + " hashtags on Instagram");
    if (limits.length) run.summary.push("To keep each run affordable, JARVIS searched " + limits.join(" and ") + ".");

    const compact = {
      id: run.id, trigger: run.trigger, startedAt: run.startedAt, finishedAt: run.finishedAt, ok: run.ok,
      creditsUsed: run.creditsUsed, searches: run.sources.length, failures: failed
    };
    await stateRef.set(Object.assign({}, base, {
      running: null,
      lastRun: run,
      lastSuccessfulRunAt: run.ok ? run.finishedAt : (state.lastSuccessfulRunAt || null),
      runs: [compact].concat(Array.isArray(state.runs) ? state.runs : []).slice(0, RUNS_LIMIT)
    }));
    deps.log.info("nicheResearch", { trigger: run.trigger, ok: run.ok, searches: run.sources.length, posts: posts, failed: failed, skipped: skipped, creditsUsed: run.creditsUsed });
  } catch (err) {
    // Don't leave the guard behind if the run itself broke.
    await stateRef.set(Object.assign({}, base, { running: null })).catch(function () { /* the guard expires on its own */ });
    throw err;
  }
  return { ok: run.ok, run: run };
}

module.exports = { runNicheResearch };
