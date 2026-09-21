/* ==========================================================================
   JARVIS — AI Video connections (shared by Studio and Clip Generator)
   localStorage key: jarvisVideoConnections -> [{ id, name, kind, endpointUrl,
     authHeader, apiKey, bodyTemplate, responseKind, responsePath }, ...]

   JARVIS doesn't bundle any AI provider. Every generation step (script,
   voiceover, images, video clips) is powered by an HTTP connection the user
   configures here: their own endpoint, their own API key, their own request
   body template. Kept as one shared module so Studio and Clip Generator
   don't each reinvent connection management.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisVideoConnections";

  const KINDS = [
    {
      key: "script",
      label: "Script generation (LLM)",
      whatToLookFor: "A text-generation / chat API — the kind offered by general-purpose AI chat providers.",
      placeholderHint: "Placeholders: {{topic}}, {{sceneCount}}. This is a generic starting shape, not any one provider's real request — open your provider's API reference and match their field names exactly (e.g. their docs might call this field \"messages\" or \"input\" instead of \"prompt\").",
      resultHint: "Dot-path to the generated script text in the JSON response — find the exact field name in your provider's example response (a common shape is something like choices.0.message.content, but this varies by provider).",
      defaultTemplate: '{\n  "prompt": "{{topic}}",\n  "scene_count": {{sceneCount}}\n}'
    },
    {
      key: "voiceover",
      label: "Voiceover (text-to-speech)",
      whatToLookFor: "A text-to-speech API — the kind offered by AI voice / narration providers.",
      placeholderHint: "Placeholder: {{text}}. This is a generic starting shape — match your provider's actual field names from their docs.",
      resultHint: "If your provider's response is JSON, give the dot-path to an audio URL or base64 string (e.g. data.0.url). If it returns the audio file directly (no JSON wrapper), switch \"Response type\" below to \"Raw file bytes\" instead.",
      defaultTemplate: '{\n  "text": "{{text}}",\n  "voice": "default"\n}'
    },
    {
      key: "image",
      label: "Image generation",
      whatToLookFor: "An image-generation API — the kind offered by AI image providers.",
      placeholderHint: "Placeholders: {{prompt}}, {{aspectRatio}}. This is a generic starting shape — match your provider's actual field names from their docs.",
      resultHint: "Dot-path to an image URL or base64 string in the response, e.g. data.0.url — the exact field name depends on your provider.",
      defaultTemplate: '{\n  "prompt": "{{prompt}}",\n  "aspect_ratio": "{{aspectRatio}}"\n}'
    },
    {
      key: "clipVideo",
      label: "Video clip generation",
      whatToLookFor: "A video-generation API. Heads up: most of these don't hand back a finished video right away — you submit a request and have to check back later for the result. This app only sends one request and reads one response, so it only works with a provider/plan that can return the finished video synchronously, in that single response. If your provider only offers the \"submit then poll\" style, this screen isn't able to drive it yet.",
      placeholderHint: "Placeholders: {{prompt}}, {{aspectRatio}}, {{duration}}, {{referenceVideo}}. This is a generic starting shape — match your provider's actual field names from their docs.",
      resultHint: "Dot-path to the generated video's URL in the response, e.g. video_url — the exact field name depends on your provider.",
      defaultTemplate: '{\n  "prompt": "{{prompt}}",\n  "aspect_ratio": "{{aspectRatio}}",\n  "duration": {{duration}}\n}',
      referenceVideoHint: "{{referenceVideo}} is base64 of an optional \"inspiration\" video attached on the Clip Generator screen — an empty string if none was attached. Only wire it into your template if your provider accepts a reference/style video (check its docs for the field name)."
    }
  ];

  let connections = [];

  function load() {
    const loaded = window.JarvisCore.loadJSON(LS_KEY, []);
    connections = Array.isArray(loaded) ? loaded : [];
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, connections);
  }

  function getAll() { return connections.slice(); }
  function getByKind(kind) { return connections.filter(function (c) { return c.kind === kind; }); }
  function getById(id) { return connections.find(function (c) { return c.id === id; }) || null; }
  function kindInfo(kind) { return KINDS.filter(function (k) { return k.key === kind; })[0] || null; }

  function render() {
    const container = document.getElementById("videoConnectionsGroups");
    if (!container) return;
    const core = window.JarvisCore;
    container.innerHTML = KINDS.map(function (k) {
      const list = getByKind(k.key);
      const rows = list.length === 0
        ? '<div class="empty-state">No connection configured yet.</div>'
        : list.map(function (c) {
            const hasEndpoint = c.endpointUrl && c.endpointUrl.trim();
            return (
              '<div class="list-item">' +
                '<div class="list-item-row">' +
                  '<div class="list-item-main">' +
                    '<span class="list-item-title">' + core.escapeHtml(c.name) + '</span>' +
                    '<span class="list-item-meta">' + (hasEndpoint ? core.escapeHtml(c.endpointUrl) : '<span class="text-negative">Not configured</span>') + '</span>' +
                  '</div>' +
                  '<div class="list-item-actions">' +
                    '<button type="button" class="btn-icon vc-edit-btn" data-id="' + core.escapeHtml(c.id) + '">Edit</button>' +
                  '</div>' +
                '</div>' +
              '</div>'
            );
          }).join("");
      return (
        '<div class="card">' +
          '<h2 class="card-title">' + core.escapeHtml(k.label) + '</h2>' +
          '<p class="field-hint">' + core.escapeHtml(k.whatToLookFor) + '</p>' +
          rows +
          '<div class="form-actions"><button type="button" class="btn btn-secondary vc-add-btn" data-kind="' + core.escapeHtml(k.key) + '">Add connection</button></div>' +
        '</div>'
      );
    }).join("");
  }

  function renderDropdownOptions(kind, selectedId) {
    const list = getByKind(kind);
    const core = window.JarvisCore;
    if (list.length === 0) return '<option value="">No connection configured</option>';
    return list.map(function (c) {
      const sel = c.id === selectedId ? ' selected' : '';
      return '<option value="' + core.escapeHtml(c.id) + '"' + sel + '>' + core.escapeHtml(c.name) + '</option>';
    }).join("");
  }

  function openModal(kind, existing) {
    const info = kindInfo(kind);
    document.getElementById("vcId").value = existing ? existing.id : "";
    document.getElementById("vcKind").value = kind;
    document.getElementById("videoConnectionModalTitle").textContent = existing ? "Edit connection" : "New " + info.label + " connection";
    document.getElementById("vcName").value = existing ? existing.name : info.label;
    document.getElementById("vcEndpoint").value = existing ? existing.endpointUrl : "";
    document.getElementById("vcAuthHeader").value = existing ? existing.authHeader : "Authorization";
    document.getElementById("vcApiKey").value = existing ? existing.apiKey : "";
    document.getElementById("vcAuthStyle").value = existing && existing.authStyle === "raw" ? "raw" : "bearer";
    document.getElementById("vcBodyTemplate").value = existing ? existing.bodyTemplate : info.defaultTemplate;
    document.getElementById("vcResponseKind").value = existing ? existing.responseKind : "json";
    document.getElementById("vcResponsePath").value = existing ? existing.responsePath : "";
    document.getElementById("vcPlaceholderHint").textContent = info.placeholderHint;
    document.getElementById("vcResponseHint").textContent = info.resultHint;
    const referenceVideoHint = document.getElementById("vcReferenceVideoHint");
    if (info.referenceVideoHint) {
      referenceVideoHint.textContent = info.referenceVideoHint;
      referenceVideoHint.classList.remove("hidden");
    } else {
      referenceVideoHint.classList.add("hidden");
    }
    document.getElementById("vcDeleteBtn").style.display = existing ? "" : "none";
    window.JarvisCore.openModal("videoConnectionModal");
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const id = document.getElementById("vcId").value || core.uid("conn");
    const kind = document.getElementById("vcKind").value;
    const record = {
      id: id,
      kind: kind,
      name: document.getElementById("vcName").value.trim() || kindInfo(kind).label,
      endpointUrl: document.getElementById("vcEndpoint").value.trim(),
      authHeader: document.getElementById("vcAuthHeader").value.trim() || "Authorization",
      apiKey: document.getElementById("vcApiKey").value,
      authStyle: document.getElementById("vcAuthStyle").value === "raw" ? "raw" : "bearer",
      bodyTemplate: document.getElementById("vcBodyTemplate").value.trim() || kindInfo(kind).defaultTemplate,
      responseKind: document.getElementById("vcResponseKind").value,
      responsePath: document.getElementById("vcResponsePath").value.trim()
    };
    const index = connections.findIndex(function (c) { return c.id === id; });
    if (index === -1) connections.push(record); else connections[index] = record;
    save();
    render();
    core.closeModal("videoConnectionModal");
    core.showToast("Connection saved.");
    document.dispatchEvent(new CustomEvent("jarvis-video-connections-changed"));
  }

  function handleDelete() {
    const id = document.getElementById("vcId").value;
    if (!id) return;
    connections = connections.filter(function (c) { return c.id !== id; });
    save();
    render();
    window.JarvisCore.closeModal("videoConnectionModal");
    window.JarvisCore.showToast("Connection deleted.");
    document.dispatchEvent(new CustomEvent("jarvis-video-connections-changed"));
  }

  function handleGroupsClick(e) {
    const addBtn = e.target.closest(".vc-add-btn");
    if (addBtn) {
      openModal(addBtn.getAttribute("data-kind"), null);
      return;
    }
    const editBtn = e.target.closest(".vc-edit-btn");
    if (editBtn) {
      const existing = getById(editBtn.getAttribute("data-id"));
      if (existing) openModal(existing.kind, existing);
    }
  }

  function init() {
    load();
    render();
    const groups = document.getElementById("videoConnectionsGroups");
    if (groups) groups.addEventListener("click", handleGroupsClick);
    const form = document.getElementById("videoConnectionForm");
    if (form) form.addEventListener("submit", handleFormSubmit);
    const cancelBtn = document.getElementById("vcCancelBtn");
    if (cancelBtn) cancelBtn.addEventListener("click", function () { window.JarvisCore.closeModal("videoConnectionModal"); });
    const deleteBtn = document.getElementById("vcDeleteBtn");
    if (deleteBtn) deleteBtn.addEventListener("click", handleDelete);
  }

  window.JarvisVideoConnections = {
    init: init,
    getAll: getAll,
    getByKind: getByKind,
    getById: getById,
    renderDropdownOptions: renderDropdownOptions,
    KINDS: KINDS
  };
})();
