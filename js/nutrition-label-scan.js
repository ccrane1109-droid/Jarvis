/* ==========================================================================
   JARVIS — Nutrition Label Scan

   Takes a photo of a packaged food's Nutrition Facts panel, runs on-device
   OCR (Tesseract.js, Apache-2.0 licensed, vendored locally in
   js/vendor/tesseract) to read the text, then looks for the handful of
   standard US label lines (Calories, Total Fat, Sodium, Total Carbohydrate,
   Dietary Fiber, Protein, and the Vitamin D/Calcium/Iron/Potassium/Vitamin C
   lines some labels include) and pulls out their numbers.

   Why on-device instead of the AI connection nutrition.js already has: this
   needs no API key, no account, and nothing ever leaves the device — a
   label's numbers are already printed fact, not something that needs a
   language model's judgment the way "how many calories in my own recipe"
   does. The tradeoff is accuracy: real-world photos (glare, a curved can
   label, a blurry shot) can confuse OCR, so every field filled in from a
   scan stays in the same plain editable number inputs the AI estimate path
   already uses — nothing here is final until the user saves the form.

   How a scan works (js/nutrition-label-parse.js turns the text into numbers):
     1. The photo is cleaned up (grayscale, contrast stretched) and read once at
        a moderate size, which is fast.
     2. If a main value (calories, fat, carbs, protein) is missing, JARVIS finds
        where the label is in the photo from the words that were recognized,
        cuts that area out of the ORIGINAL full-size photo and reads it again
        at full detail. A label that fills a small part of a 12-megapixel photo
        is unreadable once the whole photo is shrunk to fit, which is why a
        single pass at one size isn't enough.
     3. The two readings are combined: each value comes from the reading that
        found more, and the other fills in whatever it missed.

   Only Calories/Protein/Carbohydrate/Fat/Fiber and the six micronutrients
   Jarvis already tracks are extracted. A field with no confidently-matched
   line in the scanned text is simply left out of the result (never guessed
   at or defaulted to 0) — same "nothing invented" rule the rest of
   Nutrition follows.

   The Tesseract.js + worker + OCR-engine scripts (~3MB combined) are
   lazy-loaded on first scan, not on every page load. The English language
   data it needs on top of that (~4MB, gzipped) is NOT vendored — same as
   Form Check's MoveNet model weights — it downloads once from Tesseract's
   own default CDN the first time a scan actually runs, then the browser
   caches it for next time.
   ========================================================================== */

(function () {
  "use strict";

  const TESSERACT_URL = "js/vendor/tesseract/tesseract.min.js";
  const WORKER_PATH = "js/vendor/tesseract/worker.min.js";
  const CORE_PATH = "js/vendor/tesseract/tesseract-core-lstm.js";
  const OEM_LSTM_ONLY = 1;
  const FIRST_PASS_LONG_SIDE = 1600; // a quick first look at the whole photo
  const DETAIL_LONG_SIDE = 2000;     // the label area, re-read at this size
  const FULL_FRAME_LONG_SIDE = 2400; // when no label could be located, read the whole photo at higher detail

  let workerPromise = null;

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-label-scan-src="' + src + '"]')) { resolve(); return; }
      const el = document.createElement("script");
      el.src = src;
      el.setAttribute("data-label-scan-src", src);
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error("Couldn't load " + src)); };
      document.head.appendChild(el);
    });
  }

  function ensureWorker(onStatus) {
    if (workerPromise) return workerPromise;
    onStatus("Loading the text-recognition engine… (first time only, a few MB)");
    workerPromise = loadScriptOnce(TESSERACT_URL)
      .then(function () {
        if (!window.Tesseract) throw new Error("Text-recognition library failed to load.");
        return window.Tesseract.createWorker("eng", OEM_LSTM_ONLY, {
          workerPath: WORKER_PATH,
          corePath: CORE_PATH,
          // Without this, the worker script loads via a blob: URL (the
          // library's default) instead of its real same-origin path — and a
          // blob URL has no real directory, so the core's attempt to fetch
          // its sibling .wasm file by a relative path fails outright
          // ("Failed to parse URL from tesseract-core-lstm.wasm"). Loading
          // the worker from its actual vendored path keeps relative
          // resolution working.
          workerBlobURL: false,
          logger: function (m) {
            if (m && m.status === "recognizing text" && typeof m.progress === "number") {
              onStatus("Reading the label… " + Math.round(m.progress * 100) + "%");
            } else if (m && m.status && m.status.indexOf("loading") !== -1) {
              onStatus("Downloading the English recognition data… (one-time, a few MB)");
            }
          }
        });
      })
      .catch(function (err) {
        workerPromise = null; // allow retry
        throw err;
      });
    return workerPromise;
  }

  function fileToImage(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Couldn't read that photo.")); };
      img.src = url;
    });
  }

  // Draws a rectangle of the photo (in its own pixels) onto a canvas whose longer side is `longSide`.
  function drawRegion(img, sx, sy, sw, sh, longSide) {
    const scale = longSide / Math.max(sw, sh);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // Grayscale, then stretch so the darkest 1% of pixels become black and the lightest 1% white. Evens out dim or
  // washed-out photos, which is most of what makes small label type hard to read.
  function enhance(canvas) {
    const g = canvas.getContext("2d");
    const data = g.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < px.length; i += 4) {
      const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = y;
      hist[y]++;
    }
    const total = px.length / 4;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
    if (hi - lo >= 24) {
      const k = 255 / (hi - lo);
      for (let i = 0; i < px.length; i += 4) {
        const y = Math.max(0, Math.min(255, Math.round((px[i] - lo) * k)));
        px[i] = px[i + 1] = px[i + 2] = y;
      }
    }
    g.putImageData(data, 0, 0);
    return canvas;
  }

  /* ---------------- finding the label in a photo ---------------- */

  // The words a Nutrition Facts panel is made of, compared with the common OCR mix-ups (l/1 for i) folded away.
  const fold = function (w) { return String(w).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/[l1]/g, "i"); };
  const LABEL_WORDS = ["nutrition", "facts", "calories", "serving", "servings", "amount", "protein", "carbohydrate", "carbohydrates", "sodium",
    "cholesterol", "fiber", "sugars", "vitamin", "calcium", "potassium", "iron", "daily", "value", "saturated", "trans", "total", "fat"].map(fold);

  function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]; }

  // From the first reading's words (positions in that reading's own pixels): the rectangle the label occupies, or
  // null when too few label words were recognized to say. Label words sit on the left of the panel and the numbers
  // to their right, so the area is grown to take in the words around them.
  function findLabelBox(words, width, height) {
    const good = (words || []).filter(function (w) { return w && w.bbox && w.confidence >= 35 && String(w.text).length > 1; });
    const hits = good.filter(function (w) { return LABEL_WORDS.indexOf(fold(w.text)) !== -1; });
    if (hits.length < 4) return null;
    const cx = hits.map(function (w) { return (w.bbox.x0 + w.bbox.x1) / 2; }).sort(function (a, b) { return a - b; });
    const cy = hits.map(function (w) { return (w.bbox.y0 + w.bbox.y1) / 2; }).sort(function (a, b) { return a - b; });
    let x0 = percentile(cx, 0.05), x1 = percentile(cx, 0.95), y0 = percentile(cy, 0.05), y1 = percentile(cy, 0.95);
    const grow = function (f) {
      const w = x1 - x0, h = y1 - y0;
      return { x0: x0 - w * f.l, x1: x1 + w * f.r, y0: y0 - h * f.t, y1: y1 + h * f.b };
    };
    // First growth (generous to the right for the numbers), then take in every word that touches that area.
    let box = grow({ l: 0.15, r: 0.9, t: 0.12, b: 0.15 });
    good.forEach(function (w) {
      const inside = w.bbox.x1 >= box.x0 && w.bbox.x0 <= box.x1 && w.bbox.y1 >= box.y0 && w.bbox.y0 <= box.y1;
      if (!inside) return;
      x0 = Math.min(x0, w.bbox.x0); x1 = Math.max(x1, w.bbox.x1); y0 = Math.min(y0, w.bbox.y0); y1 = Math.max(y1, w.bbox.y1);
    });
    const padX = (x1 - x0) * 0.1, padY = (y1 - y0) * 0.08;
    box = { x0: Math.max(0, x0 - padX), x1: Math.min(width, x1 + padX), y0: Math.max(0, y0 - padY), y1: Math.min(height, y1 + padY) };
    if (box.x1 - box.x0 < width * 0.1 || box.y1 - box.y0 < height * 0.1) return null;
    return box;
  }

  /* ---------------- combining readings ---------------- */

  // How good a reading looks: more values is better, a warning or a doubtful value costs a little.
  function quality(r) { return r.matchedCount * 10 - r.warnings.length * 8 - r.uncertain.length; }

  // `a` is the first reading, `b` the closer second one (both parse results). Each value comes from whichever
  // reading was sure of it; if both were, the better reading's value is used. Values the two readings disagree
  // about are flagged so the page says to check them.
  function mergeReadings(a, b) {
    const parser = window.JarvisLabelParse;
    const main = quality(b) >= quality(a) ? b : a;
    const other = main === a ? b : a;
    const fields = {};
    const uncertain = [];
    Object.keys(Object.assign({}, other.fields, main.fields)).forEach(function (k) {
      const inMain = main.fields[k] !== undefined, inOther = other.fields[k] !== undefined;
      const mainSure = inMain && main.uncertain.indexOf(k) === -1, otherSure = inOther && other.uncertain.indexOf(k) === -1;
      let pick = inMain ? main : other;
      if (inMain && inOther && !mainSure && otherSure) pick = other;
      fields[k] = pick.fields[k];
      const disagree = inMain && inOther && main.fields[k] !== other.fields[k];
      if (disagree || pick.uncertain.indexOf(k) !== -1) uncertain.push(k);
    });
    // Check the combined set (calories against macros, fiber against carbs) rather than trusting either alone.
    const check = parser.checkFields(fields);
    check.uncertain.forEach(function (k) { if (uncertain.indexOf(k) === -1) uncertain.push(k); });
    return {
      fields: fields, uncertain: uncertain, warnings: check.warnings,
      missing: parser.MAIN.filter(function (k) { return fields[k] === undefined; }),
      servingSize: main.servingSize || other.servingSize, matchedCount: Object.keys(fields).length,
      rawText: a.rawText.trim() + "\n\n--- second reading ---\n" + b.rawText.trim()
    };
  }

  // Good enough to stop after one reading: the four main values are all there and nothing looks off.
  function complete(parsed) { return parsed.missing.length === 0 && parsed.warnings.length === 0; }

  /* ---------------- the scan ---------------- */

  function recognize(worker, canvas) {
    return worker.recognize(canvas).then(function (result) {
      const data = (result && result.data) || {};
      return { text: data.text || "", words: data.words || [] };
    });
  }

  // Runs the whole pipeline on a File (from a file-picker/camera input) and
  // resolves to { ok:true, fields, uncertain, warnings, missing, servingSize, matchedCount, rawText } or
  // { ok:false, error, rawText }. onStatus(text) is called with progress updates
  // along the way; never rejects, so callers don't need a .catch.
  function scanNutritionLabel(file, onStatus) {
    const status = typeof onStatus === "function" ? onStatus : function () {};
    const parser = window.JarvisLabelParse;
    if (!file) return Promise.resolve({ ok: false, error: "No photo selected." });
    if (!parser) return Promise.resolve({ ok: false, error: "Label reading isn't available right now." });
    let img = null;
    let worker = null;
    let first = null;
    let firstCanvas = null;
    return fileToImage(file)
      .then(function (loaded) {
        img = loaded;
        status("Preparing the photo…");
        const longSide = Math.max(img.naturalWidth, img.naturalHeight);
        // Small photos are enlarged a little (OCR does better with bigger type); big ones are shrunk for speed.
        firstCanvas = enhance(drawRegion(img, 0, 0, img.naturalWidth, img.naturalHeight, Math.min(FIRST_PASS_LONG_SIDE, Math.max(longSide, Math.min(longSide * 2, 1400)))));
        return ensureWorker(status);
      })
      .then(function (w) {
        worker = w;
        status("Reading the label…");
        return recognize(worker, firstCanvas);
      })
      .then(function (r1) {
        first = parser.parseNutritionLabelText(r1.text);
        first.words = r1.words;
        if (complete(first)) return first;
        // Not everything was found: take a second, closer look.
        const box = findLabelBox(r1.words, firstCanvas.width, firstCanvas.height);
        let canvas;
        if (box) {
          status("Found the label. Reading it again in more detail…");
          const kx = img.naturalWidth / firstCanvas.width, ky = img.naturalHeight / firstCanvas.height;
          const sx = Math.round(box.x0 * kx), sy = Math.round(box.y0 * ky);
          canvas = enhance(drawRegion(img, sx, sy, Math.round((box.x1 - box.x0) * kx), Math.round((box.y1 - box.y0) * ky), DETAIL_LONG_SIDE));
        } else {
          status("Reading the whole photo in more detail…");
          const longSide = Math.max(img.naturalWidth, img.naturalHeight);
          canvas = enhance(drawRegion(img, 0, 0, img.naturalWidth, img.naturalHeight, Math.min(FULL_FRAME_LONG_SIDE, Math.max(longSide, FIRST_PASS_LONG_SIDE))));
        }
        return recognize(worker, canvas).then(function (r2) {
          const second = parser.parseNutritionLabelText(r2.text);
          return mergeReadings(first, second);
        });
      })
      .then(function (parsed) {
        if (parsed.matchedCount === 0) {
          return { ok: false, rawText: parsed.rawText, error: "Couldn't find any recognizable Nutrition Facts on that photo — try a straighter, well-lit shot of just the label, or enter the numbers by hand." };
        }
        return Object.assign({ ok: true }, parsed);
      })
      .catch(function (err) {
        return { ok: false, error: "Couldn't scan that photo: " + (err && err.message ? err.message : String(err)) };
      });
  }

  window.JarvisLabelScan = {
    scanNutritionLabel: scanNutritionLabel,
    parseNutritionLabelText: function (text) { return window.JarvisLabelParse.parseNutritionLabelText(text); } // exposed for testing
  };
})();
