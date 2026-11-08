/* ==========================================================================
   Errors and the owner check shared by the server's callable functions.

   An expected problem is thrown as a ServerError, which carries a Firebase
   HttpsError code and a message that is safe to show; lib/guard.js turns it
   into the error the browser gets. Anything else is logged with a short
   reference instead of being shown.
   ========================================================================== */

"use strict";

class ServerError extends Error {
  constructor(code, message, reason) {
    super(message);
    this.code = code;             // a Firebase HttpsError code
    this.reason = reason || null;
  }
}

// Only the one signed-in account that owns this JARVIS may use the server.
function requireOwner(uid, deps) {
  if (!uid) throw new ServerError("unauthenticated", "Sign in to JARVIS to use this feature.");
  if (!deps.ownerUid) throw new ServerError("failed-precondition", "The server's OWNER_UID isn't configured.");
  if (uid !== deps.ownerUid) throw new ServerError("permission-denied", "This account isn't allowed to use this feature.");
}

module.exports = { ServerError, requireOwner };
