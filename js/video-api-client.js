/* ==========================================================================
   JARVIS — AI Video API client
   Shared request helpers used by both the Clip Generator and Studio
   features: fills a JSON body template with values, resolves a dot-path
   out of a JSON response, and performs the actual fetch.
   ========================================================================== */

(function () {
  "use strict";

  function fillJsonTemplate(template, vars) {
    let out = template;
    Object.keys(vars).forEach(function (key) {
      const quoted = '"{{' + key + '}}"';
      if (out.indexOf(quoted) !== -1) {
        out = out.split(quoted).join(JSON.stringify(vars[key]));
      }
    });
    Object.keys(vars).forEach(function (key) {
      const bare = "{{" + key + "}}";
      if (out.indexOf(bare) === -1) return;
      const value = vars[key];
      const replacement = (typeof value === "number" || typeof value === "boolean")
        ? String(value)
        : JSON.stringify(value);
      out = out.split(bare).join(replacement);
    });
    return out;
  }

  function resolveJsonPath(root, path) {
    if (!path || !path.trim()) return undefined;
    let current = root;
    const segments = path.split(".").map(function (s) { return s.trim(); }).filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      if (current === null || current === undefined) return undefined;
      const segment = segments[i];
      if (Array.isArray(current)) {
        const index = parseInt(segment, 10);
        if (isNaN(index) || index < 0 || index >= current.length) return undefined;
        current = current[index];
      } else if (typeof current === "object") {
        current = current[segment];
      } else {
        return undefined;
      }
    }
    return current;
  }

  function truncate(str, n) {
    return str.length <= n ? str : str.slice(0, n) + "…";
  }

  // Returns a Promise resolving to { ok, status, bodyText, bodyBytes (ArrayBuffer), contentType, errorMessage }
  function postRequest(connection, jsonBody, expectBinary) {
    const headers = { "Content-Type": "application/json" };
    if (connection.apiKey && connection.apiKey.trim()) {
      // Not every provider uses "Bearer <key>" (e.g. some send the raw key
      // in a custom header like x-api-key) — authStyle defaults to "bearer"
      // so existing saved connections keep working unchanged.
      headers[connection.authHeader && connection.authHeader.trim() ? connection.authHeader.trim() : "Authorization"] =
        connection.authStyle === "raw" ? connection.apiKey : "Bearer " + connection.apiKey;
    }
    return fetch(connection.endpointUrl, { method: "POST", headers: headers, body: jsonBody })
      .then(function (res) {
        const contentType = res.headers.get("content-type") || "";
        if (expectBinary) {
          return res.arrayBuffer().then(function (buf) {
            return { ok: res.ok, status: res.status, bodyBytes: buf, contentType: contentType, errorMessage: res.ok ? null : "HTTP " + res.status };
          });
        }
        return res.text().then(function (text) {
          return {
            ok: res.ok,
            status: res.status,
            bodyText: text,
            contentType: contentType,
            errorMessage: res.ok ? null : "HTTP " + res.status + (text ? ": " + truncate(text, 300) : "")
          };
        });
      })
      .catch(function (err) {
        return { ok: false, errorMessage: "Network/CORS error contacting the endpoint: " + (err && err.message ? err.message : String(err)) };
      });
  }

  function getBytes(url) {
    return fetch(url)
      .then(function (res) {
        return res.arrayBuffer().then(function (buf) {
          return { ok: res.ok, status: res.status, bodyBytes: buf, contentType: res.headers.get("content-type") || "", errorMessage: res.ok ? null : "HTTP " + res.status };
        });
      })
      .catch(function (err) {
        return { ok: false, errorMessage: "Network error: " + (err && err.message ? err.message : String(err)) };
      });
  }

  function decodeBase64ToBytes(value) {
    const commaIndex = value.indexOf(",");
    const raw = value.indexOf("data:") === 0 && commaIndex !== -1 ? value.slice(commaIndex + 1) : value;
    try {
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch (e) {
      return null;
    }
  }

  function guessAudioExtension(contentType) {
    const ct = contentType || "";
    if (ct.indexOf("wav") !== -1) return "wav";
    if (ct.indexOf("ogg") !== -1) return "ogg";
    if (ct.indexOf("aac") !== -1) return "aac";
    return "mp3";
  }

  function guessImageExtension(contentType) {
    const ct = contentType || "";
    if (ct.indexOf("jpeg") !== -1 || ct.indexOf("jpg") !== -1) return "jpg";
    if (ct.indexOf("webp") !== -1) return "webp";
    return "png";
  }

  window.JarvisVideoApi = {
    fillJsonTemplate: fillJsonTemplate,
    resolveJsonPath: resolveJsonPath,
    postRequest: postRequest,
    getBytes: getBytes,
    decodeBase64ToBytes: decodeBase64ToBytes,
    truncate: truncate,
    guessAudioExtension: guessAudioExtension,
    guessImageExtension: guessImageExtension
  };
})();
