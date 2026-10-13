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

const API_BASE = "https://api.insightsocial.app/v1";
const KEY_PREFIX = "isk_";
const DEFAULT_MONTHLY_CREDIT_CAP = 1500;
const MIN_REFRESH_MINUTES = 10;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 256 * 1024;

// Only endpoints confirmed from InsightSocial's own material. Add more here
// once they're verified against the official API reference.
const ENDPOINTS = {
  "instagram.profile": {
    path: "/instagram/profile",
    params: { handle: /^[a-z0-9._]{1,30}$/ },
    ttlHours: 12
  }
};

class InsightError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // a Firebase HttpsError code
  }
}

function monthKey(date) { return date.toISOString().slice(0, 7); }

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
    value = value.trim().replace(/^@/, "").toLowerCase();
    if (!spec.params[name].test(value)) throw new InsightError("invalid-argument", "That " + name + " isn't valid.");
    params[name] = value;
  });
  return params;
}

function cacheKey(endpoint, params) {
  const sorted = Object.keys(params).sort().map(function (k) { return [k, params[k]]; });
  return crypto.createHash("sha256").update(endpoint + "|" + JSON.stringify(sorted)).digest("hex");
}

async function readMonthlyCap(db, uid) {
  const snap = await db.doc("users/" + uid + "/marketing/settings").get();
  const cap = snap.exists ? Number(snap.data().monthlyCreditCap) : NaN;
  return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MONTHLY_CREDIT_CAP;
}

async function readUsage(db, uid, month) {
  const snap = await db.doc("users/" + uid + "/marketingUsage/" + month).get();
  const d = snap.exists ? snap.data() : {};
  return {
    creditsUsed: numberOrNull(d.creditsUsed) || 0,
    requests: numberOrNull(d.requests) || 0,
    unknownCostRequests: numberOrNull(d.unknownCostRequests) || 0,
    lastCreditsRemaining: numberOrNull(d.lastCreditsRemaining)
  };
}

async function callInsightSocial(deps, spec, params) {
  const url = new URL(API_BASE + spec.path);
  Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
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

  const month = monthKey(now);
  const [cap, usage] = await Promise.all([readMonthlyCap(deps.db, uid), readUsage(deps.db, uid, month)]);
  if (usage.creditsUsed >= cap) {
    const msg = "This month's credit cap (" + cap + ") is reached, so no new requests are sent.";
    if (cached) return fromCache({ stale: true, note: msg });
    throw new InsightError("resource-exhausted", msg);
  }

  const result = await callInsightSocial(deps, spec, params);
  const creditsUsed = numberOrNull(result.body && result.body.credits_used);
  const creditsRemaining = numberOrNull(result.body && result.body.credits_remaining);

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
    const fetchedAt = now.toISOString();
    await cacheRef.set({ endpoint: endpoint, params: params, status: result.status, body: result.body, fetchedAt: fetchedAt });
    return { ok: true, cached: false, endpoint: endpoint, params: params, status: result.status, body: result.body, fetchedAt: fetchedAt, creditsUsed: creditsUsed, creditsRemaining: creditsRemaining };
  }
  return { ok: false, cached: false, endpoint: endpoint, params: params, status: result.status, error: describeFailure(result), body: result.body, creditsUsed: creditsUsed, creditsRemaining: creditsRemaining };
}

async function getStatus(uid, deps) {
  requireOwner(uid, deps);
  const month = monthKey(deps.now());
  const [cap, usage] = await Promise.all([readMonthlyCap(deps.db, uid), readUsage(deps.db, uid, month)]);
  return {
    keyConfigured: keyConfigured(deps),
    month: month,
    monthlyCreditCap: cap,
    usage: usage,
    endpoints: Object.keys(ENDPOINTS)
  };
}

module.exports = {
  runInsightRequest: runInsightRequest,
  getStatus: getStatus,
  InsightError: InsightError,
  ENDPOINTS: ENDPOINTS,
  DEFAULT_MONTHLY_CREDIT_CAP: DEFAULT_MONTHLY_CREDIT_CAP,
  MIN_REFRESH_MINUTES: MIN_REFRESH_MINUTES
};
