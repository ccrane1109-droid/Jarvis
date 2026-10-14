/* ==========================================================================
   Marketing settings, monthly usage and budget math (server side).

   Settings live in users/{uid}/marketing/settings and are editable by the
   owner from the browser, so every value is clamped here before use.
   ========================================================================== */

"use strict";

// Anthropic first-party prices in USD per 1M tokens (from Anthropic's model
// table, cached 2026-10-06). Haiku's price applies to prompts up to 100K
// tokens, which these prompts stay well under.
const MODEL_PRICES = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 }
};
const DEFAULT_MODEL = "claude-opus-5-5";
// Output cap for one idea-generation request; also the worst-case basis for
// the budget check and the cost estimate shown in the app.
const AI_MAX_OUTPUT_TOKENS = 16000;

const DEFAULTS = {
  monthlyCreditCap: 1500,
  monthlyBudgetUsd: 20,
  insightPlanMonthlyUsd: 0,
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

function priceFor(model) { return MODEL_PRICES[model] || null; }

// Estimated USD cost of one response from its reported token usage. Cache
// write/read tokens (if any) are priced at the full input rate, which can
// only overestimate.
function estimateCostUsd(model, usage) {
  const p = priceFor(model) || MODEL_PRICES[DEFAULT_MODEL];
  const u = usage || {};
  const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const output = u.output_tokens || 0;
  return (input * p.input + output * p.output) / 1e6;
}

// Most a single request could cost if it used every allowed output token.
function worstCaseCostUsd(model, inputTokens, maxOutputTokens) {
  const p = priceFor(model) || MODEL_PRICES[DEFAULT_MODEL];
  return (inputTokens * p.input + maxOutputTokens * p.output) / 1e6;
}

// What's left of the monthly budget for AI after the InsightSocial plan fee.
function aiAllowanceUsd(settings) {
  return Math.max(0, settings.monthlyBudgetUsd - settings.insightPlanMonthlyUsd);
}

module.exports = {
  MODEL_PRICES, DEFAULT_MODEL, AI_MAX_OUTPUT_TOKENS, DEFAULTS, MAX_WATCHLIST,
  sanitizeSettings, readSettings, readUsage, monthKey, normalizeHandle,
  estimateCostUsd, worstCaseCostUsd, aiAllowanceUsd, priceFor
};
