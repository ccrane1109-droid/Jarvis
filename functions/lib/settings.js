/* ==========================================================================
   Marketing settings, monthly usage and budget math (server side).

   Settings live in users/{uid}/marketing/settings and are editable by the
   owner from the browser, so every value is clamped here before use.
   ========================================================================== */

"use strict";

const spec = require("./idea-spec");

const { MODEL_PRICES, DEFAULT_MODEL, AI_MAX_OUTPUT_TOKENS } = spec;

const DEFAULTS = {
  monthlyCreditCap: 1500,
  monthlyBudgetUsd: 20,
  // The owner's InsightSocial plan ($10/month, as they reported it).
  insightPlanMonthlyUsd: 10,
  aiModel: DEFAULT_MODEL,
  brandProfile: "",
  contentPillars: ["Faith", "Behind the brand", "Style & outfits", "Community", "Product drops"],
  watchlist: []
};
const MAX_WATCHLIST = 10;
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

function numberOrNull(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }

function normalizeHandle(h) {
  if (typeof h !== "string") return null;
  const v = h.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_RE.test(v) ? v : null;
}

function sanitizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pillars = Array.isArray(r.contentPillars)
    ? r.contentPillars.map((p) => cleanText(p, 40)).filter(Boolean).slice(0, 12)
    : DEFAULTS.contentPillars;
  const watchlist = Array.isArray(r.watchlist)
    ? Array.from(new Set(r.watchlist.map(normalizeHandle).filter(Boolean))).slice(0, MAX_WATCHLIST)
    : [];
  return {
    monthlyCreditCap: clampNumber(r.monthlyCreditCap, 0, 100000, DEFAULTS.monthlyCreditCap),
    monthlyBudgetUsd: clampNumber(r.monthlyBudgetUsd, 0, 500, DEFAULTS.monthlyBudgetUsd),
    insightPlanMonthlyUsd: clampNumber(r.insightPlanMonthlyUsd, 0, 500, DEFAULTS.insightPlanMonthlyUsd),
    aiModel: MODEL_PRICES[r.aiModel] ? r.aiModel : DEFAULT_MODEL,
    brandProfile: cleanText(r.brandProfile, 3000),
    contentPillars: pillars.length ? pillars : DEFAULTS.contentPillars,
    watchlist: watchlist
  };
}

async function readSettings(db, uid) {
  const snap = await db.doc("users/" + uid + "/marketing/settings").get();
  return sanitizeSettings(snap.exists ? snap.data() : {});
}

function monthKey(date) { return date.toISOString().slice(0, 7); }

async function readUsage(db, uid, month) {
  const snap = await db.doc("users/" + uid + "/marketingUsage/" + month).get();
  const d = snap.exists ? snap.data() : {};
  return {
    creditsUsed: numberOrNull(d.creditsUsed) || 0,
    requests: numberOrNull(d.requests) || 0,
    unknownCostRequests: numberOrNull(d.unknownCostRequests) || 0,
    lastCreditsRemaining: numberOrNull(d.lastCreditsRemaining),
    aiRequests: numberOrNull(d.aiRequests) || 0,
    aiInputTokens: numberOrNull(d.aiInputTokens) || 0,
    aiOutputTokens: numberOrNull(d.aiOutputTokens) || 0,
    aiCostUsd: numberOrNull(d.aiCostUsd) || 0
  };
}

// Cost helpers live in idea-spec.js so the browser prices requests the same way.
const { estimateCostUsd, worstCaseCostUsd, priceFor } = spec;

// What's left of the monthly budget for AI after the InsightSocial plan fee.
function aiAllowanceUsd(settings) {
  return Math.max(0, settings.monthlyBudgetUsd - settings.insightPlanMonthlyUsd);
}

module.exports = {
  MODEL_PRICES, DEFAULT_MODEL, AI_MAX_OUTPUT_TOKENS, DEFAULTS, MAX_WATCHLIST,
  sanitizeSettings, readSettings, readUsage, monthKey, normalizeHandle,
  estimateCostUsd, worstCaseCostUsd, aiAllowanceUsd, priceFor
};
