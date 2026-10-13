#!/usr/bin/env node
/* ==========================================================================
   JARVIS — daily InsightSocial research run (executed by
   .github/workflows/marketing-research.yml, never in the browser).

   Reads the requests to make from data/marketing-research-config.json,
   calls InsightSocial with the key from the INSIGHTSOCIAL_API_KEY secret,
   and writes data/marketing-research.json (latest run + recent history),
   which the Marketing tab displays.

   Budget protection:
   - dailyCreditCap is enforced across every run on the same UTC day,
     using the credits_used each response reports.
   - If a response doesn't report its credit cost, the remaining requests
     in that run are skipped rather than spending blind.
   - Only 429/502/503/504 are retried (InsightSocial's 503 states nothing
     was charged); timeouts are not retried since the call may have run.

   The key is only ever sent as a header to the configured API origin and
   is never logged. Request paths from the config are validated so an edit
   to that file can't redirect the key to another host.
   ========================================================================== */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.env.RESEARCH_CONFIG_PATH || path.join(ROOT, "data/marketing-research-config.json");
const OUTPUT_PATH = process.env.RESEARCH_OUTPUT_PATH || path.join(ROOT, "data/marketing-research.json");
const API_BASE = (process.env.INSIGHTSOCIAL_API_BASE || "https://api.insightsocial.app/v1").replace(/\/+$/, "");
const RETRY_DELAYS_MS = (process.env.INSIGHTSOCIAL_RETRY_DELAYS_MS || "30000,90000")
  .split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
const REQUEST_TIMEOUT_MS = Number(process.env.INSIGHTSOCIAL_TIMEOUT_MS || 30000);
const KEY_PREFIX = "isk_";
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const SAFE_PATH = /^\/[A-Za-z0-9/_-]+$/;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function numberOrNull(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

function buildUrl(req) {
  if (typeof req.path !== "string" || !SAFE_PATH.test(req.path) || req.path.indexOf("//") !== -1) return null;
  const url = new URL(API_BASE + req.path);
  if (url.origin !== new URL(API_BASE).origin) return null;
  Object.entries(req.params || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url;
}

async function callOnce(key, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "x-api-key": key, accept: "application/json" }, signal: controller.signal });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, ok: res.ok, data, retryAfter: res.headers.get("retry-after") };
  } catch (err) {
    return { status: 0, ok: false, data: null, networkError: err.name === "AbortError" ? "timed out" : (err.message || "network error") };
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(key, url, label) {
  let attempt = 0;
  for (;;) {
    attempt++;
    const result = await callOnce(key, url);
    if (!RETRYABLE_STATUSES.has(result.status) || attempt > RETRY_DELAYS_MS.length) {
      return Object.assign(result, { attempts: attempt });
    }
    let wait = RETRY_DELAYS_MS[attempt - 1];
    const retryAfterSec = Number(result.retryAfter);
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) wait = Math.min(retryAfterSec * 1000, 120000);
    console.log(`  ${label}: HTTP ${result.status}, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

function describeError(r) {
  if (r.networkError) return r.networkError;
  const err = r.data && r.data.error;
  if (err) return typeof err === "string" ? err : (err.message || err.type || "HTTP " + r.status);
  return r.ok ? null : "HTTP " + r.status;
}

async function main() {
  const key = (process.env.INSIGHTSOCIAL_API_KEY || "").trim();
  if (!key) {
    console.error("INSIGHTSOCIAL_API_KEY is not set. Add it as a repository secret: Settings → Secrets and variables → Actions → New repository secret.");
    process.exit(1);
  }
  if (!key.startsWith(KEY_PREFIX)) {
    console.error(`INSIGHTSOCIAL_API_KEY doesn't look like an InsightSocial key (it should start with "${KEY_PREFIX}"). Update the repository secret.`);
    process.exit(1);
  }

  const config = await readJson(CONFIG_PATH, null);
  if (!config || !Array.isArray(config.requests)) {
    console.error(`Config missing or invalid: ${CONFIG_PATH} needs a "requests" array.`);
    process.exit(1);
  }
  const cap = Number.isFinite(Number(config.dailyCreditCap)) ? Number(config.dailyCreditCap) : 0;
  const maxRequests = Number.isFinite(Number(config.maxRequestsPerRun)) ? Number(config.maxRequestsPerRun) : 10;
  const historyDays = Number.isFinite(Number(config.historyDays)) ? Number(config.historyDays) : 30;

  const existing = await readJson(OUTPUT_PATH, {});
  const pastRuns = Array.isArray(existing.runs) ? existing.runs : [];

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  let usedToday = pastRuns
    .filter((r) => r.date === today)
    .reduce((sum, r) => sum + (numberOrNull(r.creditsUsed) || 0), 0);

  const run = {
    startedAt: now.toISOString(),
    finishedAt: null,
    date: today,
    trigger: process.env.GITHUB_EVENT_NAME || "manual",
    creditsUsed: 0,
    creditsRemaining: null,
    results: [],
    notes: []
  };
  if (config.requests.length > maxRequests) {
    run.notes.push(`Only the first ${maxRequests} of ${config.requests.length} configured requests ran (maxRequestsPerRun).`);
  }

  let stopReason = null;
  let authFailed = false;
  console.log(`Credits already used today: ${usedToday} of ${cap}.`);

  for (const req of config.requests.slice(0, maxRequests)) {
    const base = { label: req.label || req.path, path: req.path, params: req.params || {} };
    if (stopReason) { run.results.push(Object.assign(base, { skipped: stopReason })); continue; }
    if (usedToday >= cap) {
      stopReason = `Daily credit cap of ${cap} reached.`;
      run.results.push(Object.assign(base, { skipped: stopReason }));
      continue;
    }
    const url = buildUrl(req);
    if (!url) {
      run.results.push(Object.assign(base, { skipped: "Invalid request path in config; nothing was sent." }));
      continue;
    }

    const r = await callWithRetry(key, url, base.label);
    const creditsUsed = numberOrNull(r.data && r.data.credits_used);
    const creditsRemaining = numberOrNull(r.data && r.data.credits_remaining);
    if (creditsUsed !== null) { run.creditsUsed += creditsUsed; usedToday += creditsUsed; }
    if (creditsRemaining !== null) run.creditsRemaining = creditsRemaining;
    const ok = r.ok && !(r.data && r.data.success === false);

    run.results.push(Object.assign(base, {
      status: r.status,
      ok,
      attempts: r.attempts,
      creditsUsed,
      error: ok ? null : describeError(r),
      data: r.data
    }));
    console.log(`  ${base.label}: HTTP ${r.status} ${ok ? "ok" : "failed"}, credits used ${creditsUsed === null ? "not reported" : creditsUsed}`);

    if (r.status === 401 || r.status === 403) {
      authFailed = true;
      stopReason = `Authentication failed (HTTP ${r.status}) — check the INSIGHTSOCIAL_API_KEY secret.`;
    } else if (creditsUsed === null && r.status !== 0) {
      stopReason = "The previous response didn't report its credit cost, so the rest were skipped to protect the budget.";
    }
  }

  run.finishedAt = new Date().toISOString();
  const cutoff = new Date(now.getTime() - historyDays * 86400000).toISOString().slice(0, 10);
  const runs = [run].concat(pastRuns).filter((r) => typeof r.date === "string" && r.date >= cutoff);

  await writeFile(OUTPUT_PATH, JSON.stringify({
    updatedAt: run.finishedAt,
    source: API_BASE,
    dailyCreditCap: cap,
    latest: run,
    runs
  }, null, 2) + "\n");

  console.log(`Done: ${run.creditsUsed} credits used this run, ${run.creditsRemaining === null ? "remaining balance not reported" : run.creditsRemaining + " remaining"}.`);
  if (authFailed) process.exit(1);
}

main().catch((err) => {
  console.error("Research run failed:", err && err.message ? err.message : err);
  process.exit(1);
});
