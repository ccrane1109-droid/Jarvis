/* ==========================================================================
   JARVIS — Firebase Cloud Functions entry points.

   Secrets/params (set at deploy time, never committed):
     INSIGHTSOCIAL_API_KEY  secret  — firebase functions:secrets:set INSIGHTSOCIAL_API_KEY
     ANTHROPIC_API_KEY      secret  — firebase functions:secrets:set ANTHROPIC_API_KEY
     OWNER_UID              param   — the only Firebase Auth user allowed in
   ========================================================================== */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const Anthropic = require("@anthropic-ai/sdk").default;
const insight = require("./lib/insight");
const research = require("./lib/research");
const niche = require("./lib/niche");
const library = require("./lib/library");
const ai = require("./lib/ai");
const { makeGuard } = require("./lib/guard");

initializeApp();

const INSIGHTSOCIAL_API_KEY = defineSecret("INSIGHTSOCIAL_API_KEY");
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const OWNER_UID = defineString("OWNER_UID", {
  description: "Firebase Auth UID of the only account allowed to use Marketing research (Firebase console > Authentication > Users)."
});

// maxInstances caps how many copies can run at once, as a backstop on cost.
const BASE = { region: "us-central1", maxInstances: 2, memory: "256MiB" };

function anthropicClient() {
  const key = ANTHROPIC_API_KEY.value().trim();
  if (key.indexOf("sk-ant-") !== 0) return null;
  return new Anthropic({ apiKey: key, timeout: 200000, maxRetries: 1 });
}

function deps(extra) {
  return Object.assign({
    db: getFirestore(),
    fetchImpl: fetch,
    ownerUid: OWNER_UID.value(),
    increment: FieldValue.increment,
    now: () => new Date(),
    log: logger
  }, extra);
}

const guarded = makeGuard({ InsightError: insight.InsightError, HttpsError: HttpsError, logger: logger });

const uidOf = (request) => request.auth && request.auth.uid;

exports.marketingStatus = onCall(
  Object.assign({}, BASE, { secrets: [INSIGHTSOCIAL_API_KEY, ANTHROPIC_API_KEY], timeoutSeconds: 30 }),
  (request) => guarded("marketingStatus", () => insight.getStatus(uidOf(request), deps({
    apiKey: INSIGHTSOCIAL_API_KEY.value(),
    anthropicKey: ANTHROPIC_API_KEY.value()
  }), { settings: request.data && request.data.settings })));

exports.insightRequest = onCall(
  Object.assign({}, BASE, { secrets: [INSIGHTSOCIAL_API_KEY], timeoutSeconds: 30 }),
  (request) => guarded("insightRequest", () => insight.runInsightRequest(uidOf(request), request.data || {}, deps({ apiKey: INSIGHTSOCIAL_API_KEY.value() }))));

exports.runResearch = onCall(
  Object.assign({}, BASE, { secrets: [INSIGHTSOCIAL_API_KEY], timeoutSeconds: 300 }),
  (request) => guarded("runResearch", () => research.runResearch(uidOf(request), deps({ apiKey: INSIGHTSOCIAL_API_KEY.value() }), { trigger: "manual", settings: request.data && request.data.settings })));

// "Research My Niche": keyword searches on Instagram and TikTok. Up to 10
// calls to InsightSocial in a row, each limited to 20s, hence the long timeout.
exports.researchNiche = onCall(
  Object.assign({}, BASE, { secrets: [INSIGHTSOCIAL_API_KEY], timeoutSeconds: 300 }),
  (request) => guarded("researchNiche", () => niche.runNicheResearch(uidOf(request), deps({ apiKey: INSIGHTSOCIAL_API_KEY.value() }), {
    trigger: "manual",
    niche: request.data && request.data.niche,
    mode: request.data && request.data.mode,
    settings: request.data && request.data.settings
  })));

// The research library: every post past runs found. Reads and bookmarks only;
// nothing here calls InsightSocial or costs credits.
exports.marketingLibrary = onCall(
  Object.assign({}, BASE, { timeoutSeconds: 30 }),
  (request) => guarded("marketingLibrary", () => library.handle(uidOf(request), request.data || {}, deps())));

exports.dailyResearch = onSchedule(
  Object.assign({}, BASE, { maxInstances: 1, secrets: [INSIGHTSOCIAL_API_KEY], timeoutSeconds: 300, schedule: "every day 08:00", timeZone: "America/New_York" }),
  async () => {
    try {
      await research.runResearch(OWNER_UID.value(), deps({ apiKey: INSIGHTSOCIAL_API_KEY.value() }), { trigger: "schedule" });
    } catch (err) {
      logger.error("Daily research failed", { fn: "dailyResearch", message: err && err.message, stack: err && err.stack });
    }
  });

exports.generateIdeas = onCall(
  Object.assign({}, BASE, { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 240 }),
  (request) => guarded("generateIdeas", () => ai.generateIdeas(uidOf(request), request.data || {}, deps({ anthropic: anthropicClient() }))));
