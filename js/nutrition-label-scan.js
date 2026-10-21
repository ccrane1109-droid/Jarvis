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

  const PASS_TIMEOUT_MS = 60000;    // the first reading may take this long before it is abandoned
  const LATER_PASS_TIMEOUT_MS = 40000; // so may each later one, which are bigger or fiddlier but less likely to be needed
  const TOTAL_BUDGET_MS = 90000;   // after this long, no further reading is started
  const IDLE_RELEASE_MS = 60000;    // the engine (a hundred MB or so) is let go this long after a scan
  const MAX_READINGS = 4;
  // Below this page-level confidence from the engine, every number is flagged. Measured on synthetic label photos
  // with two recognition models: every photo that was read fully right scored 76 or more, badly read ones mostly under 70.
  const LOW_CONFIDENCE = 70;

  let workerPromise = null;
  let workerHandle = null;
  let idleTimer = null;
  let scanning = false;
  // Where the engine's progress messages go: always the scan that is running NOW. (The engine is created once and
  // kept; a callback captured at creation would keep reporting into the first scan's form for good.)
  let progressHook = null;

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

  function ensureWorker() {
    if (workerPromise) return workerPromise;
    if (progressHook) progressHook({ text: "Loading the text-recognition engine… (first time only, a few MB)" });
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
            const hook = progressHook;
            if (!hook || !m) return;
            if (m.status === "recognizing text" && typeof m.progress === "number") hook({ progress: m.progress });
            else if (m.status && m.status.indexOf("loading") !== -1) hook({ text: "Downloading the English recognition data… (one-time, a few MB)" });
          }
        });
      })
      .then(function (w) {
        workerHandle = w;
        return w;
      })
      .catch(function (err) {
        workerPromise = null; // allow retry
        throw err;
      });
    return workerPromise;
  }

  // Lets go of the engine (and its memory). The next scan creates a new one, which is quick once the data is cached.
  function releaseWorker() {
    const w = workerHandle;
    workerPromise = null;
    workerHandle = null;
    if (w && typeof w.terminate === "function") { try { w.terminate(); } catch (e) { /* already gone */ } }
  }

  function withTimeout(promise, ms, onTimeout) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () {
        onTimeout();
        reject(Object.assign(new Error("That took too long, so it was stopped."), { code: "timeout" }));
      }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
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

  function cloneCanvas(src) {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  // Light text on a dark panel becomes dark text on a light one (the recognition engine expects the latter).
  function invert(canvas) {
    const g = canvas.getContext("2d");
    const data = g.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 255 - px[i]; }
    g.putImageData(data, 0, 0);
    return canvas;
  }

  // Black and white, deciding each pixel against its own neighbourhood, so a shadow or a bright patch across the
  // label doesn't swallow part of the text. (Bradley's adaptive threshold, using an integral image.)
  function binarize(canvas) {
    const w = canvas.width, h = canvas.height;
    const g = canvas.getContext("2d");
    const data = g.getImageData(0, 0, w, h);
    const px = data.data;
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += px[(y * w + x) * 4];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
      }
    }
    const half = Math.max(8, Math.round(Math.max(w, h) / 24));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        const i = (y * w + x) * 4;
        const v = px[i] * count <= sum * 0.88 ? 0 : 255;
        px[i] = px[i + 1] = px[i + 2] = v;
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

  // `a` is everything read so far, `b` the newest reading (both parse results). Each value comes from whichever
  // reading was sure of it; if both were, the better reading's value is used. Where the two disagree, the value
  // that fits the rest of the label better (calories against fat/carbs/protein, amounts against Daily Values)
  // is kept, and the value is flagged so the page says to check it.
  function mergeReadings(a, b) {
    const parser = window.JarvisLabelParse;
    const main = quality(b) >= quality(a) ? b : a;
    const other = main === a ? b : a;
    const dvs = Object.assign({}, other.dvs, main.dvs);
    const fields = {};
    const uncertain = [];
    const disagreeing = [];
    Object.keys(Object.assign({}, other.fields, main.fields)).forEach(function (k) {
      const inMain = main.fields[k] !== undefined, inOther = other.fields[k] !== undefined;
      const mainSure = inMain && main.uncertain.indexOf(k) === -1, otherSure = inOther && other.uncertain.indexOf(k) === -1;
      let pick = inMain ? main : other;
      if (inMain && inOther && !mainSure && otherSure) pick = other;
      fields[k] = pick.fields[k];
      const disagree = inMain && inOther && main.fields[k] !== other.fields[k];
      if (disagree) disagreeing.push(k);
      if (disagree || pick.uncertain.indexOf(k) !== -1) uncertain.push(k);
    });
    // For each value the readings disagree on, try both against everything else; the one with fewer problems wins.
    disagreeing.forEach(function (k) {
      const problems = function (value) {
        const trial = Object.assign({}, fields);
        trial[k] = value;
        return parser.checkFields(trial, dvs).warnings.length;
      };
      const withMain = problems(main.fields[k]), withOther = problems(other.fields[k]);
      if (withMain < withOther) fields[k] = main.fields[k];
      else if (withOther < withMain) fields[k] = other.fields[k];
    });
    // Check the combined set (calories against macros, fiber against carbs, amounts against Daily Values) rather
    // than trusting either alone.
    const check = parser.checkFields(fields, dvs);
    check.uncertain.forEach(function (k) { if (uncertain.indexOf(k) === -1) uncertain.push(k); });
    // A repair note from a reading ("Fat: read 15g, but the 2% Daily Value … so 1.5g is used") stays only while that
    // repaired value is the one kept. The checks above ran on the combined values, so their notes are never stale.
    const repairs = (a.warnings || []).concat(b.warnings || []).filter(function (w, i, all) {
      if (all.indexOf(w) !== i) return false;
      const used = w.match(/so ([\d.]+)[a-z]* is used\.$/);
      return !!used && Object.keys(fields).some(function (k) {
        return w.indexOf(parser.NAMES[k].charAt(0).toUpperCase() + parser.NAMES[k].slice(1) + ": read ") === 0 && fields[k] === Number(used[1]);
      });
    });
    const warnings = repairs.concat(check.warnings);
    return {
      fields: fields, uncertain: uncertain, warnings: warnings,
      dvs: dvs, missing: parser.MAIN.filter(function (k) { return fields[k] === undefined; }),
      servingSize: main.servingSize || other.servingSize, matchedCount: Object.keys(fields).length,
      confidence: Math.max(a.confidence || 0, b.confidence || 0),
      rawText: a.rawText.trim() + "\n\n--- another reading ---\n" + b.rawText.trim()
    };
  }

  // Good enough to stop after one reading: the four main values are all there and nothing looks off.
  function complete(parsed) { return parsed.missing.length === 0 && parsed.warnings.length === 0; }

  /* ---------------- the scan ---------------- */

  function recognize(worker, canvas, limitMs) {
    return withTimeout(worker.recognize(canvas), limitMs, releaseWorker).then(function (result) {
      const data = (result && result.data) || {};
      return { text: data.text || "", words: data.words || [], confidence: typeof data.confidence === "number" ? data.confidence : 0 };
    });
  }

  // Runs the whole pipeline on a File (from a file-picker/camera input) and
  // resolves to { ok:true, fields, uncertain, warnings, missing, servingSize, matchedCount, rawText } or
  // { ok:false, error, rawText }. onStatus(text) is called with progress updates
  // along the way; never rejects, so callers don't need a .catch.
  async function scanNutritionLabel(file, onStatus) {
    const status = typeof onStatus === "function" ? onStatus : function () {};
    const parser = window.JarvisLabelParse;
    if (!file) return { ok: false, error: "No photo selected." };
    if (!parser) return { ok: false, error: "Label reading isn't available right now." };
    if (scanning) return { ok: false, error: "A scan is already running. Wait for it to finish." };
    scanning = true;
    clearTimeout(idleTimer);
    const started = Date.now();
    const withinBudget = function () { return Date.now() - started < TOTAL_BUDGET_MS; };
    let merged = null;
    let timedOut = false;
    let looks = 0;

    // One reading of a canvas: the words, parsed, folded into everything read so far.
    async function read(canvas, label) {
      looks++;
      progressHook = function (m) {
        if (m.text) status(m.text);
        else if (typeof m.progress === "number") status(label + " " + Math.round(m.progress * 100) + "%");
      };
      status(label);
      const worker = await ensureWorker();
      // The first reading gets the full allowance; later ones only what's left of the overall budget.
      const left = TOTAL_BUDGET_MS - (Date.now() - started);
      const r = await recognize(worker, canvas, looks === 1 ? PASS_TIMEOUT_MS : Math.max(15000, Math.min(LATER_PASS_TIMEOUT_MS, left)));
      const parsed = parser.parseNutritionLabelText(r.text);
      parsed.words = r.words;
      parsed.confidence = r.confidence;
      merged = merged ? mergeReadings(merged, parsed) : parsed;
      return { parsed: parsed, words: r.words };
    }

    try {
      status("Preparing the photo…");
      const img = await fileToImage(file);
      const longSide = Math.max(img.naturalWidth, img.naturalHeight);
      // Small photos are enlarged a little (OCR does better with bigger type); big ones are shrunk for speed.
      const firstSize = Math.min(FIRST_PASS_LONG_SIDE, Math.max(longSide, Math.min(longSide * 2, 1400)));
      const firstCanvas = enhance(drawRegion(img, 0, 0, img.naturalWidth, img.naturalHeight, firstSize));
      const first = await read(firstCanvas, "Reading the label…");

      // Not everything was found (or something looked off): look again, closer, and in other ways.
      // Each step is skipped once the time budget is spent, and a step that times out ends the scan with what we have.
      if (!complete(merged)) {
        try {
          const more = function () { return !complete(merged) && withinBudget() && looks < MAX_READINGS; };
          // Where the label sits in the original photo (in its own pixels), and whether it is light-on-dark.
          let region = null, reversed = false;
          const locate = function (words, canvas, flipped) {
            const box = findLabelBox(words, canvas.width, canvas.height);
            if (!box) return;
            const kx = img.naturalWidth / canvas.width, ky = img.naturalHeight / canvas.height;
            region = { x: Math.round(box.x0 * kx), y: Math.round(box.y0 * ky), w: Math.round((box.x1 - box.x0) * kx), h: Math.round((box.y1 - box.y0) * ky) };
            reversed = flipped;
          };
          locate(first.words, firstCanvas, false);

          // Label not found, and the photo has more detail than the first look used (the label is small in the
          // frame): read the whole photo at a larger size.
          let whole = firstCanvas;
          const bigSize = Math.min(FULL_FRAME_LONG_SIDE, longSide);
          if (!region && more() && bigSize > firstSize * 1.15) {
            whole = enhance(drawRegion(img, 0, 0, img.naturalWidth, img.naturalHeight, bigSize));
            const big = await read(whole, "Looking at the whole photo more closely…");
            locate(big.words, whole, false);
          }
          // Still no label words at all: it may be light writing on a dark panel, so look at the photo the other way
          // round (at the first look's size, which is quick; a label that is found is then read closely).
          if (!region && more()) {
            const flipped = await read(invert(cloneCanvas(firstCanvas)), "Trying the photo the other way round…");
            locate(flipped.words, firstCanvas, true);
          }

          // Found it: read just that part of the original photo, at a size the engine likes.
          const area = function () {
            const canvas = enhance(drawRegion(img, region.x, region.y, region.w, region.h, DETAIL_LONG_SIDE));
            return reversed ? invert(canvas) : canvas;
          };
          if (region && more()) await read(area(), "Found the label. Taking a closer look…");
          // Still not clean: one more reading that evens out shadows and glare.
          if (region && more()) await read(binarize(area()), "Trying again with the light evened out…");
        } catch (err) {
          if (!err || err.code !== "timeout") throw err;
          timedOut = true; // keep whatever the readings so far found
        }
      }

      if (!merged || merged.matchedCount === 0) {
        return { ok: false, rawText: merged ? merged.rawText : "", error: timedOut
          ? "That photo took too long to read, so it was stopped. Try a closer, sharper, well-lit shot of just the label, or enter the numbers by hand."
          : "Couldn't find any recognizable Nutrition Facts on that photo. Move closer so the label fills most of the photo, keep it flat and well lit, or enter the numbers by hand." };
      }
      const result = Object.assign({ ok: true }, merged);
      result.warnings = (merged.warnings || []).slice();
      // A photo the engine itself found hard to read: nothing it says can be trusted without a look.
      if (merged.confidence > 0 && merged.confidence < LOW_CONFIDENCE) {
        result.uncertain = Object.keys(merged.fields);
        result.warnings.unshift("This photo was hard to read, so check every number against the label.");
      }
      if (timedOut) result.warnings.push("The last, closer reading took too long and was stopped, so this may be incomplete.");
      return result;
    } catch (err) {
      return { ok: false, error: err && err.code === "timeout"
        ? "That photo took too long to read, so it was stopped. Try a closer, sharper, well-lit shot of just the label, or enter the numbers by hand."
        : "Couldn't scan that photo: " + (err && err.message ? err.message : String(err)) };
    } finally {
      scanning = false;
      progressHook = null;
      // Let the engine's memory go a while after the last scan, which keeps a phone's browser from running short.
      idleTimer = setTimeout(releaseWorker, IDLE_RELEASE_MS);
    }
  }

  window.JarvisLabelScan = {
    scanNutritionLabel: scanNutritionLabel,
    parseNutritionLabelText: function (text) { return window.JarvisLabelParse.parseNutritionLabelText(text); }, // exposed for testing
    mergeReadings: mergeReadings // exposed for testing
  };
})();
