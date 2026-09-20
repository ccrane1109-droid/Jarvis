/* ==========================================================================
   JARVIS — AI Video (text-to-video via a user-configured API)
   localStorage key: jarvisVideo -> { settings: {...}, generations: [...] }

   JARVIS does not bundle any video generation provider. The user points
   this module at their own HTTP endpoint (URL, auth header, API key, and a
   JSON request body template); calls go straight from the browser to that
   endpoint. Nothing is invented about any specific provider's API shape.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisVideo";
  const DEFAULT_BODY_TEMPLATE = '{\n  "prompt": "{{prompt}}",\n  "aspect_ratio": "{{aspectRatio}}",\n  "duration": {{duration}}\n}';
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_HISTORY = 100;

  let data = { settings: defaultSettings(), generations: [] };

  function defaultSettings() {
    return {
      endpointUrl: "",
      apiKey: "",
      authHeader: "Authorization",
      bodyTemplate: DEFAULT_BODY_TEMPLATE,
      responsePath: "video_url"
    };
  }

  function load() {
    const loaded = window.JarvisCore.loadJSON(LS_KEY, { settings: defaultSettings(), generations: [] });
    data = {
      settings: Object.assign(defaultSettings(), loaded.settings || {}),
      generations: Array.isArray(loaded.generations) ? loaded.generations : []
    };
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, data);
  }

  function isConnected() {
    return !!(data.settings.endpointUrl && data.settings.endpointUrl.trim());
  }

  /* ---------------- template + response helpers ---------------- */

  function fillBodyTemplate(template, vars) {
    let out = template;
    // Quoted placeholders first, so string values get properly JSON-escaped.
    out = out.replace(/"\{\{prompt\}\}"/g, JSON.stringify(vars.prompt));
    out = out.replace(/"\{\{aspectRatio\}\}"/g, JSON.stringify(vars.aspectRatio));
    out = out.replace(/"\{\{duration\}\}"/g, JSON.stringify(vars.duration));
    // Any remaining bare placeholders.
    out = out.replace(/\{\{duration\}\}/g, String(vars.duration));
    out = out.replace(/\{\{prompt\}\}/g, JSON.stringify(vars.prompt));
    out = out.replace(/\{\{aspectRatio\}\}/g, JSON.stringify(vars.aspectRatio));
    return out;
  }

  function resolvePath(obj, path) {
    if (!path) return undefined;
    const parts = path.split(".").map(function (p) { return p.trim(); }).filter(Boolean);
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function truncate(str, n) {
    if (str.length <= n) return str;
    return str.slice(0, n) + "…";
  }

  /* ---------------- rendering ---------------- */

  function renderStats() {
    const total = data.generations.length;
    const now = Date.now();
    const week = data.generations.filter(function (g) { return now - g.createdAt < WEEK_MS; }).length;
    const completed = data.generations.filter(function (g) { return g.status === "success"; }).length;
    document.getElementById("videoStatTotal").textContent = String(total);
    document.getElementById("videoStatWeek").textContent = String(week);
    document.getElementById("videoStatSuccess").textContent = String(completed);
  }

  function renderConnectionHint() {
    const hint = document.getElementById("videoConnectionStatusHint");
    if (!hint) return;
    hint.textContent = isConnected()
      ? "Connected to " + data.settings.endpointUrl
      : "No connection configured yet.";
  }

  function generationResultHTML(g) {
    const core = window.JarvisCore;
    const badgeClass = g.status === "success" ? "badge-green" : g.status === "error" ? "badge-red" : "badge-neutral";
    const badgeText = g.status === "success" ? "Completed" : g.status === "error" ? "Failed" : "Pending";
    let body = "";
    if (g.status === "success" && g.videoUrl) {
      body = '<video class="video-preview" controls src="' + core.escapeHtml(g.videoUrl) + '"></video>' +
        '<p class="field-hint"><a href="' + core.escapeHtml(g.videoUrl) + '" target="_blank" rel="noopener noreferrer">Open video in new tab</a></p>';
    } else if (g.status === "success" && !g.videoUrl) {
      body = '<p class="field-hint">Request succeeded, but no video URL was found at response path "' +
        core.escapeHtml(data.settings.responsePath) + '". Raw response:</p>' +
        '<pre class="video-raw-response">' + core.escapeHtml(truncate(g.rawResponse || "", 2000)) + '</pre>';
    } else if (g.status === "error") {
      body = '<p class="field-hint text-negative">' + core.escapeHtml(g.errorMessage || "Request failed.") + '</p>';
    } else {
      body = '<p class="field-hint">Generating…</p>';
    }
    return (
      '<div class="list-item-row"><div class="list-item-main">' +
        '<span class="list-item-title">' + core.escapeHtml(truncate(g.prompt, 140)) + '</span>' +
        '<span class="list-item-meta"><span class="badge ' + badgeClass + '">' + badgeText + '</span> · ' +
        core.escapeHtml(g.aspectRatio) + ' · ' + core.escapeHtml(String(g.duration)) + 's · ' + core.formatDateTime(g.createdAt) + '</span>' +
      '</div></div>' + body
    );
  }

  function renderLatestResult() {
    const container = document.getElementById("videoLatestResult");
    if (data.generations.length === 0) {
      container.innerHTML = '<div class="empty-state">No generations yet. Fill out the form above and connect an API to get started.</div>';
      return;
    }
    const latest = data.generations[0];
    container.innerHTML = generationResultHTML(latest);
  }

  function renderHistoryList() {
    const core = window.JarvisCore;
    const container = document.getElementById("videoHistoryList");
    if (data.generations.length === 0) {
      container.innerHTML = '<div class="empty-state">No generations yet.</div>';
      return;
    }
    container.innerHTML = data.generations.map(function (g) {
      const badgeClass = g.status === "success" ? "badge-green" : g.status === "error" ? "badge-red" : "badge-neutral";
      const badgeText = g.status === "success" ? "Completed" : g.status === "error" ? "Failed" : "Pending";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(g.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(truncate(g.prompt, 100)) + '</span>' +
              '<span class="list-item-meta"><span class="badge ' + badgeClass + '">' + badgeText + '</span> · ' + core.formatDateTime(g.createdAt) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger video-delete-btn" data-id="' + core.escapeHtml(g.id) + '" aria-label="Delete generation">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function render() {
    renderStats();
    renderConnectionHint();
    renderLatestResult();
    renderHistoryList();
  }

  /* ---------------- connection form ---------------- */

  function loadConnectionForm() {
    document.getElementById("videoEndpointUrl").value = data.settings.endpointUrl || "";
    document.getElementById("videoApiKey").value = data.settings.apiKey || "";
    document.getElementById("videoAuthHeader").value = data.settings.authHeader || "Authorization";
    document.getElementById("videoBodyTemplate").value = data.settings.bodyTemplate || DEFAULT_BODY_TEMPLATE;
    document.getElementById("videoResponsePath").value = data.settings.responsePath || "";
  }

  function handleConnectionSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    data.settings = {
      endpointUrl: document.getElementById("videoEndpointUrl").value.trim(),
      apiKey: document.getElementById("videoApiKey").value,
      authHeader: document.getElementById("videoAuthHeader").value.trim() || "Authorization",
      bodyTemplate: document.getElementById("videoBodyTemplate").value.trim() || DEFAULT_BODY_TEMPLATE,
      responsePath: document.getElementById("videoResponsePath").value.trim()
    };
    save();
    renderConnectionHint();
    core.showToast("Connection saved.");
  }

  function handleConnectionClear() {
    data.settings = defaultSettings();
    save();
    loadConnectionForm();
    renderConnectionHint();
    window.JarvisCore.showToast("Connection cleared.");
  }

  /* ---------------- generate form ---------------- */

  function handleGenerateSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const prompt = document.getElementById("videoPrompt").value.trim();
    const aspectRatio = document.getElementById("videoAspectRatio").value;
    const duration = Number(document.getElementById("videoDuration").value);

    if (!prompt) {
      core.showToast("Please enter a prompt.");
      return;
    }
    if (!core.isPositiveNumber(duration)) {
      core.showToast("Duration must be a positive number.");
      return;
    }
    if (!isConnected()) {
      core.showToast("Configure a connection in the Connection tab first.");
      return;
    }

    let bodyText;
    try {
      bodyText = fillBodyTemplate(data.settings.bodyTemplate, { prompt: prompt, aspectRatio: aspectRatio, duration: duration });
      JSON.parse(bodyText);
    } catch (err) {
      core.showToast("Request body template is not valid JSON once filled in.");
      return;
    }

    const record = {
      id: core.uid("video"),
      prompt: prompt,
      aspectRatio: aspectRatio,
      duration: duration,
      status: "pending",
      videoUrl: null,
      rawResponse: "",
      errorMessage: "",
      createdAt: Date.now()
    };
    data.generations.unshift(record);
    if (data.generations.length > MAX_HISTORY) data.generations.length = MAX_HISTORY;
    save();
    render();

    const generateBtn = document.getElementById("videoGenerateBtn");
    generateBtn.disabled = true;
    core.showToast("Sending request…");

    const headers = { "Content-Type": "application/json" };
    if (data.settings.apiKey) {
      headers[data.settings.authHeader] = "Bearer " + data.settings.apiKey;
    }

    fetch(data.settings.endpointUrl, { method: "POST", headers: headers, body: bodyText })
      .then(function (res) {
        return res.text().then(function (text) { return { ok: res.ok, status: res.status, text: text }; });
      })
      .then(function (result) {
        record.rawResponse = result.text;
        if (!result.ok) {
          record.status = "error";
          record.errorMessage = "HTTP " + result.status + (result.text ? ": " + truncate(result.text, 300) : "");
        } else {
          let json = null;
          try { json = JSON.parse(result.text); } catch (e) { json = null; }
          const videoUrl = json ? resolvePath(json, data.settings.responsePath) : undefined;
          record.status = "success";
          record.videoUrl = typeof videoUrl === "string" ? videoUrl : null;
        }
      })
      .catch(function (err) {
        record.status = "error";
        record.errorMessage = "Network/CORS error contacting the endpoint: " + (err && err.message ? err.message : String(err));
      })
      .finally(function () {
        save();
        render();
        generateBtn.disabled = false;
        core.showToast(record.status === "success" ? "Generation finished." : "Generation failed.");
      });
  }

  function handleHistoryListClick(e) {
    const delBtn = e.target.closest(".video-delete-btn");
    if (!delBtn) return;
    const id = delBtn.getAttribute("data-id");
    data.generations = data.generations.filter(function (g) { return g.id !== id; });
    save();
    render();
  }

  /* ---------------- summary (daily briefing) ---------------- */

  function getSummary() {
    const now = Date.now();
    const total = data.generations.length;
    const week = data.generations.filter(function (g) { return now - g.createdAt < WEEK_MS; }).length;
    const completed = data.generations.filter(function (g) { return g.status === "success"; }).length;
    return { total: total, week: week, completed: completed };
  }

  function init() {
    load();
    render();
    loadConnectionForm();
    document.getElementById("videoGenerateForm").addEventListener("submit", handleGenerateSubmit);
    document.getElementById("videoConnectionForm").addEventListener("submit", handleConnectionSubmit);
    document.getElementById("videoConnectionClearBtn").addEventListener("click", handleConnectionClear);
    document.getElementById("videoHistoryList").addEventListener("click", handleHistoryListClick);
  }

  window.JarvisVideo = { init: init, getSummary: getSummary };
})();
