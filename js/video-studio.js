/* ==========================================================================
   JARVIS — AI Video: Studio
   localStorage key: jarvisVideoStudio -> { projects: [...] }
   Binary assets (voiceover audio, images/video, exported renders) live in
   IndexedDB via blobstore.js; projects here only store metadata + blob ids.

   Turns a topic into a full narrated, captioned video: Script -> Voiceover
   -> Visuals -> Captions -> Music -> Export. Every generation step calls a
   user-configured connection (video-connections.js); actual video assembly
   happens on-device via ffmpeg.wasm, loaded lazily on first render.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisVideoStudio";
  const FFMPEG_MAIN_URL = "js/vendor/ffmpeg/ffmpeg.js";
  const FFMPEG_CORE_BASE = "js/vendor/ffmpeg";
  const RESOLUTIONS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };

  let data = { projects: [] };
  let activeProjectId = null;
  let ffmpegInstance = null;
  let ffmpegLoadPromise = null;
  const objectUrlRegistry = [];

  /* ---------------- persistence ---------------- */

  function load() {
    const loaded = window.JarvisCore.loadJSON(LS_KEY, { projects: [] });
    data = { projects: Array.isArray(loaded.projects) ? loaded.projects : [] };
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, data);
  }

  function getProject(id) {
    return data.projects.find(function (p) { return p.id === id; }) || null;
  }

  function persistProject(project) {
    project.updatedAt = Date.now();
    const index = data.projects.findIndex(function (p) { return p.id === project.id; });
    if (index === -1) data.projects.unshift(project); else data.projects[index] = project;
    save();
  }

  function getScene(project, sceneId) {
    return project.scenes.find(function (s) { return s.id === sceneId; }) || null;
  }

  function sceneDurationSeconds(scene) {
    if (scene.voiceoverDurationSeconds && scene.voiceoverDurationSeconds > 0) return scene.voiceoverDurationSeconds;
    if (scene.captions && scene.captions.length) {
      const lastEnd = scene.captions[scene.captions.length - 1].endMs / 1000;
      if (lastEnd > 0) return lastEnd;
    }
    const trimmed = (scene.text || "").trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    const estimate = wordCount / 2.5;
    return estimate < 3 ? 3 : estimate;
  }

  function projectTotalDuration(project) {
    return project.scenes.reduce(function (sum, s) { return sum + sceneDurationSeconds(s); }, 0);
  }

  /* ---------------- script splitting ---------------- */

  function splitScriptIntoScenes(rawText, targetSceneCount) {
    const text = (rawText || "").trim();
    if (!text) return [];
    const target = targetSceneCount < 1 ? 1 : targetSceneCount;

    const byBlankLine = text.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (byBlankLine.length > 1) return stripSceneMarkers(byBlankLine);

    const sceneMarker = /^\s*(scene\s*\d+[:.\-]?|\d+[.)])\s*/i;
    const lines = text.split("\n");
    const markedChunks = [];
    let buffer = [];
    lines.forEach(function (line) {
      if (sceneMarker.test(line)) {
        if (buffer.join("\n").trim()) { markedChunks.push(buffer.join("\n").trim()); buffer = []; }
        buffer.push(line.replace(sceneMarker, ""));
      } else {
        buffer.push(line);
      }
    });
    if (buffer.join("\n").trim()) markedChunks.push(buffer.join("\n").trim());
    if (markedChunks.length > 1) return markedChunks;

    const sentences = text.split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (sentences.length === 0) return [text];
    if (sentences.length <= target) return sentences;
    const perScene = Math.ceil(sentences.length / target);
    const result = [];
    for (let i = 0; i < sentences.length; i += perScene) {
      result.push(sentences.slice(i, i + perScene).join(" "));
    }
    return result;
  }

  function stripSceneMarkers(chunks) {
    const marker = /^\s*(scene\s*\d+[:.\-]?)\s*/i;
    return chunks.map(function (c) { return c.replace(marker, "").trim(); });
  }

  /* ---------------- captions ---------------- */

  function buildCaptionsForScene(text, totalDurationMs, maxWordsPerLine) {
    maxWordsPerLine = maxWordsPerLine || 7;
    const words = (text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || totalDurationMs <= 0) return [];
    const chunks = [];
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      chunks.push(words.slice(i, i + maxWordsPerLine).join(" "));
    }
    const totalChars = chunks.reduce(function (sum, c) { return sum + c.length; }, 0);
    if (totalChars === 0) return [];
    const lines = [];
    let elapsed = 0;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const share = isLast ? totalDurationMs - elapsed : Math.round((chunks[i].length / totalChars) * totalDurationMs);
      lines.push({ id: window.JarvisCore.uid("cap"), startMs: elapsed, endMs: elapsed + share, text: chunks[i] });
      elapsed += share;
    }
    return lines;
  }

  /* ---------------- media synthesis helpers ---------------- */

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(function (blob) { resolve(blob); }, "image/png"); });
  }

  function buildPlaceholderImageBlob(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    return canvasToBlob(canvas);
  }

  function buildCaptionImageBlob(width, height, text) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const fontSize = Math.round(height * 0.045);
    ctx.font = "bold " + fontSize + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = width / 2;
    const maxWidth = width * 0.86;
    const words = (text || "").split(" ");
    const lines = [];
    let current = "";
    words.forEach(function (w) {
      const test = current ? current + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && current) { lines.push(current); current = w; } else { current = test; }
    });
    if (current) lines.push(current);
    const baseY = height * 0.86;
    const startY = baseY - (lines.length - 1) * fontSize * 0.625;
    lines.forEach(function (line, i) {
      const ly = startY + i * fontSize * 1.25;
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(line, x, ly);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(line, x, ly);
    });
    return canvasToBlob(canvas);
  }

  function buildSilentWavBlob(durationSeconds) {
    const sampleRate = 44100;
    const numChannels = 1;
    const bytesPerSample = 2;
    const numSamples = Math.max(1, Math.round(durationSeconds * sampleRate));
    const dataSize = numSamples * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeString(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    return new Blob([buffer], { type: "audio/wav" });
  }

  function probeAudioDuration(blob) {
    return blob.arrayBuffer().then(function (buf) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      return ctx.decodeAudioData(buf).then(function (audioBuffer) {
        const duration = audioBuffer.duration;
        ctx.close();
        return duration;
      }).catch(function () { ctx.close(); return null; });
    });
  }

  function extensionFromName(name, fallback) {
    if (!name) return fallback;
    const m = /\.([a-zA-Z0-9]+)$/.exec(name);
    return m ? m[1].toLowerCase() : fallback;
  }

  function trackObjectUrl(url) { objectUrlRegistry.push(url); return url; }
  function revokeTrackedObjectUrls() {
    while (objectUrlRegistry.length) URL.revokeObjectURL(objectUrlRegistry.pop());
  }

  /* ---------------- ffmpeg.wasm loading ---------------- */

  function loadScriptTag(src) {
    return new Promise(function (resolve, reject) {
      const el = document.createElement("script");
      el.src = src;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(el);
    });
  }

  // @ffmpeg/util's prebuilt UMD bundle references a bare `exports` global
  // that only exists under a bundler, so it throws when loaded via a plain
  // <script> tag. The only helper actually needed from it is this one.
  function toBlobURL(url, mimeType) {
    return fetch(url).then(function (res) { return res.blob(); }).then(function (blob) {
      return URL.createObjectURL(new Blob([blob], { type: mimeType }));
    });
  }

  function getFfmpeg(onStatus) {
    if (ffmpegInstance) return Promise.resolve(ffmpegInstance);
    if (ffmpegLoadPromise) return ffmpegLoadPromise;
    onStatus("Downloading video engine (first time only)…");
    ffmpegLoadPromise = loadScriptTag(FFMPEG_MAIN_URL)
      .then(function () {
        const ffmpeg = new window.FFmpegWASM.FFmpeg();
        return Promise.all([
          toBlobURL(FFMPEG_CORE_BASE + "/ffmpeg-core.js", "text/javascript"),
          toBlobURL(FFMPEG_CORE_BASE + "/ffmpeg-core.wasm", "application/wasm")
        ]).then(function (urls) {
          return ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1] });
        }).then(function () { ffmpegInstance = ffmpeg; return ffmpeg; });
      });
    return ffmpegLoadPromise;
  }

  /* ---------------- rendering pipeline ---------------- */

  function renderScene(ffmpeg, scene, width, height, index) {
    const outputName = "scene_" + String(index).padStart(3, "0") + ".mp4";
    const isVideo = !!scene.visualBlobId && scene.visualType === "video";

    const visualBlobPromise = scene.visualBlobId
      ? window.JarvisBlobStore.getBlob(scene.visualBlobId)
      : buildPlaceholderImageBlob(width, height);

    const durationSeconds = sceneDurationSeconds(scene);
    const audioBlobPromise = scene.voiceoverBlobId
      ? window.JarvisBlobStore.getBlob(scene.voiceoverBlobId)
      : Promise.resolve(buildSilentWavBlob(durationSeconds));

    const captions = scene.captions || [];

    return Promise.all([visualBlobPromise, audioBlobPromise]).then(function (results) {
      const visualBlob = results[0];
      const audioBlob = results[1];
      const visualExt = isVideo ? extensionFromName(scene.visualFileName, "mp4") : "png";
      const visualName = "visual_" + index + "." + visualExt;
      const audioExt = scene.voiceoverBlobId ? extensionFromName(scene.voiceoverFileName, "mp3") : "wav";
      const audioName = "audio_" + index + "." + audioExt;

      return Promise.all([visualBlob.arrayBuffer(), audioBlob.arrayBuffer()]).then(function (buffers) {
        return ffmpeg.writeFile(visualName, new Uint8Array(buffers[0]))
          .then(function () { return ffmpeg.writeFile(audioName, new Uint8Array(buffers[1])); })
          .then(function () {
            return Promise.all(captions.map(function (cap, i) {
              return buildCaptionImageBlob(width, height, cap.text).then(function (blob) {
                return blob.arrayBuffer();
              }).then(function (buf) {
                const name = "cap_" + index + "_" + i + ".png";
                return ffmpeg.writeFile(name, new Uint8Array(buf)).then(function () { return name; });
              });
            }));
          })
          .then(function (captionNames) {
            const durationStr = durationSeconds.toFixed(2);
            const inputs = [];
            if (isVideo) inputs.push("-stream_loop", "-1", "-i", visualName);
            else inputs.push("-loop", "1", "-i", visualName);
            inputs.push("-i", audioName);
            captionNames.forEach(function (name) { inputs.push("-i", name); });

            let filterComplex = "[0:v]scale=" + width + ":" + height +
              ":force_original_aspect_ratio=decrease,pad=" + width + ":" + height +
              ":(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[base]";
            let lastLabel = "base";
            captionNames.forEach(function (name, i) {
              const cap = captions[i];
              const start = (cap.startMs / 1000).toFixed(2);
              const end = (cap.endMs / 1000).toFixed(2);
              const inputIndex = 2 + i;
              const outLabel = "v" + i;
              filterComplex += ";[" + lastLabel + "][" + inputIndex + ":v] overlay=0:0:enable='between(t," + start + "," + end + ")'[" + outLabel + "]";
              lastLabel = outLabel;
            });

            const args = ["-y"].concat(inputs).concat([
              "-filter_complex", filterComplex,
              "-map", "[" + lastLabel + "]",
              "-map", "1:a",
              "-t", durationStr,
              "-r", "30",
              "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
              outputName
            ]);
            return ffmpeg.exec(args);
          });
      });
    }).then(function () { return outputName; });
  }

  function renderProjectVideo(project, onStatus) {
    return getFfmpeg(onStatus).then(function (ffmpeg) {
      const res = RESOLUTIONS[project.aspectRatio] || RESOLUTIONS["9:16"];
      const width = res[0], height = res[1];
      const segmentNames = [];
      let chain = Promise.resolve();
      project.scenes.forEach(function (scene, index) {
        chain = chain.then(function () {
          onStatus("Rendering scene " + (index + 1) + " of " + project.scenes.length + "…");
          return renderScene(ffmpeg, scene, width, height, index).then(function (name) { segmentNames.push(name); });
        });
      });
      return chain.then(function () {
        onStatus("Combining scenes…");
        const listContent = segmentNames.map(function (n) { return "file '" + n + "'"; }).join("\n");
        return ffmpeg.writeFile("concat_list.txt", listContent)
          .then(function () { return ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat_list.txt", "-c", "copy", "concatenated.mp4"]); });
      }).then(function () {
        if (!project.musicBlobId) return "concatenated.mp4";
        onStatus("Mixing background music…");
        return window.JarvisBlobStore.getBlob(project.musicBlobId).then(function (musicBlob) {
          return musicBlob.arrayBuffer();
        }).then(function (buf) {
          const musicExt = extensionFromName(project.musicFileName, "mp3");
          return ffmpeg.writeFile("music_input." + musicExt, new Uint8Array(buf)).then(function () { return musicExt; });
        }).then(function (musicExt) {
          const vol = project.musicVolume === undefined ? 0.25 : project.musicVolume;
          return ffmpeg.exec([
            "-i", "concatenated.mp4", "-stream_loop", "-1", "-i", "music_input." + musicExt,
            "-filter_complex", "[1:a]volume=" + vol + "[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]",
            "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", "with_music.mp4"
          ]);
        }).then(function () { return "with_music.mp4"; });
      }).then(function (finalName) {
        onStatus("Finishing…");
        return ffmpeg.readFile(finalName);
      }).then(function (fileData) {
        return new Blob([fileData.buffer], { type: "video/mp4" });
      });
    });
  }

  /* ---------------- view switching ---------------- */

  function showListView() {
    document.getElementById("studioProjectList").classList.remove("hidden");
    document.getElementById("studioProjectEditor").classList.add("hidden");
    activeProjectId = null;
    revokeTrackedObjectUrls();
    renderProjectList();
  }

  function showEditorView(projectId) {
    activeProjectId = projectId;
    document.getElementById("studioProjectList").classList.add("hidden");
    document.getElementById("studioProjectEditor").classList.remove("hidden");
    renderEditor();
  }

  /* ---------------- project list ---------------- */

  function renderProjectList() {
    const core = window.JarvisCore;
    const container = document.getElementById("studioProjectItems");
    if (data.projects.length === 0) {
      container.innerHTML = '<div class="empty-state">No projects yet. Create one to get started.</div>';
      return;
    }
    container.innerHTML = data.projects.map(function (p) {
      const badgeClass = p.status === "exported" ? "badge-green" : p.status === "failed" ? "badge-red" : p.status === "rendering" ? "badge-yellow" : "badge-neutral";
      const badgeText = p.status === "exported" ? "Exported" : p.status === "failed" ? "Failed" : p.status === "rendering" ? "Rendering" : "Draft";
      return (
        '<div class="list-item studio-project-item" data-project-id="' + core.escapeHtml(p.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(p.title) + '</span>' +
              '<span class="list-item-meta"><span class="badge ' + badgeClass + '">' + badgeText + '</span> · ' +
              p.scenes.length + ' scene' + (p.scenes.length === 1 ? '' : 's') + ' · ' + Math.round(projectTotalDuration(p)) + 's</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger studio-delete-project-btn" data-project-id="' + core.escapeHtml(p.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleProjectListClick(e) {
    const deleteBtn = e.target.closest(".studio-delete-project-btn");
    if (deleteBtn) {
      data.projects = data.projects.filter(function (p) { return p.id !== deleteBtn.getAttribute("data-project-id"); });
      save();
      renderProjectList();
      return;
    }
    const item = e.target.closest(".studio-project-item");
    if (item) showEditorView(item.getAttribute("data-project-id"));
  }

  function handleNewProjectSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const title = document.getElementById("studioNewProjectTitle").value.trim() || "Untitled video";
    const topic = document.getElementById("studioNewProjectTopic").value.trim();
    const now = Date.now();
    const project = {
      id: core.uid("proj"), title: title, topic: topic, createdAt: now, updatedAt: now,
      aspectRatio: "9:16", musicBlobId: null, musicFileName: null, musicVolume: 0.25,
      exportedBlobId: null, exportedFileName: null, status: "draft", scenes: []
    };
    data.projects.unshift(project);
    save();
    e.target.reset();
    core.closeModal("studioNewProjectModal");
    showEditorView(project.id);
  }

  /* ---------------- editor: script card ---------------- */

  function renderScriptCard(project) {
    const core = window.JarvisCore;
    const container = document.getElementById("studioScriptCard");
    if (project.scenes.length === 0) {
      container.innerHTML =
        '<h2 class="card-title">Script</h2>' +
        '<div class="form-row"><label for="studioTopicInput">Video topic</label>' +
        '<textarea id="studioTopicInput" rows="3" placeholder="e.g. 5 productivity habits for remote workers">' + core.escapeHtml(project.topic) + '</textarea></div>' +
        '<div class="form-row two-col">' +
          '<div><label for="studioSceneCountInput">Target scenes: <span id="studioSceneCountLabel">5</span></label>' +
          '<input type="range" id="studioSceneCountInput" min="2" max="12" value="5"></div>' +
          '<div><label for="studioScriptConnectionSelect">Script connection</label>' +
          '<select id="studioScriptConnectionSelect">' + window.JarvisVideoConnections.renderDropdownOptions("script") + '</select></div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-primary" id="studioGenerateScriptBtn">Generate Script</button>' +
          '<button type="button" class="btn btn-secondary" id="studioWriteManuallyBtn">Write scenes manually</button>' +
        '</div>';
      return;
    }
    container.innerHTML =
      '<h2 class="card-title">Script</h2>' +
      project.scenes.map(function (scene, i) {
        return (
          '<div class="list-item" data-scene-id="' + core.escapeHtml(scene.id) + '">' +
            '<div class="list-item-row"><div class="list-item-main"><strong>Scene ' + (i + 1) + '</strong></div>' +
              '<div class="list-item-actions">' +
                '<button type="button" class="btn-icon studio-scene-up-btn" data-scene-id="' + core.escapeHtml(scene.id) + '"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
                '<button type="button" class="btn-icon studio-scene-down-btn" data-scene-id="' + core.escapeHtml(scene.id) + '"' + (i === project.scenes.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
                '<button type="button" class="btn-icon danger studio-scene-delete-btn" data-scene-id="' + core.escapeHtml(scene.id) + '">Delete</button>' +
              '</div>' +
            '</div>' +
            '<textarea class="studio-scene-text" data-scene-id="' + core.escapeHtml(scene.id) + '" rows="3">' + core.escapeHtml(scene.text) + '</textarea>' +
          '</div>'
        );
      }).join("") +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" id="studioAddSceneBtn">Add scene</button>' +
        '<button type="button" class="btn-icon danger" id="studioRestartScriptBtn">Start over</button>' +
      '</div>';
  }

  function handleGenerateScript() {
    const project = getProject(activeProjectId);
    const core = window.JarvisCore;
    const topic = document.getElementById("studioTopicInput").value.trim();
    const sceneCount = Number(document.getElementById("studioSceneCountInput").value);
    const connectionId = document.getElementById("studioScriptConnectionSelect").value;
    const connection = window.JarvisVideoConnections.getById(connectionId);
    if (!topic) { core.showToast("Enter a topic first."); return; }
    if (!connection) { core.showToast("Add and select a script connection first."); return; }

    const api = window.JarvisVideoApi;
    const body = api.fillJsonTemplate(connection.bodyTemplate, { topic: topic, sceneCount: sceneCount });
    core.showToast("Generating script…");
    api.postRequest(connection, body, false).then(function (result) {
      if (!result.ok) { core.showToast(result.errorMessage || "Script generation failed."); return; }
      let json = null;
      try { json = JSON.parse(result.bodyText); } catch (e) { json = null; }
      const text = json ? api.resolveJsonPath(json, connection.responsePath) : undefined;
      if (typeof text !== "string" || !text.trim()) {
        core.showToast('No script text found at "' + connection.responsePath + '". Check the connection settings.');
        return;
      }
      const sceneTexts = splitScriptIntoScenes(text, sceneCount);
      project.topic = topic;
      project.title = project.title === "Untitled video" ? topic.slice(0, 60) : project.title;
      project.scenes = sceneTexts.map(function (t) { return { id: core.uid("scene"), text: t, captions: [] }; });
      persistProject(project);
      renderEditor();
      core.showToast("Script generated.");
    });
  }

  function handleScriptCardClick(e) {
    const project = getProject(activeProjectId);
    if (e.target.id === "studioGenerateScriptBtn") { handleGenerateScript(); return; }
    if (e.target.id === "studioWriteManuallyBtn") {
      project.scenes = [{ id: window.JarvisCore.uid("scene"), text: "", captions: [] }];
      persistProject(project);
      renderEditor();
      return;
    }
    if (e.target.id === "studioAddSceneBtn") {
      project.scenes.push({ id: window.JarvisCore.uid("scene"), text: "", captions: [] });
      persistProject(project);
      renderEditor();
      return;
    }
    if (e.target.id === "studioRestartScriptBtn") {
      project.scenes = [];
      persistProject(project);
      renderEditor();
      return;
    }
    const upBtn = e.target.closest(".studio-scene-up-btn");
    const downBtn = e.target.closest(".studio-scene-down-btn");
    const delBtn = e.target.closest(".studio-scene-delete-btn");
    if (upBtn || downBtn) {
      const id = (upBtn || downBtn).getAttribute("data-scene-id");
      const idx = project.scenes.findIndex(function (s) { return s.id === id; });
      const swapWith = upBtn ? idx - 1 : idx + 1;
      if (swapWith >= 0 && swapWith < project.scenes.length) {
        const tmp = project.scenes[idx];
        project.scenes[idx] = project.scenes[swapWith];
        project.scenes[swapWith] = tmp;
        persistProject(project);
        renderEditor();
      }
      return;
    }
    if (delBtn) {
      const id = delBtn.getAttribute("data-scene-id");
      project.scenes = project.scenes.filter(function (s) { return s.id !== id; });
      persistProject(project);
      renderEditor();
    }
  }

  function handleScriptCardChange(e) {
    if (e.target.id === "studioSceneCountInput") {
      document.getElementById("studioSceneCountLabel").textContent = e.target.value;
      return;
    }
    if (e.target.classList.contains("studio-scene-text")) {
      const project = getProject(activeProjectId);
      const scene = getScene(project, e.target.getAttribute("data-scene-id"));
      if (scene) { scene.text = e.target.value; persistProject(project); }
    }
  }

  /* ---------------- editor: voiceover card ---------------- */

  function renderVoiceoverCard(project) {
    const core = window.JarvisCore;
    const container = document.getElementById("studioVoiceoverCard");
    if (project.scenes.length === 0) {
      container.innerHTML = '<h2 class="card-title">Voiceover</h2><p class="field-hint">Write a script first.</p>';
      return;
    }
    container.innerHTML =
      '<h2 class="card-title">Voiceover</h2>' +
      '<div class="form-row"><label for="studioVoiceoverConnectionSelect">Voiceover connection</label>' +
      '<select id="studioVoiceoverConnectionSelect">' + window.JarvisVideoConnections.renderDropdownOptions("voiceover") + '</select></div>' +
      project.scenes.map(function (scene, i) {
        const durationText = scene.voiceoverDurationSeconds ? scene.voiceoverDurationSeconds.toFixed(1) + 's' : '';
        return (
          '<div class="list-item" data-scene-id="' + core.escapeHtml(scene.id) + '">' +
            '<div class="list-item-row">' +
              '<div class="list-item-main">' +
                '<span class="list-item-title">Scene ' + (i + 1) + '</span>' +
                '<span class="list-item-meta">' + core.escapeHtml(scene.text.slice(0, 80)) + (scene.text.length > 80 ? '…' : '') + (durationText ? ' · ' + durationText : '') + '</span>' +
              '</div>' +
              '<div class="list-item-actions">' +
                (scene.voiceoverBlobId ? '<audio class="studio-voiceover-audio" data-scene-id="' + core.escapeHtml(scene.id) + '" controls style="height:32px;max-width:160px;"></audio>' : '') +
                '<button type="button" class="btn-icon studio-generate-voiceover-btn" data-scene-id="' + core.escapeHtml(scene.id) + '">Generate</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join("");
    hydrateVoiceoverAudioElements(project);
  }

  function hydrateVoiceoverAudioElements(project) {
    const elements = document.querySelectorAll("#studioVoiceoverCard .studio-voiceover-audio");
    elements.forEach(function (el) {
      const scene = getScene(project, el.getAttribute("data-scene-id"));
      if (!scene || !scene.voiceoverBlobId) return;
      window.JarvisBlobStore.getBlob(scene.voiceoverBlobId).then(function (blob) {
        if (!blob) return;
        el.src = trackObjectUrl(URL.createObjectURL(blob));
      });
    });
  }

  function handleGenerateVoiceover(sceneId) {
    const project = getProject(activeProjectId);
    const scene = getScene(project, sceneId);
    const core = window.JarvisCore;
    const connectionId = document.getElementById("studioVoiceoverConnectionSelect").value;
    const connection = window.JarvisVideoConnections.getById(connectionId);
    if (!connection) { core.showToast("Add and select a voiceover connection first."); return; }
    if (!scene.text.trim()) { core.showToast("This scene has no narration text yet."); return; }

    const api = window.JarvisVideoApi;
    const body = api.fillJsonTemplate(connection.bodyTemplate, { text: scene.text });
    const expectBinary = connection.responseKind === "binary";
    core.showToast("Generating voiceover…");
    api.postRequest(connection, body, expectBinary).then(function (result) {
      if (!result.ok) { core.showToast(result.errorMessage || "Voiceover generation failed."); return; }
      let bytesPromise;
      let contentType = result.contentType || "";
      if (expectBinary) {
        bytesPromise = Promise.resolve(result.bodyBytes);
      } else {
        let json = null;
        try { json = JSON.parse(result.bodyText); } catch (e) { json = null; }
        const value = json ? api.resolveJsonPath(json, connection.responsePath) : undefined;
        if (typeof value === "string" && value.indexOf("http") === 0) {
          bytesPromise = api.getBytes(value).then(function (r) {
            if (!r.ok) throw new Error(r.errorMessage || "Could not download voiceover audio.");
            contentType = r.contentType || contentType;
            return r.bodyBytes;
          });
        } else if (typeof value === "string" && value) {
          if (value.indexOf("data:") === 0) contentType = value.slice(5, value.indexOf(";")) || contentType;
          const bytes = api.decodeBase64ToBytes(value);
          bytesPromise = bytes ? Promise.resolve(bytes.buffer) : Promise.reject(new Error("Could not decode audio data."));
        } else {
          bytesPromise = Promise.reject(new Error("No audio data found in the response. Check the connection settings."));
        }
      }
      return bytesPromise.then(function (buffer) {
        const blob = new Blob([buffer], { type: "audio/mpeg" });
        const blobId = core.uid("voiceover");
        return window.JarvisBlobStore.putBlob(blobId, blob).then(function () {
          return probeAudioDuration(blob).then(function (duration) {
            scene.voiceoverBlobId = blobId;
            scene.voiceoverFileName = "voiceover." + api.guessAudioExtension(contentType);
            scene.voiceoverDurationSeconds = duration || null;
            persistProject(project);
            renderVoiceoverCard(project);
            renderCaptionsCard(project);
            renderExportCard(project);
            core.showToast("Voiceover generated.");
          });
        });
      });
    }).catch(function (err) {
      core.showToast(err && err.message ? err.message : "Voiceover generation failed.");
    });
  }

  function handleVoiceoverCardClick(e) {
    const btn = e.target.closest(".studio-generate-voiceover-btn");
    if (btn) handleGenerateVoiceover(btn.getAttribute("data-scene-id"));
  }

  /* ---------------- editor: visuals card ---------------- */

  function renderVisualsCard(project) {
    const core = window.JarvisCore;
    const container = document.getElementById("studioVisualsCard");
    if (project.scenes.length === 0) {
      container.innerHTML = '<h2 class="card-title">Visuals</h2><p class="field-hint">Write a script first.</p>';
      return;
    }
    container.innerHTML =
      '<h2 class="card-title">Visuals</h2>' +
      '<div class="form-row"><label for="studioImageConnectionSelect">Image generation connection (optional)</label>' +
      '<select id="studioImageConnectionSelect">' + window.JarvisVideoConnections.renderDropdownOptions("image") + '</select></div>' +
      project.scenes.map(function (scene, i) {
        return (
          '<div class="list-item" data-scene-id="' + core.escapeHtml(scene.id) + '">' +
            '<div class="list-item-main" style="margin-bottom:8px;"><span class="list-item-title">Scene ' + (i + 1) + '</span></div>' +
            '<div class="studio-visual-thumb" data-scene-id="' + core.escapeHtml(scene.id) + '" style="height:90px;border-radius:8px;background:var(--card-hover);display:flex;align-items:center;justify-content:center;color:var(--text-faint);overflow:hidden;">' +
              (scene.visualBlobId ? '' : 'No visual set') +
            '</div>' +
            '<div class="form-actions" style="margin-top:8px;">' +
              '<label class="btn btn-secondary" style="cursor:pointer;">Pick image<input type="file" accept="image/*" class="studio-pick-image-input hidden" data-scene-id="' + core.escapeHtml(scene.id) + '"></label>' +
              '<label class="btn btn-secondary" style="cursor:pointer;">Pick video<input type="file" accept="video/*" class="studio-pick-video-input hidden" data-scene-id="' + core.escapeHtml(scene.id) + '"></label>' +
              '<button type="button" class="btn btn-secondary studio-generate-image-btn" data-scene-id="' + core.escapeHtml(scene.id) + '">Generate image</button>' +
              (scene.visualBlobId ? '<button type="button" class="btn-icon danger studio-clear-visual-btn" data-scene-id="' + core.escapeHtml(scene.id) + '">Clear</button>' : '') +
            '</div>' +
          '</div>'
        );
      }).join("");
    hydrateVisualThumbnails(project);
  }

  function hydrateVisualThumbnails(project) {
    const elements = document.querySelectorAll("#studioVisualsCard .studio-visual-thumb");
    elements.forEach(function (el) {
      const scene = getScene(project, el.getAttribute("data-scene-id"));
      if (!scene || !scene.visualBlobId) return;
      window.JarvisBlobStore.getBlob(scene.visualBlobId).then(function (blob) {
        if (!blob) return;
        const url = trackObjectUrl(URL.createObjectURL(blob));
        if (scene.visualType === "video") {
          el.innerHTML = '<video src="' + url + '" style="max-height:100%;max-width:100%;" muted></video>';
        } else {
          el.innerHTML = '<img src="' + url + '" style="max-height:100%;max-width:100%;object-fit:cover;">';
        }
      });
    });
  }

  function storeSceneVisualFile(scene, project, file, type) {
    const core = window.JarvisCore;
    const blobId = core.uid("visual");
    return window.JarvisBlobStore.putBlob(blobId, file).then(function () {
      scene.visualBlobId = blobId;
      scene.visualFileName = file.name;
      scene.visualType = type;
      persistProject(project);
      renderVisualsCard(project);
    });
  }

  function handleGenerateImage(sceneId) {
    const project = getProject(activeProjectId);
    const scene = getScene(project, sceneId);
    const core = window.JarvisCore;
    const connectionId = document.getElementById("studioImageConnectionSelect").value;
    const connection = window.JarvisVideoConnections.getById(connectionId);
    if (!connection) { core.showToast("Add and select an image connection first."); return; }

    const api = window.JarvisVideoApi;
    const body = api.fillJsonTemplate(connection.bodyTemplate, { prompt: scene.text, aspectRatio: project.aspectRatio });
    const expectBinary = connection.responseKind === "binary";
    core.showToast("Generating image…");
    api.postRequest(connection, body, expectBinary).then(function (result) {
      if (!result.ok) { core.showToast(result.errorMessage || "Image generation failed."); return; }
      let bytesPromise;
      let contentType = result.contentType || "";
      if (expectBinary) {
        bytesPromise = Promise.resolve(result.bodyBytes);
      } else {
        let json = null;
        try { json = JSON.parse(result.bodyText); } catch (e) { json = null; }
        const value = json ? api.resolveJsonPath(json, connection.responsePath) : undefined;
        if (typeof value === "string" && value.indexOf("http") === 0) {
          bytesPromise = api.getBytes(value).then(function (r) {
            if (!r.ok) throw new Error(r.errorMessage || "Could not download image.");
            contentType = r.contentType || contentType;
            return r.bodyBytes;
          });
        } else if (typeof value === "string" && value) {
          if (value.indexOf("data:") === 0) contentType = value.slice(5, value.indexOf(";")) || contentType;
          const bytes = api.decodeBase64ToBytes(value);
          bytesPromise = bytes ? Promise.resolve(bytes.buffer) : Promise.reject(new Error("Could not decode image data."));
        } else {
          bytesPromise = Promise.reject(new Error("No image data found in the response. Check the connection settings."));
        }
      }
      return bytesPromise.then(function (buffer) {
        const ext = api.guessImageExtension(contentType);
        const blob = new Blob([buffer], { type: "image/" + ext });
        return storeSceneVisualFile(scene, project, new File([blob], "generated." + ext), "image");
      }).then(function () { core.showToast("Image generated."); });
    }).catch(function (err) {
      core.showToast(err && err.message ? err.message : "Image generation failed.");
    });
  }

  function handleVisualsCardClick(e) {
    const project = getProject(activeProjectId);
    const genBtn = e.target.closest(".studio-generate-image-btn");
    if (genBtn) { handleGenerateImage(genBtn.getAttribute("data-scene-id")); return; }
    const clearBtn = e.target.closest(".studio-clear-visual-btn");
    if (clearBtn) {
      const scene = getScene(project, clearBtn.getAttribute("data-scene-id"));
      scene.visualBlobId = null; scene.visualFileName = null; scene.visualType = null;
      persistProject(project);
      renderVisualsCard(project);
    }
  }

  function handleVisualsCardChange(e) {
    const project = getProject(activeProjectId);
    if (e.target.classList.contains("studio-pick-image-input") || e.target.classList.contains("studio-pick-video-input")) {
      const file = e.target.files[0];
      if (!file) return;
      const scene = getScene(project, e.target.getAttribute("data-scene-id"));
      const type = e.target.classList.contains("studio-pick-video-input") ? "video" : "image";
      storeSceneVisualFile(scene, project, file, type);
    }
  }

  /* ---------------- editor: captions card ---------------- */

  function renderCaptionsCard(project) {
    const core = window.JarvisCore;
    const container = document.getElementById("studioCaptionsCard");
    if (project.scenes.length === 0) {
      container.innerHTML = '<h2 class="card-title">Captions</h2><p class="field-hint">Write a script first.</p>';
      return;
    }
    container.innerHTML =
      '<h2 class="card-title">Captions</h2>' +
      project.scenes.map(function (scene, i) {
        const lines = (scene.captions || []).map(function (cap) {
          return (
            '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">' +
              '<span style="color:var(--text-faint);font-size:11px;min-width:40px;">' + formatMs(cap.startMs) + '</span>' +
              '<input type="text" class="studio-caption-text" data-scene-id="' + core.escapeHtml(scene.id) + '" data-caption-id="' + core.escapeHtml(cap.id) + '" value="' + core.escapeHtml(cap.text) + '" style="flex:1;">' +
              '<button type="button" class="btn-icon studio-delete-caption-btn" data-scene-id="' + core.escapeHtml(scene.id) + '" data-caption-id="' + core.escapeHtml(cap.id) + '">&times;</button>' +
            '</div>'
          );
        }).join("");
        return (
          '<div class="list-item" data-scene-id="' + core.escapeHtml(scene.id) + '">' +
            '<div class="list-item-row"><div class="list-item-main"><strong>Scene ' + (i + 1) + '</strong></div>' +
              '<div class="list-item-actions"><button type="button" class="btn-icon studio-autogen-captions-btn" data-scene-id="' + core.escapeHtml(scene.id) + '">Auto-generate</button></div>' +
            '</div>' +
            (lines || '<p class="field-hint">No captions yet.</p>') +
          '</div>'
        );
      }).join("");
  }

  function formatMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function handleCaptionsCardClick(e) {
    const project = getProject(activeProjectId);
    const autoBtn = e.target.closest(".studio-autogen-captions-btn");
    if (autoBtn) {
      const scene = getScene(project, autoBtn.getAttribute("data-scene-id"));
      const durationMs = Math.round(sceneDurationSeconds(scene) * 1000);
      scene.captions = buildCaptionsForScene(scene.text, durationMs);
      persistProject(project);
      renderCaptionsCard(project);
      return;
    }
    const delBtn = e.target.closest(".studio-delete-caption-btn");
    if (delBtn) {
      const scene = getScene(project, delBtn.getAttribute("data-scene-id"));
      scene.captions = scene.captions.filter(function (c) { return c.id !== delBtn.getAttribute("data-caption-id"); });
      persistProject(project);
      renderCaptionsCard(project);
    }
  }

  function handleCaptionsCardChange(e) {
    if (!e.target.classList.contains("studio-caption-text")) return;
    const project = getProject(activeProjectId);
    const scene = getScene(project, e.target.getAttribute("data-scene-id"));
    const capId = e.target.getAttribute("data-caption-id");
    const cap = scene.captions.find(function (c) { return c.id === capId; });
    if (cap) { cap.text = e.target.value; persistProject(project); }
  }

  /* ---------------- editor: music card ---------------- */

  function renderMusicCard(project) {
    const container = document.getElementById("studioMusicCard");
    if (!project.musicBlobId) {
      container.innerHTML =
        '<h2 class="card-title">Music</h2>' +
        '<label class="btn btn-secondary" style="cursor:pointer;">Pick background music' +
        '<input type="file" accept="audio/*" id="studioMusicInput" class="hidden"></label>';
      return;
    }
    container.innerHTML =
      '<h2 class="card-title">Music</h2>' +
      '<p class="field-hint">' + window.JarvisCore.escapeHtml(project.musicFileName || "music file") + '</p>' +
      '<div class="form-row"><label for="studioMusicVolume">Volume: ' + Math.round(project.musicVolume * 100) + '%</label>' +
      '<input type="range" id="studioMusicVolume" min="0" max="1" step="0.05" value="' + project.musicVolume + '"></div>' +
      '<button type="button" class="btn-icon danger" id="studioRemoveMusicBtn">Remove</button>';
  }

  function handleMusicCardChange(e) {
    const project = getProject(activeProjectId);
    if (e.target.id === "studioMusicInput") {
      const file = e.target.files[0];
      if (!file) return;
      const blobId = window.JarvisCore.uid("music");
      window.JarvisBlobStore.putBlob(blobId, file).then(function () {
        project.musicBlobId = blobId;
        project.musicFileName = file.name;
        persistProject(project);
        renderMusicCard(project);
      });
      return;
    }
    if (e.target.id === "studioMusicVolume") {
      project.musicVolume = Number(e.target.value);
      persistProject(project);
      document.querySelector('label[for="studioMusicVolume"]').textContent = "Volume: " + Math.round(project.musicVolume * 100) + "%";
    }
  }

  function handleMusicCardClick(e) {
    if (e.target.id === "studioRemoveMusicBtn") {
      const project = getProject(activeProjectId);
      project.musicBlobId = null;
      project.musicFileName = null;
      persistProject(project);
      renderMusicCard(project);
    }
  }

  /* ---------------- editor: export card ---------------- */

  function renderExportCard(project) {
    const container = document.getElementById("studioExportCard");
    container.innerHTML =
      '<h2 class="card-title">Export</h2>' +
      '<div class="form-row"><label for="studioAspectRatioSelect">Aspect ratio</label>' +
      '<select id="studioAspectRatioSelect">' +
        '<option value="9:16"' + (project.aspectRatio === "9:16" ? " selected" : "") + '>9:16 — Shorts / Reels / TikTok</option>' +
        '<option value="16:9"' + (project.aspectRatio === "16:9" ? " selected" : "") + '>16:9 — standard YouTube</option>' +
        '<option value="1:1"' + (project.aspectRatio === "1:1" ? " selected" : "") + '>1:1 — square</option>' +
      '</select></div>' +
      '<p class="field-hint">' + project.scenes.length + ' scenes · ' + Math.round(projectTotalDuration(project)) + 's total</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-primary" id="studioRenderBtn"' + (project.scenes.length === 0 ? " disabled" : "") + '>Render Video</button></div>' +
      '<p class="field-hint" id="studioRenderStatus"></p>' +
      '<div id="studioExportResult"></div>';
    if (project.exportedBlobId) hydrateExportPreview(project);
  }

  function hydrateExportPreview(project) {
    window.JarvisBlobStore.getBlob(project.exportedBlobId).then(function (blob) {
      if (!blob) return;
      const url = trackObjectUrl(URL.createObjectURL(blob));
      const result = document.getElementById("studioExportResult");
      if (!result) return;
      result.innerHTML =
        '<video class="video-preview" controls src="' + url + '"></video>' +
        '<div class="form-actions" style="margin-top:8px;">' +
        '<a class="btn btn-secondary" href="' + url + '" download="' + window.JarvisCore.escapeHtml(project.exportedFileName || "video.mp4") + '">Download</a>' +
        '</div>';
    });
  }

  function handleExportCardChange(e) {
    if (e.target.id === "studioAspectRatioSelect") {
      const project = getProject(activeProjectId);
      project.aspectRatio = e.target.value;
      persistProject(project);
    }
  }

  function handleExportCardClick(e) {
    if (e.target.id !== "studioRenderBtn") return;
    const project = getProject(activeProjectId);
    const core = window.JarvisCore;
    if (project.scenes.length === 0) { core.showToast("Add at least one scene first."); return; }

    const btn = e.target;
    btn.disabled = true;
    const statusEl = document.getElementById("studioRenderStatus");
    project.status = "rendering";
    persistProject(project);

    function onStatus(msg) { if (statusEl) statusEl.textContent = msg; }
    onStatus("Starting…");

    renderProjectVideo(project, onStatus).then(function (blob) {
      const blobId = core.uid("export");
      return window.JarvisBlobStore.putBlob(blobId, blob).then(function () {
        project.exportedBlobId = blobId;
        project.exportedFileName = project.title.replace(/[^a-z0-9]+/gi, "_") + ".mp4";
        project.status = "exported";
        persistProject(project);
        onStatus("Done.");
        btn.disabled = false;
        hydrateExportPreview(project);
        core.showToast("Render finished.");
      });
    }).catch(function (err) {
      project.status = "failed";
      persistProject(project);
      onStatus("");
      btn.disabled = false;
      core.showToast("Render failed: " + (err && err.message ? err.message : String(err)));
    });
  }

  /* ---------------- editor shell ---------------- */

  // Six cards are always on screen at once, which reads as "do everything
  // everywhere" rather than a sequence. This pill row gives a single glance
  // at what's done, what's next, and lets a tap jump straight to that card.
  function renderStepTracker(project) {
    const container = document.getElementById("studioStepTracker");
    if (!container) return;
    const hasScenes = project.scenes.length > 0;
    const steps = [
      { key: "studioScriptCard", label: "1. Script", done: hasScenes },
      { key: "studioVoiceoverCard", label: "2. Voiceover", done: hasScenes && project.scenes.every(function (s) { return !!s.voiceoverBlobId; }) },
      { key: "studioVisualsCard", label: "3. Visuals", done: hasScenes && project.scenes.every(function (s) { return !!s.visualBlobId; }) },
      { key: "studioCaptionsCard", label: "4. Captions", done: hasScenes && project.scenes.every(function (s) { return !!(s.captions && s.captions.length); }) },
      { key: "studioMusicCard", label: "Music (optional)", done: !!project.musicBlobId, optional: true },
      { key: "studioExportCard", label: "5. Export", done: !!project.exportedBlobId }
    ];
    const requiredSteps = steps.filter(function (s) { return !s.optional; });
    const currentKey = (requiredSteps.filter(function (s) { return !s.done; })[0] || {}).key;
    container.innerHTML = steps.map(function (s) {
      const cls = s.done ? "badge-green" : s.key === currentKey ? "badge-yellow" : "badge-neutral";
      const suffix = s.done ? " ✓" : s.key === currentKey ? " — next" : "";
      return '<button type="button" class="badge ' + cls + ' studio-step-pill" data-target="' + s.key + '" style="cursor:pointer;border:none;">' +
        window.JarvisCore.escapeHtml(s.label + suffix) + '</button>';
    }).join("");
  }

  function handleStepTrackerClick(e) {
    const pill = e.target.closest(".studio-step-pill");
    if (!pill) return;
    const target = document.getElementById(pill.getAttribute("data-target"));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderEditor() {
    const project = getProject(activeProjectId);
    if (!project) { showListView(); return; }
    revokeTrackedObjectUrls();
    document.getElementById("studioEditorTitle").textContent = project.title;
    document.getElementById("studioEditorTopic").textContent = project.topic || "No topic set";
    renderStepTracker(project);
    renderScriptCard(project);
    renderVoiceoverCard(project);
    renderVisualsCard(project);
    renderCaptionsCard(project);
    renderMusicCard(project);
    renderExportCard(project);
  }

  /* ---------------- init ---------------- */

  function init() {
    load();
    renderProjectList();

    document.getElementById("studioProjectItems").addEventListener("click", handleProjectListClick);
    document.getElementById("studioNewProjectBtn").addEventListener("click", function () {
      window.JarvisCore.openModal("studioNewProjectModal");
    });
    document.getElementById("studioNewProjectForm").addEventListener("submit", handleNewProjectSubmit);
    document.getElementById("studioNewProjectCancelBtn").addEventListener("click", function () {
      window.JarvisCore.closeModal("studioNewProjectModal");
    });
    document.getElementById("studioBackBtn").addEventListener("click", showListView);
    document.getElementById("studioStepTracker").addEventListener("click", handleStepTrackerClick);
    document.getElementById("studioDeleteProjectBtn").addEventListener("click", function () {
      data.projects = data.projects.filter(function (p) { return p.id !== activeProjectId; });
      save();
      showListView();
    });

    document.getElementById("studioScriptCard").addEventListener("click", handleScriptCardClick);
    document.getElementById("studioScriptCard").addEventListener("change", handleScriptCardChange);
    document.getElementById("studioVoiceoverCard").addEventListener("click", handleVoiceoverCardClick);
    document.getElementById("studioVisualsCard").addEventListener("click", handleVisualsCardClick);
    document.getElementById("studioVisualsCard").addEventListener("change", handleVisualsCardChange);
    document.getElementById("studioCaptionsCard").addEventListener("click", handleCaptionsCardClick);
    document.getElementById("studioCaptionsCard").addEventListener("change", handleCaptionsCardChange);
    document.getElementById("studioMusicCard").addEventListener("click", handleMusicCardClick);
    document.getElementById("studioMusicCard").addEventListener("change", handleMusicCardChange);
    document.getElementById("studioExportCard").addEventListener("click", handleExportCardClick);
    document.getElementById("studioExportCard").addEventListener("change", handleExportCardChange);

    document.addEventListener("jarvis-video-connections-changed", function () {
      if (activeProjectId) renderEditor();
    });
  }

  window.JarvisVideoStudio = { init: init };
})();
