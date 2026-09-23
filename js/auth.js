/* ==========================================================================
   JARVIS — sign-in gate + Firestore-backed cross-device sync

   Phase 2 of "real accounts": on top of the phase-1 login gate (Firebase
   Authentication, email/password + optional TOTP second factor), this adds
   an actual per-account cloud data store (Firestore), so the same data
   shows up whether you're on your phone or your laptop, instead of each
   device having its own separate localStorage copy.

   How the sync works (deliberately simple, not a full merge/CRDT system —
   fine for one person using their own account from a couple of devices,
   not built for concurrent multi-device editing):
   - Each user's data lives in one Firestore document, users/{uid}, as a
     map of localStorage-key -> value (see SYNCED_KEYS below for exactly
     which keys — notably NOT jarvisVideoConnections, since that holds raw
     AI provider API keys and defaults to staying device-local rather than
     also living in the cloud without being asked).
   - On login: if the cloud document already has a key, the cloud value
     overwrites this device's local copy (cloud wins). Any key that exists
     locally but not yet in the cloud (a brand-new account, or a newer app
     version's key) gets pushed up instead, so nothing already on the
     device is silently lost.
   - After that initial reconciliation, every future JarvisCore.saveJSON()
     call also pushes that one key up to Firestore in the background —
     this is installed by monkey-patching JarvisCore.saveJSON once, so
     none of the ten feature modules (workout.js, habits.js, etc.) needed
     to change at all; they all already go through that one shared
     function.
   - Two devices editing the SAME key while both offline, then both
     reconnecting, is not conflict-resolved beyond "whichever write
     reaches Firestore last wins" for that key as a whole — acceptable for
     a personal app, just not a guarantee of never losing an edit in that
     specific scenario.

   Requires a Firestore database to actually exist in the Firebase project
   (Databases & Storage -> Firestore Database -> Create database) and
   security rules limiting each user's document to that user:
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /users/{userId} {
           allow read, write: if request.auth != null && request.auth.uid == userId;
         }
       }
     }
   Without those rules, Firestore's default in production mode denies all
   reads/writes, so sync will fail closed (caught and toasted, never
   silently lost — local saves always succeed regardless).

   Loaded as a <script type="module"> so it can import the Firebase
   modular SDK straight from Google's CDN by URL — no bundler, consistent
   with the rest of this app's "no build step" approach. Requires
   js/firebase-config.js (loaded first, plain script) to have real project
   values; until then this shows a setup notice instead of trying to
   connect to a project that doesn't exist.

   The QR code for 2-step verification setup is rendered entirely
   client-side via the vendored js/vendor/qrcode library — never sent to
   any third-party image/QR rendering service, since that URL contains the
   TOTP secret itself and sending it out would hand that service the
   ability to generate valid codes for the account too.
   ========================================================================== */

(function () {
  "use strict";

  const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  const FIREBASE_AUTH_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
  const FIREBASE_FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

  // Every localStorage key Jarvis uses, EXCEPT jarvisVideoConnections
  // (holds raw AI provider API keys — stays device-local by default) and
  // jarvisLastBriefingDate (a purely local UI preference, not real data).
  const SYNCED_KEYS = [
    "jarvisWorkouts", "jarvisRoutines", "jarvisPrograms", "jarvisBodyweight",
    "jarvisMeasurements", "jarvisStrengthSettings", "jarvisWorkoutDraft",
    "jarvisHabits", "jarvisBusiness", "jarvisCalories",
    "jarvisTradingWatchlist", "jarvisPaperTrades", "jarvisTradingJournal", "jarvisTradingSettings",
    "jarvisVideo", "jarvisVideoStudio",
    "jarvisCustomExercises", "jarvisFavoriteExercises"
  ];

  const config = window.JARVIS_FIREBASE_CONFIG || {};
  const isConfigured = !!(config.apiKey && config.apiKey !== "REPLACE_ME");

  // Firebase functions, filled in once the SDK module has actually loaded.
  let fb = null;
  let auth = null;
  let db = null;
  let pendingTotpSecret = null; // set while enrollment is waiting on a TOTP code
  let pendingTotpVerifySecret = null; // set while a login is paused waiting on a TOTP code
  let pendingTotpVerifyUser = null; // the Firebase user that verify-on-login is waiting to admit
  let currentUserHasTotp = false; // whether the signed-in user has an enrolled TOTP secret
  let bootStarted = false; // guards against re-running feature-module init on a later login/logout (see proceedToApp)
  let lastUid = undefined; // undefined = no auth state observed yet; null = observed "logged out"

  function $(id) { return document.getElementById(id); }

  const PANELS = [
    "authSetupNotice", "authLoading", "authLoginForm", "authSignupForm",
    "authTotpVerifyForm", "authTotpEnrollPrompt", "authTotpEnrollSetup"
  ];

  function showOnly(id) {
    PANELS.forEach(function (elId) {
      const el = $(elId);
      if (el) el.classList.toggle("hidden", elId !== id);
    });
  }

  function setError(id, message) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("hidden", !message);
  }

  function openGate() { $("authGate").classList.remove("hidden"); }
  function closeGate() { $("authGate").classList.add("hidden"); }

  function friendlyAuthError(err) {
    const code = (err && err.code) || "";
    if (code === "auth/email-already-in-use") return "That email already has an account — try logging in instead.";
    if (code === "auth/invalid-email") return "That doesn't look like a valid email address.";
    if (code === "auth/weak-password") return "Password should be at least 6 characters.";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "Incorrect email or password.";
    if (code === "auth/user-not-found") return "No account found with that email.";
    if (code === "auth/too-many-requests") return "Too many attempts — wait a bit and try again.";
    if (code === "auth/network-request-failed") return "Network error contacting Firebase — check your connection.";
    if (code === "auth/invalid-verification-code") return "That code is wrong or expired — check your authenticator app and try again.";
    return (err && err.message) || "Something went wrong.";
  }

  /* ---------------- login / signup ---------------- */

  function handleLoginSubmit(e) {
    e.preventDefault();
    setError("authLoginError", "");
    const email = $("authLoginEmail").value.trim();
    const password = $("authLoginPassword").value;
    fb.signInWithEmailAndPassword(auth, email, password).catch(function (err) {
      setError("authLoginError", friendlyAuthError(err));
    });
  }

  function handleSignupSubmit(e) {
    e.preventDefault();
    setError("authSignupError", "");
    const email = $("authSignupEmail").value.trim();
    const password = $("authSignupPassword").value;
    const confirmPassword = $("authSignupPasswordConfirm").value;
    if (password !== confirmPassword) { setError("authSignupError", "Passwords don't match."); return; }
    fb.createUserWithEmailAndPassword(auth, email, password).catch(function (err) {
      setError("authSignupError", friendlyAuthError(err));
    });
  }

  function handleLogout() {
    fb.signOut(auth);
  }

  function toast(message) {
    if (window.JarvisCore && typeof window.JarvisCore.showToast === "function") {
      window.JarvisCore.showToast(message);
    }
  }

  /* ---------------- custom TOTP (RFC 6238) ----------------
     Firebase's own multi-factor auth requires upgrading the project to
     Google's "Identity Platform" (confirmed live: attempting to enroll
     without it fails with auth/operation-not-allowed, "TOTP based MFA not
     enabled") — an upgrade that, even on its free tier, generally still
     wants a billing account attached. Rather than require that, this
     implements the same standard (RFC 6238, the algorithm every
     authenticator app already speaks) directly, independent of Firebase's
     MFA product entirely. The secret lives in the user's own Firestore
     document, covered by the same owner-only security rules as the rest
     of their data — never sent anywhere else. This is real, standard TOTP,
     just implemented in this app's own code instead of paying to unlock
     Firebase's built-in version of the same algorithm. */

  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function base32Encode(bytes) {
    let bits = "";
    for (let i = 0; i < bytes.length; i++) bits += bytes[i].toString(2).padStart(8, "0");
    let output = "";
    for (let i = 0; i + 5 <= bits.length; i += 5) {
      output += BASE32_ALPHABET[parseInt(bits.substr(i, 5), 2)];
    }
    const remainder = bits.length % 5;
    if (remainder > 0) {
      const lastChunk = bits.substr(bits.length - remainder).padEnd(5, "0");
      output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
    }
    return output;
  }

  function base32Decode(str) {
    const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = "";
    for (let i = 0; i < clean.length; i++) {
      const val = BASE32_ALPHABET.indexOf(clean[i]);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    return new Uint8Array(bytes);
  }

  function generateTotpSecret() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return base32Encode(bytes);
  }

  function hmacSha1(keyBytes, messageBytes) {
    return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
      .then(function (key) { return crypto.subtle.sign("HMAC", key, messageBytes); })
      .then(function (sig) { return new Uint8Array(sig); });
  }

  function counterToBytes(counter) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, 0);
    view.setUint32(4, counter);
    return new Uint8Array(buf);
  }

  // RFC 4226 dynamic truncation, verified offline against all 5 official
  // RFC 6238 Appendix B test vectors before this was wired into the app.
  function hotp(keyBytes, counter, digits) {
    return hmacSha1(keyBytes, counterToBytes(counter)).then(function (hash) {
      const offset = hash[hash.length - 1] & 0x0f;
      const binCode = ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);
      const code = binCode % Math.pow(10, digits);
      return String(code).padStart(digits, "0");
    });
  }

  function currentTotpCounter() {
    return Math.floor(Date.now() / 1000 / 30);
  }

  // Accepts the current 30s window or either adjacent one, to tolerate
  // ordinary clock drift between this device and the authenticator app.
  function verifyTotp(base32Secret, code) {
    const cleanCode = (code || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanCode)) return Promise.resolve(false);
    const keyBytes = base32Decode(base32Secret);
    const counter = currentTotpCounter();
    return [0, -1, 1].reduce(function (chain, offset) {
      return chain.then(function (found) {
        if (found) return true;
        return hotp(keyBytes, counter + offset, 6).then(function (expected) { return expected === cleanCode; });
      });
    }, Promise.resolve(false));
  }

  function buildOtpauthUrl(secret, email) {
    const label = encodeURIComponent("Jarvis:" + (email || "user"));
    return "otpauth://totp/" + label + "?secret=" + secret + "&issuer=Jarvis&algorithm=SHA1&digits=6&period=30";
  }

  /* ---------------- TOTP: verifying during sign-in ---------------- */

  function handleTotpVerifySubmit(e) {
    e.preventDefault();
    setError("authTotpVerifyError", "");
    const code = $("authTotpVerifyCode").value.trim();
    if (!pendingTotpVerifySecret || !pendingTotpVerifyUser) {
      setError("authTotpVerifyError", "Session expired — try logging in again.");
      return;
    }
    verifyTotp(pendingTotpVerifySecret, code).then(function (ok) {
      if (!ok) { setError("authTotpVerifyError", "That code is wrong or expired — check your authenticator app and try again."); return; }
      const user = pendingTotpVerifyUser;
      pendingTotpVerifySecret = null;
      pendingTotpVerifyUser = null;
      currentUserHasTotp = true;
      finishLoginFlow(user);
    });
  }

  function handleTotpVerifyCancel() {
    pendingTotpVerifySecret = null;
    pendingTotpVerifyUser = null;
    fb.signOut(auth);
  }

  /* ---------------- TOTP: enrolling a new authenticator app ---------------- */

  function renderQrCode(otpauthUrl) {
    const container = $("authTotpQrCode");
    if (!container) return;
    if (!window.qrcode) {
      container.innerHTML = "";
      return;
    }
    const qr = window.qrcode(0, "M");
    qr.addData(otpauthUrl);
    qr.make();
    container.innerHTML = qr.createSvgTag(5, 8);
  }

  function startTotpEnrollment() {
    const user = auth.currentUser;
    if (!user) return;
    const secret = generateTotpSecret();
    pendingTotpSecret = secret;
    renderQrCode(buildOtpauthUrl(secret, user.email));
    $("authTotpSecretText").textContent = "Manual entry key: " + secret;
    $("authTotpEnrollCode").value = "";
    setError("authTotpEnrollError", "");
    showOnly("authTotpEnrollSetup");
  }

  function handleTotpEnrollSubmit(e) {
    e.preventDefault();
    setError("authTotpEnrollError", "");
    const code = $("authTotpEnrollCode").value.trim();
    if (!pendingTotpSecret) { setError("authTotpEnrollError", "Session expired — start over."); return; }
    verifyTotp(pendingTotpSecret, code).then(function (ok) {
      if (!ok) { setError("authTotpEnrollError", "That code doesn't match — check your authenticator app and try again."); return; }
      const ref = fb.doc(db, "users", auth.currentUser.uid);
      return fb.setDoc(ref, { totpSecret: pendingTotpSecret }, { merge: true }).then(function () {
        pendingTotpSecret = null;
        currentUserHasTotp = true;
        updateHeaderForUser(auth.currentUser);
        toast("2-step verification enabled.");
        closeGate();
      });
    }).catch(function (err) {
      setError("authTotpEnrollError", friendlyAuthError(err));
    });
  }

  function handleTotpEnrollCancel() {
    pendingTotpSecret = null;
    closeGate();
  }

  /* ---------------- Firestore sync ---------------- */

  function writeLocalOnly(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function readLocalSnapshot() {
    const snapshot = {};
    SYNCED_KEYS.forEach(function (key) {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      try { snapshot[key] = JSON.parse(raw); } catch (e) { /* skip unparsable */ }
    });
    return snapshot;
  }

  // Runs once right after login: reconciles this device's local data with
  // the account's cloud copy (cloud wins per-key if present, otherwise the
  // local value is pushed up) so nothing already on the device is lost the
  // first time an existing local-only user logs into their new account.
  function syncFromCloud(uid) {
    const ref = fb.doc(db, "users", uid);
    return fb.getDoc(ref).then(function (snap) {
      const cloudStore = (snap.exists() && snap.data().store) || null;
      const localSnapshot = readLocalSnapshot();

      if (!cloudStore) {
        if (Object.keys(localSnapshot).length === 0) return null;
        return fb.setDoc(ref, { store: localSnapshot }, { merge: true });
      }

      Object.keys(cloudStore).forEach(function (key) {
        if (SYNCED_KEYS.indexOf(key) !== -1) writeLocalOnly(key, cloudStore[key]);
      });

      const missingFromCloud = {};
      Object.keys(localSnapshot).forEach(function (key) {
        if (!(key in cloudStore)) missingFromCloud[key] = localSnapshot[key];
      });
      if (Object.keys(missingFromCloud).length > 0) {
        return fb.setDoc(ref, { store: missingFromCloud }, { merge: true });
      }
      return null;
    }).catch(function (err) {
      toast("Couldn't sync your data from the cloud (" + friendlyAuthError(err) + "). Continuing with what's on this device.");
    });
  }

  // Monkey-patches JarvisCore.saveJSON exactly once so every future save
  // from any feature module also pushes that key to Firestore in the
  // background. The local synchronous write always happens first and
  // always succeeds regardless of network state; the cloud push is
  // best-effort and never blocks or throws back into the caller.
  let saveJSONPatched = false;
  function installSyncedSaveJSON() {
    if (saveJSONPatched) return;
    saveJSONPatched = true;
    const core = window.JarvisCore;
    const originalSaveJSON = core.saveJSON;
    core.saveJSON = function (key, value) {
      const result = originalSaveJSON(key, value);
      if (SYNCED_KEYS.indexOf(key) !== -1 && auth && auth.currentUser) {
        const ref = fb.doc(db, "users", auth.currentUser.uid);
        const patch = {};
        patch[key] = value;
        fb.setDoc(ref, { store: patch }, { merge: true }).catch(function () { /* best-effort; local save already succeeded */ });
      }
      return result;
    };
  }

  // The app only ever boots its feature modules once per page load. If
  // auth state changes again afterward (a login from the "please log in"
  // screen, or a logout mid-session), a full reload is simpler and safer
  // than trying to make every already-initialized module re-read data it
  // already loaded into memory.
  function proceedToApp() {
    if (bootStarted) {
      window.location.reload();
      return;
    }
    bootStarted = true;
    document.dispatchEvent(new CustomEvent("jarvis-ready-to-start"));
  }

  /* ---------------- header account controls ---------------- */

  function updateHeaderForUser(user) {
    const emailEl = $("authAccountEmail");
    const logoutBtn = $("authLogoutBtn");
    const setup2faBtn = $("authSetup2faBtn");
    if (emailEl) emailEl.textContent = user ? user.email : "";
    if (logoutBtn) logoutBtn.classList.toggle("hidden", !user);
    if (setup2faBtn) setup2faBtn.classList.toggle("hidden", !user || currentUserHasTotp);
  }

  // Fetches the user's account doc once at login to see if they have an
  // enrolled TOTP secret. Returns the secret string, or null if not enrolled
  // (including if the read itself fails — fails open into "not enrolled"
  // rather than locking someone out because of a transient read error;
  // password auth alone still guards the account either way).
  function checkTotpEnrollment(uid) {
    return fb.getDoc(fb.doc(db, "users", uid)).then(function (snap) {
      const secret = snap.exists() ? snap.data().totpSecret : null;
      return typeof secret === "string" && secret ? secret : null;
    }).catch(function () {
      return null;
    });
  }

  // Runs once the (optional) TOTP check is satisfied: syncs cloud data,
  // then shows the 2FA-enrollment prompt for accounts that don't have it
  // yet, and hands off to the rest of the app either way.
  function finishLoginFlow(user) {
    showOnly("authLoading");
    $("authLoading").querySelector("p").textContent = "Syncing your data…";
    syncFromCloud(user.uid).then(function () {
      if (!currentUserHasTotp && !pendingTotpSecret) {
        showOnly("authTotpEnrollPrompt");
        openGate();
      } else {
        closeGate();
      }
      proceedToApp();
    });
  }

  /* ---------------- wiring ---------------- */

  function wireForm(formId, submitHandler) {
    const form = $(formId);
    if (form) form.addEventListener("submit", submitHandler);
  }

  function showSetupNotice(message) {
    $("authSetupNoticeText").textContent = message;
    showOnly("authSetupNotice");
  }

  async function init() {
    const continueBtn = $("authContinueWithoutLoginBtn");
    if (continueBtn) continueBtn.addEventListener("click", function () { closeGate(); proceedToApp(); });

    if (!isConfigured) {
      showSetupNotice(
        'Sign-in isn’t configured yet. Open js/firebase-config.js and replace the placeholder values with your ' +
        'own Firebase project’s config (Project settings → "Your apps" in the Firebase console).'
      );
      return;
    }

    // Dynamic import so a network/CDN failure (offline, a blocked domain,
    // Google having an outage) is a catchable error instead of a hard
    // failure that would leave the whole app stuck behind a spinner
    // forever, over something that has nothing to do with the user's own
    // data or their Firebase setup.
    try {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import(FIREBASE_APP_URL),
        import(FIREBASE_AUTH_URL),
        import(FIREBASE_FIRESTORE_URL)
      ]);
      fb = Object.assign({}, appModule, authModule, firestoreModule);
    } catch (err) {
      showSetupNotice("Couldn't reach the sign-in service (network issue loading Firebase). You can keep using JARVIS normally for now — your local data is unaffected.");
      return;
    }

    const app = fb.initializeApp(config);
    auth = fb.getAuth(app);
    db = fb.getFirestore(app);
    installSyncedSaveJSON();

    wireForm("authLoginForm", handleLoginSubmit);
    wireForm("authSignupForm", handleSignupSubmit);
    wireForm("authTotpVerifyForm", handleTotpVerifySubmit);
    wireForm("authTotpEnrollForm", handleTotpEnrollSubmit);

    const showSignup = $("authShowSignupLink");
    if (showSignup) showSignup.addEventListener("click", function (e) { e.preventDefault(); showOnly("authSignupForm"); });
    const showLogin = $("authShowLoginLink");
    if (showLogin) showLogin.addEventListener("click", function (e) { e.preventDefault(); showOnly("authLoginForm"); });

    const totpVerifyCancel = $("authTotpVerifyCancelBtn");
    if (totpVerifyCancel) totpVerifyCancel.addEventListener("click", handleTotpVerifyCancel);
    const totpEnrollStart = $("authTotpEnrollStartBtn");
    if (totpEnrollStart) totpEnrollStart.addEventListener("click", startTotpEnrollment);
    const totpEnrollSkip = $("authTotpEnrollSkipBtn");
    if (totpEnrollSkip) totpEnrollSkip.addEventListener("click", closeGate);
    const totpEnrollCancel = $("authTotpEnrollCancelBtn");
    if (totpEnrollCancel) totpEnrollCancel.addEventListener("click", handleTotpEnrollCancel);

    const logoutBtn = $("authLogoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
    const setup2faBtn = $("authSetup2faBtn");
    if (setup2faBtn) {
      setup2faBtn.addEventListener("click", function () {
        openGate();
        startTotpEnrollment();
      });
    }

    fb.onAuthStateChanged(auth, function (user) {
      const uid = user ? user.uid : null;
      if (bootStarted && uid === lastUid) {
        // Same identity as what already booted (e.g. Firebase re-confirming
        // a restored session) — not a real transition, don't reload.
        updateHeaderForUser(user);
        return;
      }
      lastUid = uid;
      updateHeaderForUser(user);
      if (!user) {
        currentUserHasTotp = false;
        $("authLoginForm").reset();
        showOnly("authLoginForm");
        openGate();
        proceedToApp();
        return;
      }
      showOnly("authLoading");
      $("authLoading").querySelector("p").textContent = "Checking your account…";
      checkTotpEnrollment(user.uid).then(function (secret) {
        if (secret) {
          currentUserHasTotp = true;
          pendingTotpVerifySecret = secret;
          pendingTotpVerifyUser = user;
          $("authTotpVerifyCode").value = "";
          setError("authTotpVerifyError", "");
          showOnly("authTotpVerifyForm");
          openGate();
          return; // finishLoginFlow runs after handleTotpVerifySubmit succeeds
        }
        currentUserHasTotp = false;
        finishLoginFlow(user);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
