"use strict";

// Wraps a callable handler so the browser always gets a clear error:
// expected problems (InsightError) keep their code and message; anything
// unexpected is logged with a short reference the app shows, so the
// matching entry is easy to find in Firebase console > Functions > Logs.
// Logs carry the error message and stack only — never request data or keys.

const crypto = require("crypto");

function makeGuard(deps) {
  return async function guarded(name, fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof deps.InsightError) throw new deps.HttpsError(err.code, err.message);
      const ref = crypto.randomBytes(4).toString("hex");
      deps.logger.error("Unexpected marketing function error", {
        fn: name,
        ref: ref,
        message: err && err.message,
        stack: err && err.stack
      });
      throw new deps.HttpsError("internal", "Unexpected server error.", { ref: ref, fn: name });
    }
  };
}

module.exports = { makeGuard };
