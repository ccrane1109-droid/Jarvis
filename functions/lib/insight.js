/* ==========================================================================
   JARVIS — Marketing research server logic (runs in Firebase Cloud
   Functions, never in the browser).

   The InsightSocial key is a Firebase secret, so it never reaches the
   browser, the repo, or Firestore. Requests are only accepted from the
   owner's signed-in account, only for allow-listed endpoints, and only
   while this month's credit usage is under the configured cap.

   Firestore (private to the owner; the server writes usage and cache):
     users/{uid}/marketing/settings      { monthlyCreditCap }
     users/{uid}/marketingUsage/{YYYY-MM} { creditsUsed, requests, unknownCostRequests, lastCreditsRemaining, updatedAt }
     users/{uid}/marketingCache/{sha256}  { endpoint, params, status, body, fetchedAt }

   Kept free of Firebase imports so every branch is testable with fakes.
   ========================================================================== */

"use strict";

const crypto = require("node:crypto");
const settingsLib = require("./settings");
const nicheSpec = require("./niche-spec");
const posts = require("./posts");

const API_BASE = "https://api.insightsocial.app/v1";
const KEY_PREFIX = "isk_";
const DEFAULT_MONTHLY_CREDIT_CAP = settingsLib.DEFAULTS.monthlyCreditCap;
const MIN_REFRESH_MINUTES = 10;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 256 * 1024;

// Only endpoints confirmed from InsightSocial's own API reference
// (https://github.com/insightsocial/openapi). Add more here once they're
// verified there.
//   credits: the fixed price per call from that reference; used to refuse a
//            call that would push the month past its cap.
//   fixed:   parameters sent with every call (not part of the cache key).
//   reduce:  validates the response and keeps only the fields JARVIS uses; a
//            null result means the response wasn't the expected shape.
const ENDPOINTS = {
  "instagram.profile": {
    path: "/instagram/profile",
    params: { handle: /^[a-z0-9._]{1,30}$/ },
    credits: 10,
    ttlHours: 12
  },
  "tiktok.search.top": {
    path: "/tiktok/search/top",
    params: { query: /^[^\u0000-\u001f<>]{2,60}$/ },
    credits: nicheSpec.STEP_TYPES["tiktok.search.top"].credits,
    // Videos from the last 3 months, so results reflect what is working now.
    fixed: { publish_time: "last-3-months" },
    ttlHours: nicheSpec.RESULT_TTL_HOURS,
    reduce: function (body) { return posts.reducePosts("tiktok", body); }
  },
  "instagram.search.hashtag": {
    path: "/instagram/search/hashtag",
    params: { hashtag: /^[a-z0-9]{2,40}$/ },
    credits: nicheSpec.STEP_TYPES["instagram.search.hashtag"].credits,
    fixed: { type: "top" },
    ttlHours: nicheSpec.RESULT_TTL_HOURS,
    reduce: function (body) { return posts.reducePosts("instagram", body); }
  }
};

class InsightError extends Error {
  constructor(code, message, reason) {
    super(message);
    this.code = code; // a Firebase HttpsError code
    this.reason = reason || null; // "monthly-cap" | "run-cap" for resource-exhausted
  }
}

function numberOrNull(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

function requireOwner(uid, deps) {
  if (!uid) throw new InsightError("unauthenticated", "Sign in to JARVIS to use Marketing research.");
  if (!deps.ownerUid) throw new InsightError("failed-precondition", "The server's OWNER_UID isn't configured.");
  if (uid !== deps.ownerUid) throw new InsightError("permission-denied", "This account isn't allowed to use Marketing research.");
}

function keyConfigured(deps) {
  return typeof deps.apiKey === "string" && deps.apiKey.trim().indexOf(KEY_PREFIX) === 0;
}

function normalizeParams(endpoint, rawParams) {
  const spec = ENDPOINTS[endpoint];
  if (!spec) throw new InsightError("invalid-argument", "Unsupported research type.");
  const params = {};
  Object.keys(spec.params).forEach(function (name) {
    let value = rawParams && rawParams[name];
    if (typeof value !== "string") throw new InsightError("invalid-argument", "Missing " + name + ".");
    value = value.replace(/\s+/g, " ").trim();
    if (name === "handle") value = value.replace(/^@/, "");
    if (name === "hashtag") value = value.replace(/^#/, "");
    value = value.toLowerCase();
    if (!spec.params[name].test(value)) throw new InsightError("invalid-argument", "That " + name + " isn't valid.");
    params[name] = value;
  });
  return params;
}

function cacheKey(endpoint, params) {
  const sorted = Object.keys(params).sort().map(function (k) { return [k, params[k]]; });
  return crypto.createHash("sha256").update(endpoint + "|" + JSON.stringify(sorted)).digest("hex");
}

async function callInsightSocial(deps, spec, params) {
  const url = new URL(API_BASE + spec.path);
  Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
  Object.keys(spec.fixed || {}).forEach(function (k) { url.searchParams.set(k, spec.fixed[k]); });
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const res = await deps.fetchImpl(url, {
      headers: { "x-api-key": deps.apiKey.trim(), accept: "application/json" },
      signal: controller.signal
    });
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) return { status: res.status, body: null, problem: "InsightSocial's response was unexpectedly large and was discarded." };
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { status: res.status, body: null, problem: "InsightSocial returned a response that wasn't valid JSON." };
    }
    return { status: res.status, body: body, problem: null };
  } catch (err) {
    return { status: 0, body: null, problem: err && err.name === "AbortError" ? "InsightSocial didn't respond in time." : "Couldn't reach InsightSocial." };
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(result) {
  if (result.problem) return result.problem;
  const err = result.body && result.body.error;
  if (err) return typeof err === "string" ? err : (err.message || err.type || "Request failed (HTTP " + result.status + ").");
  return "Request failed (HTTP " + result.status + ").";
}

async function runInsightRequest(uid, data, deps) {
  requireOwner(uid, deps);
  if (!keyConfigured(deps)) throw new InsightError("failed-precondition", "The InsightSocial key isn't set on the server yet.");

  const endpoint = data && data.endpoint;
  const params = normalizeParams(endpoint, data && data.params);
  const spec = ENDPOINTS[endpoint];
  if (data.settings) await settingsLib.syncSettings(deps.db, uid, data.settings);
  const now = deps.now();
  const cacheRef = deps.db.doc("users/" + uid + "/marketingCache/" + cacheKey(endpoint, params));
  const cacheSnap = await cacheRef.get();
  const cached = cacheSnap.exists ? cacheSnap.data() : null;
  const ageMinutes = cached ? (now.getTime() - new Date(cached.fetchedAt).getTime()) / 60000 : Infinity;

  function fromCache(extra) {
    return Object.assign({ ok: true, cached: true, endpoint: endpoint, params: params, status: cached.status, body: cached.body, fetchedAt: cached.fetchedAt, creditsUsed: 0 }, extra || {});
  }

  if (cached && ageMinutes < spec.ttlHours * 60 && !data.refresh) return fromCache();
  if (cached && data.refresh && ageMinutes < MIN_REFRESH_MINUTES) {
    return fromCache({ note: "Refreshed less than " + MIN_REFRESH_MINUTES + " minutes ago, so the saved result was reused." });
  }

  const month = settingsLib.monthKey(now);
  const [settings, usage] = await Promise.all([settingsLib.readSettings(deps.db, uid), settingsLib.readUsage(deps.db, uid, month)]);
  const cap = settings.monthlyCreditCap;
  const price = spec.credits || 0;
  // A caller running several requests (a research run) can limit what this one may spend.
  if (typeof data.maxCredits === "number" && price > data.maxCredits) {
    const msg = "Skipped: this request costs " + price + " credits and the run's credit limit has " + Math.max(0, data.maxCredits) + " left.";
    if (cached) return fromCache({ stale: true, note: msg });
    throw new InsightError("resource-exhausted", msg, "run-cap");
  }
  if (usage.creditsUsed >= cap || usage.creditsUsed + price > cap) {
    const msg = usage.creditsUsed >= cap
      ? "This month's credit cap (" + cap + ") is reached, so no new requests are sent."
      : "This request costs " + price + " credits, which would go past this month's credit cap (" + cap + "), so it wasn't sent.";
    if (cached) return fromCache({ stale: true, note: msg });
    throw new InsightError("resource-exhausted", msg, "monthly-cap");
  }

  const result = await callInsightSocial(deps, spec, params);
  const creditsUsed = numberOrNull(result.body && result.body.credits_used);
  const creditsRemaining = numberOrNull(result.body && result.body.credits_remaining);
  // InsightSocial's own words for why a call cost what it did, passed on as sent (trimmed).
  const chargeReason = result.body && typeof result.body.charge_reason === "string" ? posts.plainText(result.body.charge_reason, 80) : "";

  // A request that never reached InsightSocial can't have been charged.
  if (result.status !== 0) {
    const update = {
      requests: deps.increment(1),
      creditsUsed: deps.increment(creditsUsed || 0),
      unknownCostRequests: deps.increment(creditsUsed === null ? 1 : 0),
      updatedAt: now.toISOString()
    };
    if (creditsRemaining !== null) update.lastCreditsRemaining = creditsRemaining;
    await deps.db.doc("users/" + uid + "/marketingUsage/" + month).set(update, { merge: true });
  }

  const ok = result.status >= 200 && result.status < 300 && !!result.body && result.body.success !== false;
  deps.log.info("insightRequest", { endpoint: endpoint, status: result.status, ok: ok, creditsUsed: creditsUsed });

  if (ok) {
    // Keep only what JARVIS uses, and only if it's the shape InsightSocial documents.
    const kept = spec.reduce ? spec.reduce(result.body) : result.body;
    if (kept === null) {
      deps.log.error("insightRequest: unexpected response shape", { endpoint: endpoint, status: result.status });
      return { ok: false, cached: false, endpoint: endpoint, params: params, status: result.status, error: "InsightSocial's response wasn't in the format JARVIS expects, so it was discarded.", body: null, creditsUsed: creditsUsed, creditsRemaining: creditsRemaining };
    }
    const fetchedAt = now.toISOString();
    await cacheRef.set({ endpoint: endpoint, params: params, status: result.status, body: kept, fetchedAt: fetchedAt });
    return { ok: true, cached: false, endpoint: endpoint, params: params, status: result.status, body: kept, fetchedAt: fetchedAt, creditsUsed: creditsUsed, creditsRemaining: creditsRemaining, chargeReason: chargeReason };
  }
  return { ok: false, cached: false, endpoint: endpoint, params: params, status: result.status, error: describeFailure(result), body: result.body, creditsUsed: creditsUsed, creditsRemaining: creditsRemaining, chargeReason: chargeReason };
}

async function getStatus(uid, deps, opts) {
  requireOwner(uid, deps);
  // Keep the server's copy of the owner's settings current (see syncSettings).
  if (opts && opts.settings) await settingsLib.syncSettings(deps.db, uid, opts.settings);
  const month = settingsLib.monthKey(deps.now());
  const [settings, usage, research, nicheState, libraryState] = await Promise.all([
    settingsLib.readSettings(deps.db, uid),
    settingsLib.readUsage(deps.db, uid, month),
    deps.db.doc("users/" + uid + "/marketingState/research").get(),
    deps.db.doc("users/" + uid + "/marketingState/niche").get(),
    deps.db.doc("users/" + uid + "/marketingState/library").get()
  ]);
  const r = research.exists ? research.data() : {};
  const n = nicheState.exists ? nicheState.data() : {};
  const lib = libraryState.exists ? libraryState.data() : {};
  return {
    keyConfigured: keyConfigured(deps),
    aiKeyConfigured: typeof deps.anthropicKey === "string" && deps.anthropicKey.trim().indexOf("sk-ant-") === 0,
    month: month,
    monthlyCreditCap: settings.monthlyCreditCap,
    researchRunCreditCap: settings.researchRunCreditCap,
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
    insightPlanMonthlyUsd: settings.insightPlanMonthlyUsd,
    aiAllowanceUsd: settingsLib.aiAllowanceUsd(settings),
    aiModel: settings.aiModel,
    aiPrices: settingsLib.MODEL_PRICES,
    aiMaxOutputTokens: settingsLib.AI_MAX_OUTPUT_TOKENS,
    usage: usage,
    lastRun: r.lastRun || null,
    lastSuccessfulRunAt: r.lastSuccessfulRunAt || null,
    nicheRun: n.lastRun || null,
    nicheRuns: Array.isArray(n.runs) ? n.runs : [],
    nicheLastFullAt: nicheSpec.lastFullAtOf(n),
    libraryCount: numberOrNull(lib.count) || 0,
    libraryBookmarks: numberOrNull(lib.bookmarks) || 0,
    serverNow: deps.now().toISOString(),
    endpoints: Object.keys(ENDPOINTS)
  };
}

module.exports = {
  runInsightRequest: runInsightRequest,
  getStatus: getStatus,
  requireOwner: requireOwner,
  keyConfigured: keyConfigured,
  InsightError: InsightError,
  ENDPOINTS: ENDPOINTS,
  DEFAULT_MONTHLY_CREDIT_CAP: DEFAULT_MONTHLY_CREDIT_CAP,
  MIN_REFRESH_MINUTES: MIN_REFRESH_MINUTES
};
