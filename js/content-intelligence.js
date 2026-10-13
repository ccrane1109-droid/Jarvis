/* ==========================================================================
   JARVIS — Content Intelligence (seed)

   This is the first small piece of what's planned to grow into a larger
   marketing-intelligence module for Gratiel. For now it's deliberately
   minimal: a BYO-key connection to InsightSocial (a third-party API the
   user signed up and pays for separately — Jarvis never sees or stores
   the key anywhere but this browser, same pattern as Video Connections
   and the Nutrition AI estimate) plus one test lookup to prove the wiring
   works. Every call goes straight from this device to InsightSocial's
   API using the user's own key and credits — nothing routes through or
   is paid for by Jarvis.

   Only one endpoint is wired up (GET /v1/instagram/profile) because it's
   the only one confirmed so far. The response is shown as raw JSON
   rather than mapped to named fields, since the exact response schema
   hasn't been confirmed — guessing field names here would risk silently
   mis-displaying real data as something it isn't.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisInsightSocialKey";
  const API_BASE = "https://api.insightsocial.app/v1";

  function $(id) { return document.getElementById(id); }

  function loadKey() {
    try { return localStorage.getItem(LS_KEY) || ""; } catch (e) { return ""; }
  }
  function saveKey(key) {
    try { localStorage.setItem(LS_KEY, key); return true; } catch (e) { return false; }
  }
  function clearKey() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }

  function renderConnectionStatus() {
    const key = loadKey();
    const statusEl = $("ciConnectionStatus");
    const disconnectBtn = $("ciDisconnectBtn");
    if (!statusEl) return;
    statusEl.textContent = key
      ? "Connected — key ending in " + key.slice(-4) + "."
      : "Not connected yet.";
    if (disconnectBtn) disconnectBtn.classList.toggle("hidden", !key);
  }

  function handleSaveKey(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const input = $("ciApiKeyInput");
    const key = input.value.trim();
    if (!key) { core.showToast("Paste your InsightSocial API key first."); return; }
    saveKey(key);
    input.value = "";
    renderConnectionStatus();
    core.showToast("InsightSocial connected.");
  }

  function handleDisconnect() {
    if (!window.confirm("Disconnect InsightSocial? This removes the saved key from this device.")) return;
    clearKey();
    renderConnectionStatus();
    window.JarvisCore.showToast("Disconnected.");
  }

  function handleLookup(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const key = loadKey();
    if (!key) { core.showToast("Connect your InsightSocial API key first."); return; }
    const handle = $("ciLookupHandle").value.trim().replace(/^@/, "");
    if (!handle) { core.showToast("Enter an Instagram handle."); return; }

    const btn = $("ciLookupBtn");
    const statusEl = $("ciLookupStatus");
    const resultEl = $("ciLookupResult");
    btn.disabled = true;
    statusEl.textContent = "Looking up @" + handle + "… (this uses your InsightSocial credits)";
    resultEl.innerHTML = "";

    fetch(API_BASE + "/instagram/profile?handle=" + encodeURIComponent(handle), {
      headers: { "x-api-key": key }
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    }).then(function (result) {
      btn.disabled = false;
      resultEl.innerHTML = '<pre class="video-raw-response"></pre>';
      resultEl.firstChild.textContent = JSON.stringify(result.data, null, 2);
      statusEl.textContent = result.ok
        ? "Response received — raw data below (shown as-is; field names aren't mapped yet since the response schema isn't confirmed)."
        : "Request failed (HTTP " + result.status + ") — details below.";
    }).catch(function (err) {
      btn.disabled = false;
      statusEl.textContent = "Couldn't reach InsightSocial: " + (err && err.message ? err.message : "network error.");
    });
  }

  function init() {
    const connectForm = $("ciConnectForm");
    const lookupForm = $("ciLookupForm");
    if (!connectForm || !lookupForm) return;
    connectForm.addEventListener("submit", handleSaveKey);
    $("ciDisconnectBtn").addEventListener("click", handleDisconnect);
    lookupForm.addEventListener("submit", handleLookup);
    renderConnectionStatus();
  }

  window.JarvisContentIntel = { init: init };
})();
