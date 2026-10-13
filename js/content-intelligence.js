/* ==========================================================================
   JARVIS — Marketing (Content Intelligence)

   Every InsightSocial request goes through JARVIS's own Firebase Cloud
   Functions (functions/), which hold the API key as a server secret, accept
   only the owner's signed-in account, cache results, and enforce a monthly
   credit cap. The browser never sees the key.

   Earlier versions stored the key in this browser's localStorage; that copy
   is deleted on load since the server now holds the only one.
   ========================================================================== */

(function () {
  "use strict";

  const LEGACY_KEY_STORAGE = "jarvisInsightSocialKey";

  function $(id) { return document.getElementById(id); }

  function removeLegacyBrowserKey() {
    try {
      if (localStorage.getItem(LEGACY_KEY_STORAGE) === null) return false;
      localStorage.removeItem(LEGACY_KEY_STORAGE);
      return true;
    } catch (e) {
      return false;
    }
  }

  function cloud() { return window.JarvisCloud || null; }

  // Turns a Cloud Functions error into something actionable.
  function describeCallError(err) {
    const code = (err && err.code) || "";
    const message = (err && err.message) || "";
    if (code === "functions/unauthenticated") return "Sign in to JARVIS to use Marketing research.";
    if (code === "functions/permission-denied") return "This account isn't allowed to use Marketing research.";
    if (code === "functions/not-found") return "The Marketing server isn't deployed yet.";
    if (code === "functions/failed-precondition" || code === "functions/resource-exhausted" || code === "functions/invalid-argument") return message;
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") return "Couldn't reach the Marketing server. Check your connection and try again.";
    return "Something went wrong talking to the Marketing server" + (message ? ": " + message : ".");
  }

  function formatNumber(n) { return typeof n === "number" ? n.toLocaleString() : "—"; }

  /* ---------------- server connection status (spends no credits) ---------------- */

  function renderStatus(notice) {
    const statusEl = $("ciConnectionStatus");
    const usageEl = $("ciUsageSummary");
    if (!statusEl) return;
    statusEl.classList.remove("text-negative");
    usageEl.textContent = notice || "";

    const c = cloud();
    if (!c) {
      statusEl.textContent = "Marketing research needs JARVIS's sign-in service, which didn't load. Your other data is unaffected.";
      return;
    }
    if (!c.isSignedIn()) {
      statusEl.textContent = "Sign in to JARVIS to use Marketing research. Requests run on your private server, not in this browser.";
      return;
    }
    statusEl.textContent = "Checking your Marketing server…";
    c.call("marketingStatus").then(function (s) {
      if (!s.keyConfigured) {
        statusEl.textContent = "Server reached, but your InsightSocial key isn't set on it yet.";
        statusEl.classList.add("text-negative");
        return;
      }
      statusEl.textContent = "Connected to your Marketing server. Your InsightSocial key is stored there, never in this browser.";
      const u = s.usage || {};
      const parts = [formatNumber(u.creditsUsed) + " of " + formatNumber(s.monthlyCreditCap) + " credits used this month (" + formatNumber(u.requests) + " requests)"];
      if (typeof u.lastCreditsRemaining === "number") parts.push(formatNumber(u.lastCreditsRemaining) + " credits left on your InsightSocial plan (last reported)");
      if (u.unknownCostRequests) parts.push(u.unknownCostRequests + " request(s) didn't report a cost");
      usageEl.textContent = (notice ? notice + " " : "") + parts.join(" · ") + ".";
    }).catch(function (err) {
      statusEl.textContent = describeCallError(err);
      statusEl.classList.add("text-negative");
    });
  }

  /* ---------------- profile lookup ---------------- */

  let lastHandle = "";

  function showResult(res) {
    const statusEl = $("ciLookupStatus");
    const resultEl = $("ciLookupResult");
    const refreshBtn = $("ciRefreshBtn");
    resultEl.textContent = "";
    refreshBtn.classList.toggle("hidden", !(res.ok && res.cached));

    if (res.ok) {
      const parts = [];
      if (res.cached) {
        parts.push("Saved result from " + window.JarvisCore.formatDateTime(res.fetchedAt) + " — no credits used");
      } else {
        parts.push("Fresh result from InsightSocial");
        parts.push(typeof res.creditsUsed === "number" ? res.creditsUsed + " credit(s) used" : "credit cost not reported");
      }
      if (res.note) parts.push(res.note.replace(/\.$/, ""));
      statusEl.textContent = parts.join(" · ") + ".";
    } else {
      const parts = ["InsightSocial request failed" + (res.status ? " (HTTP " + res.status + ")" : "") + ": " + res.error];
      if (typeof res.creditsUsed === "number") parts.push(res.creditsUsed + " credit(s) charged");
      statusEl.textContent = parts.join(" · ");
    }
    if (res.body) {
      const details = document.createElement("details");
      details.open = !!res.ok;
      const summary = document.createElement("summary");
      summary.textContent = "Response data (shown as received)";
      const pre = document.createElement("pre");
      pre.className = "video-raw-response";
      pre.textContent = JSON.stringify(res.body, null, 2);
      details.appendChild(summary);
      details.appendChild(pre);
      resultEl.appendChild(details);
    }
  }

  function runLookup(handle, refresh) {
    const core = window.JarvisCore;
    const c = cloud();
    if (!c || !c.isSignedIn()) { core.showToast("Sign in to JARVIS to use Marketing research."); return; }
    const btn = $("ciLookupBtn");
    const refreshBtn = $("ciRefreshBtn");
    const statusEl = $("ciLookupStatus");
    btn.disabled = true;
    refreshBtn.disabled = true;
    statusEl.textContent = (refresh ? "Refreshing" : "Looking up") + " @" + handle + "…";
    $("ciLookupResult").textContent = "";
    c.call("insightRequest", { endpoint: "instagram.profile", params: { handle: handle }, refresh: !!refresh }).then(function (res) {
      showResult(res);
      if (!res.cached) renderStatus();
    }).catch(function (err) {
      statusEl.textContent = describeCallError(err);
    }).then(function () {
      btn.disabled = false;
      refreshBtn.disabled = false;
    });
  }

  function handleLookup(e) {
    e.preventDefault();
    const handle = $("ciLookupHandle").value.trim().replace(/^@/, "");
    if (!handle) { window.JarvisCore.showToast("Enter an Instagram handle."); return; }
    lastHandle = handle;
    runLookup(handle, false);
  }

  function handleRefresh() {
    if (lastHandle) runLookup(lastHandle, true);
  }

  function init() {
    const lookupForm = $("ciLookupForm");
    if (!lookupForm) return;
    lookupForm.addEventListener("submit", handleLookup);
    $("ciRefreshBtn").addEventListener("click", handleRefresh);
    $("ciStatusRefreshBtn").addEventListener("click", function () { renderStatus(); });
    const removed = removeLegacyBrowserKey();
    renderStatus(removed ? "The InsightSocial key previously saved in this browser was deleted; your server holds the only copy now." : "");
  }

  window.JarvisContentIntel = { init: init };
})();
