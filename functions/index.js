/* ==========================================================================
   JARVIS — Firebase Cloud Functions entry points.

   Secrets/params (set at deploy time, never committed):
     INSIGHTSOCIAL_API_KEY  secret  — firebase functions:secrets:set INSIGHTSOCIAL_API_KEY
     OWNER_UID              param   — the only Firebase Auth user allowed in
   ========================================================================== */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const insight = require("./lib/insight");

initializeApp();

const INSIGHTSOCIAL_API_KEY = defineSecret("INSIGHTSOCIAL_API_KEY");
const OWNER_UID = defineString("OWNER_UID", {
  description: "Firebase Auth UID of the only account allowed to use Marketing research (Firebase console > Authentication > Users)."
});

// maxInstances caps how many copies can run at once, as a backstop on cost.
const OPTIONS = {
  region: "us-central1",
  secrets: [INSIGHTSOCIAL_API_KEY],
  maxInstances: 2,
  timeoutSeconds: 30,
  memory: "256MiB"
};

function deps() {
  return {
    db: getFirestore(),
    fetchImpl: fetch,
    apiKey: INSIGHTSOCIAL_API_KEY.value(),
    ownerUid: OWNER_UID.value(),
    increment: FieldValue.increment,
    now: () => new Date(),
    log: logger
  };
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof insight.InsightError) throw new HttpsError(err.code, err.message);
    logger.error("Unexpected marketing function error", { message: err && err.message });
    throw new HttpsError("internal", "Unexpected server error.");
  }
}

exports.insightRequest = onCall(OPTIONS, (request) =>
  guarded(() => insight.runInsightRequest(request.auth && request.auth.uid, request.data || {}, deps())));

exports.marketingStatus = onCall(OPTIONS, (request) =>
  guarded(() => insight.getStatus(request.auth && request.auth.uid, deps())));
