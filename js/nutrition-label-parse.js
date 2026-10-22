/* ==========================================================================
   JARVIS — Nutrition label text parser

   Turns the raw text an OCR engine read off a Nutrition Facts panel into the
   numbers Jarvis tracks. Pure functions: no browser objects, no network, so
   every rule here can be tested with plain strings (functions/test/
   label-parse.test.js) and js/nutrition-label-scan.js just feeds it text.

   OCR reads small label type imperfectly, and the mistakes are predictable:
     - a printed 0 comes out as the letter O ("Og", "Omg", "Omcg")
     - a printed 1 comes out as l or I
     - the unit g comes out as 9 or q ("2.5g" -> "2.59"), mg as "rng"
     - a big number gets split by a space ("Calories 2 10" for 210)
   Each of these is tolerated, but a value read that way is reported in
   `uncertain` so the page can say "check these". Nothing is ever invented:
   a field with no matching line in the text is simply left out, never
   defaulted to 0.

   Labels with two columns (per 100 g | per serving, or per serving | per
   container) are read by the order of their column headings, so the
   per-serving number is taken, not whichever comes first.

   Plausibility checks never change a number. They only produce `warnings`
   (for example, calories that don't fit the fat, carbs and protein read).

   Mangled label words ("Calorigg", "Tota] Fat") are matched loosely, but only
   at the start of a line, so a stray word elsewhere can't be taken for a
   nutrient. A line's printed % Daily Value is an independent check on its
   amount: when they disagree, the amount is flagged, and when only a lost
   decimal point explains it ("15g" beside "2%" fits only 1.5g) the value is
   corrected and the correction is reported, never made silently.

   Scaling: a label's numbers are for ITS serving ("1 container (170g)"). When
   you log a different amount ("250g"), every number is multiplied by
   250 / 170. Only a plain weight or volume you typed with a unit counts
   (g, ml, oz, fl oz); a bare "250" or "1 cup" is never guessed at, and grams
   are never compared with millilitres. scalingPlan() says whether it can be
   done and, if not, why, so the page can tell you instead of staying quiet.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisLabelParse = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Letters OCR commonly reads in place of "i", and in place of the digits 0 and 1.
  const I = "[il1]";
  const ZERO_LIKE = "Oo";
  const ONE_LIKE = "Il|";
  const DIGITS = "[0-9" + ZERO_LIKE + ONE_LIKE + "]";
  // One amount: 1-4 digits, optionally one or two decimals, then the unit. Units are tried exactly first;
  // the look-alike spellings only matter when the exact one isn't there (the regex engine tries them in order).
  // Spaces are allowed before a unit made of real letters, but a look-alike that is a DIGIT (9) must touch
  // the number and not run into more digits or a % sign: in "24g 9%", the 9 belongs to the percent column.
  // A stray ¢ or © right after the number is the engine's debris next to the unit ("5¢g", "2.5¢9"); a lone ¢ is a g.
  const UNITS = {
    g: "[¢©]?\\s*g|[¢©]?[q9](?![0-9%])|¢(?![0-9%a-z])",
    mg: "[¢©]?\\s*(?:mg|rng|mq)|[¢©]?m9(?![0-9%])",
    mcg: "[¢©]?\\s*(?:mcg|mcq|rncg|rncq|meg|mog|µg|ug)|[¢©]?mc9(?![0-9%])"
  };
  const EXACT = { g: "g", mg: "mg", mcg: "(?:mcg|µg|ug)" };

  // Highest value that could really be on one serving's label; anything above is a misread, not a fact.
  const LIMITS = { calories: 2500, fat: 150, sodium: 6000, carbs: 300, fiber: 80, protein: 150, vitaminD: 200, calcium: 3000, iron: 100, potassium: 6000, vitaminC: 1500 };

  // What 100% Daily Value is for each nutrient: the current US label first, then the older one still found on packs.
  // slack is how far a printed amount can be from the real one because of rounding.
  const DV = {
    fat: { basis: [78, 65], slack: 0.5, decimals: true },
    sodium: { basis: [2300, 2400], slack: 5, decimals: false },
    carbs: { basis: [275, 300], slack: 0.5, decimals: true },
    fiber: { basis: [28, 25], slack: 0.5, decimals: true },
    vitaminD: { basis: [20, 10], slack: 0.5, decimals: true },
    calcium: { basis: [1300, 1000], slack: 10, decimals: false },
    iron: { basis: [18], slack: 0.5, decimals: true },
    potassium: { basis: [4700, 3500], slack: 10, decimals: false },
    vitaminC: { basis: [90, 60], slack: 0.5, decimals: true }
  };

  // Does a printed % Daily Value fit this amount? (Either label's basis may fit; one point of rounding is allowed.)
  function dvFits(key, value, pct) {
    const d = DV[key];
    if (!d || pct === null || pct === undefined) return true;
    const slack = Math.max(d.slack, 0.1 * value);
    return d.basis.some(function (b) {
      return pct >= (value - slack) / b * 100 - 1 && pct <= (value + slack) / b * 100 + 1;
    });
  }

  // Loose matching of a label word, for text the camera angle has mangled. A name is only matched by its
  // whole spelling within a small edit distance; the vitamins are left out (C and D differ by one letter).
  const LABEL_VARIANTS = {
    calories: ["calories"], fat: ["totalfat"], sodium: ["sodium"],
    carbs: ["totalcarbohydrate", "totalcarbohydrates", "totalcarbs", "carbohydrate", "carbohydrates"],
    fiber: ["dietaryfiber", "fiber"], protein: ["protein"], calcium: ["calcium"], iron: ["iron"], potassium: ["potassium"]
  };
  const distLimit = function (len) { return len <= 7 ? 1 : len <= 11 ? 2 : 3; };

  // Edit distance where swapping two neighbouring letters ("protien") counts as one edit.
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  // label: what the line starts with. unit: what its amount is measured in (null: calories, a bare number).
  const FIELDS = [
    { key: "calories", label: "cal" + I + "?or" + I + "es(?!\\s*from)", unit: null },
    { key: "fat", label: "total\\s*fat", unit: "g" },
    { key: "sodium", label: "sod" + I + "um", unit: "mg" },
    { key: "carbs", label: "total\\s*carb(?:ohydrate)?s?\\.?|carbohydrates?|carbs", unit: "g" },
    { key: "fiber", label: "(?:d" + I + "etary\\s*)?f" + I + "bers?", unit: "g" },
    { key: "protein", label: "prote" + I + "n", unit: "g" },
    { key: "vitaminD", label: "v" + I + "tam" + I + "n\\s*d", unit: "mcg" },
    { key: "calcium", label: "calc" + I + "um", unit: "mg" },
    { key: "iron", label: "(?:\\b|^)" + I + "ron", unit: "mg" },
    { key: "potassium", label: "potass" + I + "um", unit: "mg" },
    { key: "vitaminC", label: "v" + I + "tam" + I + "n\\s*c", unit: "mg" }
  ];

  function toNumber(token) {
    const clean = String(token)
      .replace(new RegExp("[" + ZERO_LIKE + "]", "g"), "0")
      .replace(new RegExp("[" + ONE_LIKE.replace("|", "\\|") + "]", "g"), "1")
      .replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(clean)) return null;
    const n = Number(clean);
    return isFinite(n) ? n : null;
  }

  // Letters standing in for digits make a reading less certain. A lone O before a unit ("Og", "Omg") is
  // how a printed 0 almost always comes out, so that alone isn't worth a warning.
  function hadLookalike(token) { return /[A-Za-z|]/.test(token) && !/^[Oo]$/.test(token); }

  // The amounts on one stretch of text, left to right: [{ value, uncertain }].
  function amountsIn(segment, unit) {
    const out = [];
    // The number must start cleanly (not in the middle of a longer run of digits), or the tail of an
    // impossibly long number such as "90000mg" would be read as "0000mg", a false zero.
    const re = new RegExp("(?:^|[^0-9" + ZERO_LIKE + ONE_LIKE.replace("|", "\\|") + ".,])(" + DIGITS + "{1,4}(?:[.,]" + DIGITS + "{1,2})?)(" + UNITS[unit] + ")(?![a-z])", "gi");
    let m;
    while ((m = re.exec(segment)) !== null) {
      const value = toNumber(m[1]);
      if (value === null) continue;
      const exact = new RegExp("^(?:" + EXACT[unit] + ")$", "i").test(m[2].replace(/\s/g, ""));
      out.push({ value: value, uncertain: !exact || hadLookalike(m[1]), end: m.index + m[0].length });
    }
    return out;
  }

  // Calories are a bare number, often printed large enough that OCR splits it ("2 10"). Gives every sensible
  // reading, most likely first: the joined number, then the first piece.
  function calorieCandidates(segment, column) {
    const m = segment.match(new RegExp("^[\\s:.\\-]*(" + DIGITS + "{1,4})(?:[ \\t]{1,2}(" + DIGITS + "{1,3}))?(?![\\w%])(?:[ \\t]+(" + DIGITS + "{1,4}))?", "i"));
    if (!m) return [];
    const first = toNumber(m[1]);
    // The label has two columns, so two numbers mean two columns, not one split number.
    if (column !== null) {
      // The second column's number. A line with only one number can't be placed in a column, so it isn't guessed at.
      const pick = column === 1 ? (m[2] !== undefined ? toNumber(m[2]) : (m[3] !== undefined ? toNumber(m[3]) : null)) : first;
      return pick !== null && pick <= LIMITS.calories ? [{ value: pick, uncertain: hadLookalike(m[1]) }] : [];
    }
    const joined = m[2] !== undefined ? toNumber(m[1] + m[2]) : null;
    const next = m[2] !== undefined ? toNumber(m[2]) : null;
    const list = [];
    [joined, first, next].forEach(function (v) { if (v !== null && v <= LIMITS.calories && list.indexOf(v) === -1) list.push(v); });
    return list.map(function (v) { return { value: v, uncertain: hadLookalike(m[1]) || (joined !== null && v === joined) }; });
  }

  // Which column holds "per serving" when the label has two (per 100 g | per serving, per serving | per container).
  // 0 means the first number on a line, 1 the second. null: a single column, so the first number.
  // Only a heading row counts, with both terms on the same line. "12 servings per container" and
  // "Amount per serving" are on separate lines of every ordinary label and say nothing about columns.
  function servingColumn(text) {
    const gap = "[^\\n]{0,40}";
    const per100 = "per\\s*100\\s*(?:g|ml)\\b";
    const serv = "per\\s*serv";
    const cont = "per\\s*(?:container|package|pack)\\b";
    const has = function (first, second) { return new RegExp(first + gap + second, "i").test(text); };
    if (has(per100, serv)) return 1;
    if (has(serv, per100)) return 0;
    if (has(serv, cont)) return 0;
    if (has(cont, serv)) return 1;
    return null;
  }

  // Every line that starts a given field, as the stretch of text after its name, best candidates first.
  function segmentsFor(text, field) {
    const re = new RegExp("(?:" + field.label + ")", "gi");
    const segs = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      // "Saturated Fat" / "Trans Fat" lines are not Total Fat; a bare "Fat" is only accepted below.
      const rest = text.slice(m.index + m[0].length);
      if (field.key === "calories") {
        // The footnote "...2,000 calories a day..." is not the product's calories.
        if (/\d[\d,.]*\s*$/.test(text.slice(Math.max(0, m.index - 14), m.index))) continue;
        if (/^\s*(?:a|per|each)\s+day/i.test(rest)) continue;
      }
      const line = rest.split("\n")[0];
      // A value can sit on the next line when the name wraps; take the first two lines then.
      segs.push(line.trim() === "" || !/\d|[Oo]/.test(line) ? rest.split("\n").slice(0, 2).join(" ") : line);
    }
    return segs;
  }

  // A plain "Fat 8g" line, for labels that don't say "Total": skips saturated, trans and other sub-lines.
  function bareFatSegments(text) {
    const segs = [];
    const re = /\bfat\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      if (/(saturated|sat\.?|trans|poly\w*|mono\w*|unsat\w*|total|low|non|reduced|fat-?free|\bcal\w*)\s*[-:.]*\s*$/.test(before)) continue;
      // The word just before may be one of those, mangled ("Saturateq Fat", "Tota] Fat").
      const prev = (text.slice(0, m.index).match(/([^\s]+)\s*$/) || ["", ""])[1].toLowerCase().replace(/[^a-z]/g, "");
      if (prev.length >= 3 && ["saturated", "trans", "polyunsaturated", "monounsaturated", "unsaturated", "total"].some(function (w) { return editDistance(prev, w) <= (w.length <= 5 ? 1 : 2); })) continue;
      segs.push(text.slice(m.index + m[0].length).split("\n")[0]);
    }
    return segs;
  }

  // Lines that START with a mangled spelling of the field's name, as the text after it. Only used when no exact
  // spelling gave a value. The value must follow the name (a digit-like character next), so a stray word can't match.
  function fuzzySegments(text, key) {
    const variants = LABEL_VARIANTS[key];
    if (!variants) return [];
    const lines = text.split("\n");
    const segs = [];
    lines.forEach(function (line, idx) {
      line.split(/\s*[\u2022\u00b7|]\s*/).forEach(function (piece) {
        const tokens = piece.replace(/^[^A-Za-z0-9]+/, "").split(" ").filter(Boolean);
        for (let n = 1; n <= 3 && n <= tokens.length; n++) {
          const word = tokens.slice(0, n).join("").toLowerCase().replace(/[^a-z]/g, "");
          if (word.length < 4) continue;
          const hit = variants.some(function (v) { return editDistance(word, v) <= distLimit(v.length); });
          if (!hit) continue;
          let rest = tokens.slice(n).join(" ");
          if (rest.trim() === "" && lines[idx + 1]) rest = lines[idx + 1];
          if (/^[^A-Za-z0-9]{0,3}[0-9OoIl|]/.test(rest)) { segs.push(rest); break; }
        }
      });
    });
    return segs;
  }

  function pickAmount(amounts, column) {
    if (!amounts.length) return null;
    // Second column wanted but only one amount readable: it could be either column, so it isn't used.
    if (column === 1) return amounts.length > 1 ? amounts[1] : null;
    return amounts[0];
  }

  function atwater(f) {
    if (f.fat === undefined || f.carbs === undefined || f.protein === undefined) return null;
    return 9 * f.fat + 4 * f.carbs + 4 * f.protein;
  }

  // calories should roughly equal 9*fat + 4*carbs + 4*protein. Labels round and count fiber loosely, so the
  // tolerance is generous; it only exists to catch a number that was plainly misread.
  function calorieMismatch(calories, expected) {
    return Math.abs(calories - expected) > Math.max(45, 0.3 * expected);
  }

  const NAMES = { calories: "calories", fat: "fat", sodium: "sodium", carbs: "carbs", fiber: "fiber", protein: "protein", vitaminD: "vitamin D", calcium: "calcium", iron: "iron", potassium: "potassium", vitaminC: "vitamin C" };
  const MAIN = ["calories", "fat", "carbs", "protein"];

  const UNIT_OF = { fat: "g", carbs: "g", fiber: "g", sodium: "mg", calcium: "mg", iron: "mg", potassium: "mg", vitaminC: "mg", vitaminD: "mcg" };

  // Sanity checks on a set of fields. Never changes a number: only says which ones to double-check, and why.
  // dvs: the % Daily Value printed beside each amount, when it was read.
  function checkFields(fields, dvs) {
    const warnings = [];
    const uncertain = [];
    const bad = [];
    Object.keys(dvs || {}).forEach(function (k) {
      if (fields[k] !== undefined && !dvFits(k, fields[k], dvs[k])) bad.push(k);
    });
    bad.slice(0, 3).forEach(function (k) {
      warnings.push(NAMES[k].charAt(0).toUpperCase() + NAMES[k].slice(1) + " (" + fields[k] + UNIT_OF[k] + ") doesn't match the " + dvs[k] + "% Daily Value printed beside it. One of them may be misread.");
    });
    if (bad.length > 3) warnings.push(bad.length - 3 + " more amounts don't match their printed Daily Values.");
    bad.forEach(function (k) { uncertain.push(k); });
    const expected = atwater(fields);
    if (fields.calories !== undefined && expected !== null && calorieMismatch(fields.calories, expected)) {
      warnings.push("Calories (" + fields.calories + ") don't fit the fat, carbs and protein that were read (about " + Math.round(expected) + "). One of them may be misread.");
      uncertain.push("calories");
    }
    if (fields.fiber !== undefined && fields.carbs !== undefined && fields.fiber > fields.carbs) {
      warnings.push("Fiber (" + fields.fiber + "g) is more than total carbs (" + fields.carbs + "g). One of them may be misread.");
      uncertain.push("fiber", "carbs");
    }
    return { warnings: warnings, uncertain: uncertain };
  }

  // Parses raw OCR text into whichever tracked fields it can find.
  //   -> { fields, uncertain[], warnings[], missing[], servingSize, matchedCount, rawText }
  function parseNutritionLabelText(rawText) {
    const text = String(rawText || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
    const column = servingColumn(text);
    const fields = {};
    const uncertain = [];
    const dvs = {};
    const repairs = [];
    let calorieOptions = [];

    // Tries the segments (the text after a field's name) in order; the first that gives a value wins.
    function read(field, segs) {
      for (let i = 0; i < segs.length; i++) {
        if (field.key === "calories") {
          const cands = calorieCandidates(segs[i], column);
          if (cands.length) { calorieOptions = cands; return true; }
          continue;
        }
        const pick = pickAmount(amountsIn(segs[i], field.unit), column);
        if (pick && pick.value <= LIMITS[field.key]) {
          let value = pick.value;
          let doubtful = pick.uncertain;
          // The Daily Value printed after the amount (single-column labels only).
          const dvMatch = column === null && DV[field.key] ? segs[i].slice(pick.end).match(/^\s{0,3}(\d{1,3}|[Oo])\s*%/) : null;
          const pct = dvMatch ? toNumber(dvMatch[1]) : null;
          if (pct !== null) dvs[field.key] = pct;
          // A lost decimal point: "15g" beside "2%" only fits 1.5g.
          if (pct !== null && DV[field.key].decimals && value >= 10 && !dvFits(field.key, value, pct) && dvFits(field.key, value / 10, pct)) {
            repairs.push(NAMES[field.key].charAt(0).toUpperCase() + NAMES[field.key].slice(1) + ": read " + value + UNIT_OF[field.key] + ", but the " + pct + "% Daily Value printed beside it only fits " + value / 10 + UNIT_OF[field.key] + ", so " + value / 10 + UNIT_OF[field.key] + " is used.");
            value = value / 10;
            doubtful = true;
          }
          fields[field.key] = value;
          if (doubtful) uncertain.push(field.key);
          return true;
        }
      }
      return false;
    }

    FIELDS.forEach(function (field) {
      let segs = segmentsFor(text, field);
      if (!read(field, segs)) {
        // No exact spelling gave a value: try a mangled one at the start of a line. Anything read that way is doubtful.
        const before = field.key === "calories" ? calorieOptions.length : fields[field.key] !== undefined;
        read(field, fuzzySegments(text, field.key));
        const after = field.key === "calories" ? calorieOptions.length : fields[field.key] !== undefined;
        if (!before && after) {
          if (field.key === "calories") calorieOptions = calorieOptions.map(function (o) { return { value: o.value, uncertain: true }; });
          else if (uncertain.indexOf(field.key) === -1) uncertain.push(field.key);
        }
        // Labels that just say "Fat" (not "Total Fat"): the last resort, and always worth a look.
        if (field.key === "fat" && fields.fat === undefined && read(field, bareFatSegments(text)) && uncertain.indexOf("fat") === -1) uncertain.push("fat");
      }
    });

    // Calories: when the macros are known, the reading that fits them best wins; otherwise the joined number.
    if (calorieOptions.length) {
      let chosen = calorieOptions[0];
      const expected = atwater(fields);
      if (expected !== null && calorieOptions.length > 1) {
        chosen = calorieOptions.slice().sort(function (a, b) { return Math.abs(a.value - expected) - Math.abs(b.value - expected); })[0];
      }
      fields.calories = chosen.value;
      if (chosen.uncertain) uncertain.push("calories");
    }

    const check = checkFields(fields, dvs);
    check.uncertain.forEach(function (k) { if (uncertain.indexOf(k) === -1) uncertain.push(k); });
    const warnings = repairs.concat(check.warnings);

    const servingMatch = text.match(new RegExp("serv" + I + "ng\\s*s" + I + "ze[\\s:.\\-]*?([^\\n]{1,40})", "i"));
    // A serving written "(45g)" can come out "(459)": a bare number in brackets is a weight whose g was misread.
    const servingSize = servingMatch ? servingMatch[1].trim().replace(/[.\s]+$/, "").replace(/\((\d{1,4}(?:\.\d)?)9\)/, "($1g)") : null;
    const missing = MAIN.filter(function (k) { return fields[k] === undefined; });
    return { fields: fields, uncertain: uncertain, warnings: warnings, dvs: dvs, missing: missing, servingSize: servingSize, matchedCount: Object.keys(fields).length, rawText: text };
  }

  /* ---------------- scaling to the amount you actually eat ---------------- */

  const OZ_TO_G = 28.3495;
  const FL_OZ_TO_ML = 29.5735;
  const MIN_FACTOR = 0.01;
  const MAX_FACTOR = 100;
  // Decimal places kept after scaling (whole numbers for calories and the larger minerals).
  const DECIMALS = { calories: 0, sodium: 0, calcium: 0, potassium: 0, fat: 1, carbs: 1, fiber: 1, protein: 1, iron: 1, vitaminC: 1, vitaminD: 1 };

  // A weight or volume written in text: "250g", "250 g", "1 cup (240 mL)", "6 oz (170g)", "8 fl oz".
  // -> { value, unit: "g" | "ml" } in grams or millilitres, or null when there isn't one.
  // A metric amount in brackets wins ("6 oz (170g)" is 170 g), then any metric amount, then ounces.
  function parseAmount(text) {
    const t = String(text === undefined || text === null ? "" : text).replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2");
    let m = t.match(/\(\s*(\d+(?:\.\d+)?)\s*(g|grams?|ml|millilit(?:er|re)s?)\s*\)/i);
    if (!m) m = t.match(/(\d+(?:\.\d+)?)\s*(g|grams?|ml|millilit(?:er|re)s?)(?![a-z])/i);
    if (m) {
      const value = Number(m[1]);
      return value > 0 ? { value: value, unit: /^g/i.test(m[2]) ? "g" : "ml" } : null;
    }
    m = t.match(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz)(?![a-z])/i);
    if (m) {
      const value = Number(m[1]);
      if (!(value > 0)) return null;
      return /fl/i.test(m[2]) ? { value: value * FL_OZ_TO_ML, unit: "ml" } : { value: value * OZ_TO_G, unit: "g" };
    }
    return null;
  }

  // Can the label's numbers be scaled to the amount you typed? -> { ok, factor, label, mine } or { ok: false, reason }
  //   reason: "no-amount" (you haven't typed a weight or volume), "no-label" (the label's serving couldn't be read),
  //           "units" (grams on one side, millilitres on the other), "range" (the two differ absurdly, so one is a misread)
  function scalingPlan(labelServingText, myAmountText) {
    const mine = parseAmount(myAmountText);
    if (!mine) return { ok: false, reason: "no-amount" };
    const label = parseAmount(labelServingText);
    if (!label) return { ok: false, reason: "no-label", mine: mine };
    if (label.unit !== mine.unit) return { ok: false, reason: "units", label: label, mine: mine };
    const factor = mine.value / label.value;
    if (!(factor >= MIN_FACTOR && factor <= MAX_FACTOR)) return { ok: false, reason: "range", label: label, mine: mine, factor: factor };
    return { ok: true, factor: factor, label: label, mine: mine };
  }

  // The label's numbers multiplied by factor and rounded the way the form shows them. Never invents a field.
  function scaleFields(fields, factor) {
    const out = {};
    Object.keys(fields || {}).forEach(function (k) {
      const v = fields[k];
      if (typeof v !== "number" || !isFinite(v)) return;
      const places = DECIMALS[k] === undefined ? 1 : DECIMALS[k];
      const f = Math.pow(10, places);
      out[k] = Math.round(v * factor * f) / f;
    });
    return out;
  }

  return { parseAmount: parseAmount, scalingPlan: scalingPlan, scaleFields: scaleFields, parseNutritionLabelText: parseNutritionLabelText, checkFields: checkFields, FIELDS: FIELDS, NAMES: NAMES, MAIN: MAIN, LIMITS: LIMITS };
});
