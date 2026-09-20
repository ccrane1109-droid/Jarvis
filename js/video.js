/* ==========================================================================
   JARVIS — AI Video: Clip Generator (single-shot text-to-video)
   localStorage key: jarvisVideo -> { generations: [...] }

   Calls a "Video clip generation" connection (managed in the Connections
   tab, see video-connections.js) with a prompt and expects the response to
   contain a URL to the finished video. Good for short B-roll clips; the
   full narrated/captioned pipeline lives in Studio (video-studio.js).
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisVideo";
  const MAX_HISTORY = 100;
  let data = { generations: [] };

  function load() {
    const loaded = window.JarvisCore.loadJSON(LS_KEY, { generations: [] });
    data = { generations: Array.isArray(loaded.generations) ? loaded.generations : [] };
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, data);
  }

  function truncate(str, n) {
    return str.length <= n ? str : str.slice(0, n) + "…";
  }

  /* ---------------- rendering ---------------- */

  function renderStats() {
    const total = data.generations.length;
    const now = Date.now();
    const week = data.generations.filter(function (g) { return now - g.createdAt < 7 * 24 * 60 * 60 * 1000; }).length;
    const completed = data.generations.filter(function (g) { return g.status === "success"; }).length;
    document.getElementById("videoStatTotal").textContent = String(total);
    document.getElementById("videoStatWeek").textContent = String(week);
    document.getElementById("videoStatSuccess").textContent = String(completed);
  }

  function renderConnectionSelect() {
    const select = document.getElementById("videoClipConnectionSelect");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = window.JarvisVideoConnections.renderDropdownOptions("clipVideo", previous);
    const hint = document.getElementById("videoConnectionStatusHint");
    if (hint) {
      const hasAny = window.JarvisVideoConnections.getByKind("clipVideo").length > 0;
      hint.textContent = hasAny ? "" : "No video clip connection configured — add one in the Connections tab.";
    }
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
      body = '<p class="field-hint">Request succeeded, but no video URL was found in the response. Check the connection\'s result field.</p>';
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
    container.innerHTML = generationResultHTML(data.generations[0]);
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
    renderConnectionSelect();
    renderLatestResult();
    renderHistoryList();
  }

  /* ---------------- generate form ---------------- */

  function handleGenerateSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const api = window.JarvisVideoApi;
    const prompt = document.getElementById("videoPrompt").value.trim();
    const aspectRatio = document.getElementById("videoAspectRatio").value;
    const duration = Number(document.getElementById("videoDuration").value);
    const connectionId = document.getElementById("videoClipConnectionSelect").value;
    const connection = window.JarvisVideoConnections.getById(connectionId);

    if (!prompt) { core.showToast("Please enter a prompt."); return; }
    if (!core.isPositiveNumber(duration)) { core.showToast("Duration must be a positive number."); return; }
    if (!connection) { core.showToast("Add and select a video clip connection in the Connections tab first."); return; }

    const record = {
      id: core.uid("video"),
      prompt: prompt,
      aspectRatio: aspectRatio,
      duration: duration,
      status: "pending",
      videoUrl: null,
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

    const body = api.fillJsonTemplate(connection.bodyTemplate, { prompt: prompt, aspectRatio: aspectRatio, duration: duration });
    api.postRequest(connection, body, false).then(function (result) {
      if (!result.ok) {
        record.status = "error";
        record.errorMessage = result.errorMessage || "Request failed.";
      } else {
        let json = null;
        try { json = JSON.parse(result.bodyText); } catch (e) { json = null; }
        const videoUrl = json ? api.resolveJsonPath(json, connection.responsePath) : undefined;
        record.status = "success";
        record.videoUrl = typeof videoUrl === "string" ? videoUrl : null;
      }
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

  function getSummary() {
    const now = Date.now();
    const total = data.generations.length;
    const week = data.generations.filter(function (g) { return now - g.createdAt < 7 * 24 * 60 * 60 * 1000; }).length;
    const completed = data.generations.filter(function (g) { return g.status === "success"; }).length;
    return { total: total, week: week, completed: completed };
  }

  function init() {
    load();
    render();
    document.getElementById("videoGenerateForm").addEventListener("submit", handleGenerateSubmit);
    document.getElementById("videoHistoryList").addEventListener("click", handleHistoryListClick);
    document.addEventListener("jarvis-video-connections-changed", renderConnectionSelect);
  }

  window.JarvisVideo = { init: init, getSummary: getSummary };
})();
