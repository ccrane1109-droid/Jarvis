/* ==========================================================================
   JARVIS — Firebase Cloud Functions entry points.

   Secrets/params (set at deploy time, never committed):
     VAPID_PUBLIC_KEY       secret  — created by scripts/setup-vapid.js (push notifications)
     VAPID_PRIVATE_KEY      secret  — created by scripts/setup-vapid.js, never shown
     OWNER_UID              param   — the only Firebase Auth user allowed in
   ========================================================================== */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const errors = require("./lib/errors");
const reminders = require("./lib/reminders");
const reminderLog = require("./lib/reminder-log");
const push = require("./lib/push");
const delivery = require("./lib/delivery");
const shopify = require("./lib/shopify");
const webpush = require("web-push");
const { makeGuard } = require("./lib/guard");

initializeApp();

const VAPID_PUBLIC_KEY = defineSecret("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const OWNER_UID = defineString("OWNER_UID", {
  description: "Firebase Auth UID of the only account allowed to use the server (Firebase console > Authentication > Users)."
});

// maxInstances caps how many copies can run at once, as a backstop on cost.
const BASE = { region: "us-central1", maxInstances: 2, memory: "256MiB" };

function deps(extra) {
  return Object.assign({
    db: getFirestore(),
    ownerUid: OWNER_UID.value(),
    increment: FieldValue.increment,
    now: () => new Date(),
    log: logger
  }, extra);
}

const guarded = makeGuard({ ServerError: errors.ServerError, HttpsError: HttpsError, logger: logger });

const uidOf = (request) => request.auth && request.auth.uid;

// Reminders: storage and management (create, edit, delete, enable, settings) and what you do
// about them (done, skip, snooze, history). Owner only; no secrets, no cost beyond Firestore.
exports.reminders = onCall(
  Object.assign({}, BASE, { timeoutSeconds: 30 }),
  (request) => guarded("reminders", () => {
    const data = request.data || {};
    const handler = reminderLog.ACTIONS.indexOf(data.action) !== -1 ? reminderLog : reminders;
    return handler.handle(uidOf(request), data, deps());
  }));

// Shopify store connection (Business tab): connect, check, disconnect. Owner only. The store's Client ID and Client
// Secret are kept in a part of the database that browsers can't read (firestore.rules), and are never sent back to
// the page. Costs nothing: Shopify doesn't charge for these calls. A connect or check can make up to four short
// requests to Shopify, hence the longer time limit.
exports.shopify = onCall(
  Object.assign({}, BASE, { timeoutSeconds: 90 }),
  (request) => guarded("shopify", () => shopify.handle(uidOf(request), request.data || {}, deps())));

// Phone notifications: turning them on for a phone, sending a test, and (below) the
// once-a-minute run that sends reminders that have come due.
const pushDeps = () => deps({ webpush: webpush, vapidPublic: VAPID_PUBLIC_KEY.value(), vapidPrivate: VAPID_PRIVATE_KEY.value() });

exports.notifications = onCall(
  Object.assign({}, BASE, { secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY], timeoutSeconds: 30 }),
  (request) => guarded("notifications", () => push.handle(uidOf(request), request.data || {}, pushDeps(), delivery.queueEvent)));

exports.reminderTick = onSchedule(
  Object.assign({}, BASE, { maxInstances: 1, secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY], timeoutSeconds: 55, schedule: "every 1 minutes", timeZone: "America/New_York" }),
  async () => {
    try {
      const summary = await delivery.runTick(OWNER_UID.value(), pushDeps());
      if (summary.claimed || summary.sent || summary.missed || summary.retry || summary.failed || summary.noDevice) logger.info("reminderTick", summary);
    } catch (err) {
      logger.error("Reminder run failed", { fn: "reminderTick", message: err && err.message, stack: err && err.stack });
    }
  });
