/* ==========================================================================
   JARVIS — sign-in gate with optional TOTP 2-step verification

   Phase 1 of "real accounts": gates the whole app behind Firebase
   Authentication (email/password + optional TOTP second factor). Every
   feature's data still lives in this device's localStorage exactly as
   before — this does not yet sync data between devices or separate data
   per account. That's a bigger follow-up (a Firestore-backed persistence
   layer) once this login layer itself is confirmed working.

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

  const config = window.JARVIS_FIREBASE_CONFIG || {};
  const isConfigured = !!(config.apiKey && config.apiKey !== "REPLACE_ME");

  // Firebase functions, filled in once the SDK module has actually loaded.
  let fb = null;
  let auth = null;
  let mfaResolver = null; // set while a login is paused waiting on a TOTP code
  let pendingTotpSecret = null; // set while enrollment is waiting on a TOTP code

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
      if (err && err.code === "auth/multi-factor-auth-required") {
        mfaResolver = fb.getMultiFactorResolver(auth, err);
        $("authTotpVerifyCode").value = "";
        setError("authTotpVerifyError", "");
        showOnly("authTotpVerifyForm");
        return;
      }
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

  /* ---------------- TOTP: verifying during sign-in ---------------- */

  function handleTotpVerifySubmit(e) {
    e.preventDefault();
    setError("authTotpVerifyError", "");
    const code = $("authTotpVerifyCode").value.trim();
    if (!mfaResolver) { setError("authTotpVerifyError", "Session expired — try logging in again."); return; }
    const hint = mfaResolver.hints.filter(function (h) { return h.factorId === fb.TotpMultiFactorGenerator.FACTOR_ID; })[0];
    if (!hint) { setError("authTotpVerifyError", "No authenticator app is enrolled on this account."); return; }
    const assertion = fb.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
    mfaResolver.resolveSignIn(assertion).then(function () {
      mfaResolver = null;
    }).catch(function (err) {
      setError("authTotpVerifyError", friendlyAuthError(err));
    });
  }

  function handleTotpVerifyCancel() {
    mfaResolver = null;
    showOnly("authLoginForm");
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
    fb.multiFactor(user).getSession()
      .then(function (session) { return fb.TotpMultiFactorGenerator.generateSecret(session); })
      .then(function (secret) {
        pendingTotpSecret = secret;
        const otpauthUrl = secret.generateQrCodeUrl(user.email || "Jarvis user", "Jarvis");
        renderQrCode(otpauthUrl);
        $("authTotpSecretText").textContent = "Manual entry key: " + secret.secretKey;
        $("authTotpEnrollCode").value = "";
        setError("authTotpEnrollError", "");
        showOnly("authTotpEnrollSetup");
      })
      .catch(function (err) {
        toast(friendlyAuthError(err));
      });
  }

  function handleTotpEnrollSubmit(e) {
    e.preventDefault();
    setError("authTotpEnrollError", "");
    const code = $("authTotpEnrollCode").value.trim();
    if (!pendingTotpSecret) { setError("authTotpEnrollError", "Session expired — start over."); return; }
    const assertion = fb.TotpMultiFactorGenerator.assertionForEnrollment(pendingTotpSecret, code);
    fb.multiFactor(auth.currentUser).enroll(assertion, "Authenticator app").then(function () {
      pendingTotpSecret = null;
      toast("2-step verification enabled.");
      closeGate();
    }).catch(function (err) {
      setError("authTotpEnrollError", friendlyAuthError(err));
    });
  }

  function handleTotpEnrollCancel() {
    pendingTotpSecret = null;
    closeGate();
  }

  function toast(message) {
    if (window.JarvisCore && typeof window.JarvisCore.showToast === "function") {
      window.JarvisCore.showToast(message);
    }
  }

  /* ---------------- header account controls ---------------- */

  function updateHeaderForUser(user) {
    const emailEl = $("authAccountEmail");
    const logoutBtn = $("authLogoutBtn");
    const setup2faBtn = $("authSetup2faBtn");
    if (emailEl) emailEl.textContent = user ? user.email : "";
    if (logoutBtn) logoutBtn.classList.toggle("hidden", !user);
    if (setup2faBtn) {
      const hasTotp = !!(user && fb.multiFactor(user).enrolledFactors.length > 0);
      setup2faBtn.classList.toggle("hidden", !user || hasTotp);
    }
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
    if (continueBtn) continueBtn.addEventListener("click", closeGate);

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
      const [appModule, authModule] = await Promise.all([
        import(FIREBASE_APP_URL),
        import(FIREBASE_AUTH_URL)
      ]);
      fb = Object.assign({}, appModule, authModule);
    } catch (err) {
      showSetupNotice("Couldn't reach the sign-in service (network issue loading Firebase). You can keep using JARVIS normally for now — your local data is unaffected.");
      return;
    }

    const app = fb.initializeApp(config);
    auth = fb.getAuth(app);

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
      updateHeaderForUser(user);
      if (!user) {
        $("authLoginForm").reset();
        showOnly("authLoginForm");
        openGate();
        return;
      }
      const hasTotp = fb.multiFactor(user).enrolledFactors.length > 0;
      if (!hasTotp && !pendingTotpSecret) {
        showOnly("authTotpEnrollPrompt");
        openGate();
      } else {
        closeGate();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
