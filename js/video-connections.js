/* ==========================================================================
   JARVIS — AI connections (shared by AI Video and Nutrition's recipe
   nutrition calculator)
   localStorage key: jarvisVideoConnections -> [{ id, name, kind, endpointUrl,
     authHeader, apiKey, authStyle, bodyTemplate, responseKind, responsePath,
     extraHeaders }, ...] — extraHeaders is a plain {name: value} object for
     the rare provider (Anthropic's Messages API included) that needs a
     second fixed header beyond the one auth header this form exposes.

   JARVIS doesn't bundle any AI provider. Every AI-powered step (script,
   voiceover, images, video clips, and now estimating a recipe's nutrition
   from its ingredient list) is powered by an HTTP connection the user
   configures here: their own endpoint, their own API key, their own request
   body template. Kept as one shared module (despite the "video" name, which
   predates the Nutrition use) so every feature that needs a BYO-AI
   connection reuses the same management UI and storage instead of
   reinventing it.
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
    },
    {
      key: "nutrition",
      label: "Nutrient calculation (LLM)",
      whatToLookFor: "A text-generation / chat API — the same kind of connection used above for Script generation. Used across Nutrition — the Food Log's \"Add Food\" form, Saved Foods, and Recipe ingredients — to estimate calories/protein/carbs/fat/fiber (and optionally sodium/calcium/iron/potassium/vitamin C/vitamin D) from a food's name and serving, instead of you looking each one up and doing the math yourself. These are AI estimates, not verified nutrition facts.",
      placeholderHint: "Placeholder: {{ingredientsText}} — a plain-text list of food item names and quantities, one per line (one line for a single Food Log or Saved Food entry, multiple lines for a recipe's ingredients). Your prompt MUST instruct the model to reply with ONLY a JSON array, one object per item in the same order, shaped like [{\"name\":\"...\",\"calories\":0,\"protein\":0,\"carbs\":0,\"fat\":0,\"fiber\":0}] — optionally with \"sodium\", \"calcium\", \"iron\", \"potassium\", \"vitaminC\", \"vitaminD\" too, which Jarvis will also use when present. Jarvis parses that JSON directly out of the model's reply, so any extra text around it (or a different shape) will make parsing fail. This is a generic starting shape, not any one provider's real request — match your provider's actual field names from their docs.",
      resultHint: "Dot-path to the model's text reply within the JSON response — e.g. content.0.text for Anthropic's Messages API, or choices.0.message.content for an OpenAI-compatible Chat Completions API.",
      defaultTemplate: '{\n  "prompt": "For each food item below, estimate calories, protein (g), carbohydrates (g), fat (g), and fiber (g) for the quantity given. If you can also reasonably estimate sodium (mg), calcium (mg), iron (mg), potassium (mg), vitamin C (mg), and vitamin D (mcg), include those fields too — otherwise omit them. These are estimates, not lab measurements. Respond with ONLY a JSON array, one object per item in the same order, shaped like [{\\"name\\":\\"...\\",\\"calories\\":0,\\"protein\\":0,\\"carbs\\":0,\\"fat\\":0,\\"fiber\\":0}]. No other text before or after the array.\\n\\nItems:\\n{{ingredientsText}}"\n}'
    }
  ];

  // One-click starting point for Claude (Anthropic) specifically, since its
  // Messages API needs a request shape and an extra fixed header this
  // form's generic defaults don't guess at. Still fully BYO — Jarvis never
  // stores or pays for the API key; the user pastes their own after this
  // fills in everything else. Haiku is the default model since nutrient
  // estimation is a small, frequent, structured task — swap the "model"
  // field in the body template for a different Claude model if preferred.
  const CLAUDE_PRESETS = {
    nutrition: {
      name: "Claude (Anthropic)",
      endpointUrl: "https://api.anthropic.com/v1/messages",
      authHeader: "x-api-key",
      authStyle: "raw",
      extraHeaders: { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      bodyTemplate: '{\n  "model": "claude-haiku-4-5-20251001",\n  "max_tokens": 2048,\n  "messages": [\n    {\n      "role": "user",\n      "content": "For each food item below, estimate calories, protein (g), carbohydrates (g), fat (g), and fiber (g) for the quantity given. If you can also reasonably estimate sodium (mg), calcium (mg), iron (mg), potassium (mg), vitamin C (mg), and vitamin D (mcg), include those fields too — otherwise omit them. These are estimates, not lab measurements. Respond with ONLY a JSON array, one object per item in the same order, shaped like [{\\"name\\":\\"...\\",\\"calories\\":0,\\"protein\\":0,\\"carbs\\":0,\\"fat\\":0,\\"fiber\\":0}]. No other text before or after the array.\\n\\nItems:\\n{{ingredientsText}}"\n    }\n  ]\n}',
      responsePath: "content.0.text"
    }
  };

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
      const claudeBtn = CLAUDE_PRESETS[k.key]
        ? '<button type="button" class="btn btn-secondary vc-use-claude-btn" data-kind="' + core.escapeHtml(k.key) + '">Use Claude</button>'
        : "";
      return (
        '<div class="card">' +
          '<h2 class="card-title">' + core.escapeHtml(k.label) + '</h2>' +
          '<p class="field-hint">' + core.escapeHtml(k.whatToLookFor) + '</p>' +
          rows +
          '<div class="form-actions">' +
            '<button type="button" class="btn btn-secondary vc-add-btn" data-kind="' + core.escapeHtml(k.key) + '">Add connection</button>' +
            claudeBtn +
          '</div>' +
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

  function openModal(kind, existing, preset) {
    const info = kindInfo(kind);
    document.getElementById("vcId").value = existing ? existing.id : "";
    document.getElementById("vcKind").value = kind;
    document.getElementById("videoConnectionModalTitle").textContent = existing ? "Edit connection" : "New " + info.label + " connection";
    document.getElementById("vcName").value = existing ? existing.name : (preset ? preset.name : info.label);
    document.getElementById("vcEndpoint").value = existing ? existing.endpointUrl : (preset ? preset.endpointUrl : "");
    document.getElementById("vcAuthHeader").value = existing ? existing.authHeader : (preset ? preset.authHeader : "Authorization");
    document.getElementById("vcApiKey").value = existing ? existing.apiKey : "";
    document.getElementById("vcAuthStyle").value = existing ? (existing.authStyle === "raw" ? "raw" : "bearer") : (preset && preset.authStyle === "raw" ? "raw" : "bearer");
    document.getElementById("vcBodyTemplate").value = existing ? existing.bodyTemplate : (preset ? preset.bodyTemplate : info.defaultTemplate);
    document.getElementById("vcExtraHeaders").value = existing && existing.extraHeaders ? JSON.stringify(existing.extraHeaders, null, 2) : (preset && preset.extraHeaders ? JSON.stringify(preset.extraHeaders, null, 2) : "");
    document.getElementById("vcResponseKind").value = existing ? existing.responseKind : "json";
    document.getElementById("vcResponsePath").value = existing ? existing.responsePath : (preset ? preset.responsePath : "");
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
    const extraHeadersRaw = document.getElementById("vcExtraHeaders").value.trim();
    let extraHeaders = {};
    if (extraHeadersRaw) {
      try {
        const parsed = JSON.parse(extraHeadersRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extraHeaders = parsed;
        else throw new Error("not an object");
      } catch (err) {
        core.showToast('Extra headers must be a JSON object like {"header-name": "value"} — not saved.');
        return;
      }
    }
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
      responsePath: document.getElementById("vcResponsePath").value.trim(),
      extraHeaders: extraHeaders
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
    const claudeBtn = e.target.closest(".vc-use-claude-btn");
    if (claudeBtn) {
      const kind = claudeBtn.getAttribute("data-kind");
      openModal(kind, null, CLAUDE_PRESETS[kind]);
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
