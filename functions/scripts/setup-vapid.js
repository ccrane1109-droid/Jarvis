#!/usr/bin/env node
/* ==========================================================================
   One-time setup of the phone-notification keys (run in Cloud Shell).

     cd ~/Jarvis/functions && node scripts/setup-vapid.js

   It makes a new key pair and stores both halves as Firebase secrets
   (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). The private key goes straight from
   this script into the Firebase tool and is never printed, written to a file
   or sent anywhere else.

   It will not overwrite keys that already exist: new keys would switch off
   notifications on every phone until each one is turned on again. To replace
   them on purpose, run it with --force-new.
   ========================================================================== */

"use strict";

const { spawnSync } = require("node:child_process");

const PUBLIC = "VAPID_PUBLIC_KEY";
const PRIVATE = "VAPID_PRIVATE_KEY";

function firebase(args, input) {
  return spawnSync("npx", ["firebase-tools"].concat(args), { input: input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

const looksMissing = (res) => /not[ _-]?found|does not exist|no such secret/i.test(String(res.stderr || "") + String(res.stdout || ""));

// Is the secret there? -> "yes" | "no" | "unknown"
function exists(run, name) {
  const res = run(["functions:secrets:access", name]);
  if (res.status === 0) return "yes";
  return looksMissing(res) ? "no" : "unknown";
}

function main(options) {
  const run = options.run || firebase;
  const log = options.log || console.log;
  const generate = options.generate || (() => require("web-push").generateVAPIDKeys());

  if (!options.forceNew) {
    const state = [exists(run, PUBLIC), exists(run, PRIVATE)];
    if (state[0] === "yes" && state[1] === "yes") {
      log("The notification keys are already set up. Nothing was changed.");
      return 0;
    }
    if (state.indexOf("unknown") !== -1) {
      log("Couldn't check whether the notification keys already exist, so nothing was changed.");
      log("Make sure you're signed in to Firebase (run: npx firebase-tools login --no-localhost), then try again.");
      return 1;
    }
    if (state[0] !== state[1]) {
      log("Only one of the two notification keys exists. Nothing was changed.");
      log("To start fresh, run: node scripts/setup-vapid.js --force-new");
      return 1;
    }
  }

  const keys = generate();
  for (const [name, value] of [[PRIVATE, keys.privateKey], [PUBLIC, keys.publicKey]]) {
    const res = run(["functions:secrets:set", name, "--data-file", "-", "--force"], value);
    if (res.status !== 0) {
      // The CLI's own message is shown; the key itself never is.
      log("Couldn't save " + name + ".");
      log(String(res.stderr || res.stdout || "").split(value).join("[hidden]").trim().slice(0, 600));
      return 1;
    }
  }
  log("Done. The notification keys are saved as Firebase secrets. They were not displayed.");
  log("Next: deploy the functions (npx firebase-tools deploy --only functions).");
  return 0;
}

module.exports = { main, exists };

if (require.main === module) {
  process.exit(main({ forceNew: process.argv.indexOf("--force-new") !== -1 }));
}
