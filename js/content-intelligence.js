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
  // Every InsightSocial key seen so far starts with this (isk_live_...).
  const KEY_PREFIX = "isk_";

  function $(id) { return document.getElementById(id); }

  function loadKey() {
    try { return localStorage.getItem(LS_KEY) || ""; } catch (e) { return ""; }
  }
  // Reads the value back so a browser that silently refuses storage is
  // reported as a failure instead of a fake success.
  function saveKey(key) {
    try {
      localStorage.setItem(LS_KEY, key);
      return localStorage.getItem(LS_KEY) === key;
    } catch (e) {
      return false;
    }
  }
  function clearKey() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }
  function looksLikeKey(key) { return key.indexOf(KEY_PREFIX) === 0; }

  function renderConnectionStatus() {
    const key = loadKey();
    const statusEl = $("ciConnectionStatus");
    const disconnectBtn = $("ciDisconnectBtn");
    const input = $("ciApiKeyInput");
    if (!statusEl) return;
    const badKey = !!key && !looksLikeKey(key);
    if (!key) {
      statusEl.textContent = "Not connected yet.";
    } else if (badKey) {
      statusEl.textContent = "The saved value (ending in " + key.slice(-4) + ") isn't an InsightSocial key — they start with \"" + KEY_PREFIX + "\". Paste your key from the InsightSocial dashboard and save again.";
    } else {
      statusEl.textContent = "Saved — key ending in " + key.slice(-4) + ". The box stays empty on purpose; paste a new key only to replace it.";
    }
    statusEl.classList.toggle("text-negative", badKey);
    if (input) input.placeholder = key && !badKey ? "Saved (ending in " + key.slice(-4) + ")" : "isk_live_...";
    if (disconnectBtn) disconnectBtn.classList.toggle("hidden", !key);
  }

  function handleSaveKey(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const input = $("ciApiKeyInput");
    // Keys never contain whitespace; copying from a dashboard can pick up
    // spaces or line breaks.
    const key = input.value.replace(/\s+/g, "");
    if (!key) { core.showToast("Paste your InsightSocial API key first."); return; }
    if (!looksLikeKey(key)) {
      core.showToast("That isn't an InsightSocial key — they start with \"" + KEY_PREFIX + "\". Copy it from your InsightSocial dashboard.");
      return;
    }
    if (!saveKey(key)) {
      core.showToast("Your browser blocked saving the key (private browsing or storage turned off?). Nothing was saved.");
      renderConnectionStatus();
      return;
    }
    input.value = "";
    renderConnectionStatus();
    core.showToast("Key saved (ending in " + key.slice(-4) + ").");
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
    if (!looksLikeKey(key)) { core.showToast("The saved key isn't valid — re-paste your InsightSocial key above first."); return; }
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

  /* ---------------- automatic research (written daily by GitHub Actions) ---------------- */

  const AUTO_DATA_URL = "data/marketing-research.json";

  function autoResultItem(r) {
    const item = document.createElement("div");
    item.className = "list-item";
    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = (r.label || r.path || "Request") + " ";
    const badge = document.createElement("span");
    badge.className = "badge " + (r.skipped ? "badge-neutral" : r.ok ? "badge-green" : "badge-yellow");
    badge.textContent = r.skipped ? "Skipped" : r.ok ? "OK" : "Failed";
    title.appendChild(badge);
    item.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "field-hint";
    if (r.skipped) {
      meta.textContent = r.skipped;
    } else {
      const parts = [r.ok ? "HTTP " + r.status : (r.error || "HTTP " + r.status)];
      if (r.attempts > 1) parts.push("after " + r.attempts + " attempts");
      parts.push(typeof r.creditsUsed === "number" ? r.creditsUsed + " credits" : "credit cost not reported");
      meta.textContent = parts.join(" · ");
    }
    item.appendChild(meta);

    if (r.data !== undefined && r.data !== null) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Raw response";
      const pre = document.createElement("pre");
      pre.className = "video-raw-response";
      pre.textContent = JSON.stringify(r.data, null, 2);
      details.appendChild(summary);
      details.appendChild(pre);
      item.appendChild(details);
    }
    return item;
  }

  function renderAutoResearch() {
    const statusEl = $("ciAutoStatus");
    const listEl = $("ciAutoResults");
    if (!statusEl || !listEl) return;
    fetch(AUTO_DATA_URL, { cache: "no-store" }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      listEl.textContent = "";
      const run = data && data.latest;
      if (!run || !Array.isArray(run.results)) {
        statusEl.textContent = "No automatic research has run yet.";
        return;
      }
      const parts = ["Last run " + window.JarvisCore.formatDateTime(run.finishedAt || run.startedAt)];
      if (typeof run.creditsUsed === "number") parts.push(run.creditsUsed + " credits used");
      if (typeof run.creditsRemaining === "number") parts.push(run.creditsRemaining.toLocaleString() + " remaining");
      statusEl.textContent = parts.join(" · ") + ".";
      (run.notes || []).forEach(function (note) {
        const p = document.createElement("p");
        p.className = "field-hint";
        p.textContent = note;
        listEl.appendChild(p);
      });
      run.results.forEach(function (r) { listEl.appendChild(autoResultItem(r)); });
    }).catch(function (err) {
      statusEl.textContent = "Couldn't load automatic research results: " + (err && err.message ? err.message : "unknown error") + ".";
    });
  }

  function init() {
    renderAutoResearch();
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
