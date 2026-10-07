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
  const MAX_IMAGE_DIMENSION = 1600; // downscaling large phone photos speeds up OCR a lot with no real accuracy loss

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

  function imageToScaledCanvas(img) {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* ---------------- label text parsing (pure function — unit-testable with plain strings) ---------------- */

  // Reads a plain number (allows a decimal point, strips stray OCR noise
  // like a trailing "g"/"mg" already consumed by the caller's pattern) from
  // a regex match, or null if it doesn't parse to a sane non-negative value.
  function parseNum(raw) {
    if (raw === undefined || raw === null) return null;
    const n = Number(String(raw).replace(/,/g, "").trim());
    return isFinite(n) && n >= 0 ? n : null;
  }

  // Finds the first match of `pattern` (must have exactly one capturing
  // group, the number) anywhere in the text and returns the parsed number,
  // or null if not found/not parseable. Case-insensitive, and tolerant of
  // the colon or dashes OCR sometimes drops or doubles.
  function extract(text, pattern) {
    const m = text.match(pattern);
    return m ? parseNum(m[1]) : null;
  }

  // [il1] in place of a plain "i" throughout — Tesseract very commonly
  // misreads a lowercase "i" as "l" (or occasionally "1") in the small,
  // condensed type nutrition labels use, e.g. "Calories"->"Calorles",
  // "Sodium"->"Sodlum", "Vitamin"->"Vltamln". Tolerating that one specific,
  // well-known confusion for these known keywords catches most real-world
  // misreads without loosening the patterns enough to match random text.
  const I = "[il1]";
  const FIELD_PATTERNS = {
    calories: new RegExp("cal" + I + "?or" + I + "es(?!\\s*from)[\\s:.\\-]*?(\\d{1,4})\\b", "i"),
    fat: /total\s*fat[\s:.\-]*?(\d{1,3}(?:\.\d+)?)\s*g/i,
    sodium: new RegExp("sod" + I + "um[\\s:.\\-]*?(\\d{1,5}(?:\\.\\d+)?)\\s*mg", "i"),
    carbs: /total\s*carb(?:ohydrate)?s?[\s:.\-]*?(\d{1,3}(?:\.\d+)?)\s*g/i,
    fiber: new RegExp("f" + I + "ber[\\s:.\\-]*?(\\d{1,3}(?:\\.\\d+)?)\\s*g", "i"),
    protein: new RegExp("prote" + I + "n[\\s:.\\-]*?(\\d{1,3}(?:\\.\\d+)?)\\s*g", "i"),
    vitaminD: new RegExp("v" + I + "tam" + I + "n\\s*d[\\s:.\\-]*?(\\d{1,3}(?:\\.\\d+)?)\\s*mcg", "i"),
    calcium: new RegExp("calc" + I + "um[\\s:.\\-]*?(\\d{1,4}(?:\\.\\d+)?)\\s*mg", "i"),
    iron: new RegExp("\\b" + I + "ron[\\s:.\\-]*?(\\d{1,3}(?:\\.\\d+)?)\\s*mg", "i"),
    potassium: new RegExp("potass" + I + "um[\\s:.\\-]*?(\\d{1,5}(?:\\.\\d+)?)\\s*mg", "i"),
    vitaminC: new RegExp("v" + I + "tam" + I + "n\\s*c[\\s:.\\-]*?(\\d{1,3}(?:\\.\\d+)?)\\s*mg", "i")
  };

  // Parses raw OCR text from a Nutrition Facts panel into whichever of
  // Jarvis's tracked fields it can confidently find. Returns
  // { fields: {...}, servingSize: string|null, matchedCount: number,
  // rawText: string } — fields missing from the input are simply absent
  // from `fields`, never defaulted or guessed.
  function parseNutritionLabelText(rawText) {
    const text = String(rawText || "");
    const fields = {};
    let matchedCount = 0;
    Object.keys(FIELD_PATTERNS).forEach(function (key) {
      const value = extract(text, FIELD_PATTERNS[key]);
      if (value !== null) { fields[key] = value; matchedCount++; }
    });
    const servingMatch = text.match(new RegExp("serv" + I + "ng\\s*s" + I + "ze[\\s:.\\-]*?([^\\n]{1,40})", "i"));
    const servingSize = servingMatch ? servingMatch[1].trim().replace(/[.\s]+$/, "") : null;
    return { fields: fields, servingSize: servingSize, matchedCount: matchedCount, rawText: text };
  }

  // Runs the whole pipeline on a File (from a file-picker/camera input) and
  // resolves to { ok:true, fields, servingSize, matchedCount, rawText } or
  // { ok:false, error }. onStatus(text) is called with progress updates
  // along the way; never rejects, so callers don't need a .catch.
  function scanNutritionLabel(file, onStatus) {
    const status = typeof onStatus === "function" ? onStatus : function () {};
    if (!file) return Promise.resolve({ ok: false, error: "No photo selected." });
    return fileToImage(file)
      .then(function (img) {
        status("Preparing the photo…");
        return imageToScaledCanvas(img);
      })
      .then(function (canvas) {
        return ensureWorker(status).then(function (worker) {
          status("Reading the label…");
          return worker.recognize(canvas);
        });
      })
      .then(function (result) {
        const text = result && result.data ? result.data.text : "";
        const parsed = parseNutritionLabelText(text);
        if (parsed.matchedCount === 0) {
          return { ok: false, error: "Couldn't find any recognizable Nutrition Facts on that photo — try a straighter, well-lit shot of just the label, or enter the numbers by hand." };
        }
        return Object.assign({ ok: true }, parsed);
      })
      .catch(function (err) {
        return { ok: false, error: "Couldn't scan that photo: " + (err && err.message ? err.message : String(err)) };
      });
  }

  window.JarvisLabelScan = {
    scanNutritionLabel: scanNutritionLabel,
    parseNutritionLabelText: parseNutritionLabelText // exposed for testing
  };
})();
