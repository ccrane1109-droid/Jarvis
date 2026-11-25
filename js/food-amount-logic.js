/* ==========================================================================
   JARVIS — Food amounts: serving maths, portions, and recipe totals.

   Pure functions (no browser objects), tested in functions/test/food-amount-logic.test.js. The scanner, the food log and Meal Prep all
   work out "how much of this food" through here, so there is one set of rules.

   THE LABEL IS THE BASELINE. A food keeps what its label says: a serving (text like "2/3 cup (55g)" and, when it has one, a weight or
   volume: 55 g) and the numbers for that serving. Every amount you enter is worked out from that baseline, once, and rounded only
   when it is shown or logged. A number that has already been scaled is never scaled again, so a recipe of twenty ingredients or a food
   re-logged a hundred times has the same error as one (none beyond the last digit shown).

   GRAMS ARE NOT MILLILITRES. A label in grams can be entered in grams, ounces or servings. A label in millilitres can be entered in
   millilitres, fluid ounces or servings. The two are never converted into each other (that needs the density of the food, which
   nothing here knows); asking for it gives a plain reason instead of a number. A food whose label has no weight or volume at all
   ("1 cookie") can only be entered in servings.

   Nothing is invented: a food with no usable baseline has no equivalents to show, and a missing number stays missing.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./nutrition-label-parse.js"));
  else root.JarvisFoodAmount = factory(root.JarvisLabelParse);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";

  const G_PER_OZ = 28.349523125, G_PER_LB = 453.59237, ML_PER_FLOZ = 29.5735295625;
  // kind: what the unit measures. per: how many grams / millilitres / servings one of it is.
  const UNITS = {
    g: { kind: "mass", per: 1, label: "g", long: "grams" },
    kg: { kind: "mass", per: 1000, label: "kg", long: "kilograms" },
    oz: { kind: "mass", per: G_PER_OZ, label: "oz", long: "ounces" },
    lb: { kind: "mass", per: G_PER_LB, label: "lb", long: "pounds" },
    ml: { kind: "volume", per: 1, label: "mL", long: "millilitres" },
    l: { kind: "volume", per: 1000, label: "L", long: "litres" },
    floz: { kind: "volume", per: ML_PER_FLOZ, label: "fl oz", long: "fluid ounces" },
    serving: { kind: "serving", per: 1, label: "serving", long: "servings" }
  };
  const MACROS = ["calories", "protein", "carbs", "fat", "fiber"];
  const MICROS = ["sodium", "calcium", "iron", "potassium", "vitaminC", "vitaminD"];
  const ALL_FIELDS = MACROS.concat(MICROS);
  const MAIN = ["calories", "protein", "carbs", "fat"];
  const MIN_FACTOR = 0.001, MAX_FACTOR = 1000;      // outside this an amount is a typing mistake, not a portion
  const UNUSUAL_LOW = 0.05, UNUSUAL_HIGH = 50;      // inside the limits but worth a second look
  const MAX_PORTIONS = 12;

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function round(n, places) { const f = Math.pow(10, places); return Math.round(n * f) / f; }
  function clean(n) { return round(n, 6); }             // takes floating-point dust off a result that is going to be compared or stored

  /* ---------------- reading what was typed ---------------- */

  // Unit words, as typed. "oz" next to "fl" is a volume.
  const UNIT_WORDS = [
    [/^(?:fl\.?\s*oz|floz|fluid\s*ounces?)$/i, "floz"], [/^(?:oz|ounces?)$/i, "oz"], [/^(?:lbs?|pounds?)$/i, "lb"],
    [/^(?:kg|kilograms?|kilos?)$/i, "kg"], [/^(?:g|gm|gms|grams?)$/i, "g"],
    [/^(?:ml|millilit(?:er|re)s?)$/i, "ml"], [/^(?:l|lit(?:er|re)s?)$/i, "l"],
    [/^(?:x|servings?|svgs?|srvs?|portions?)$/i, "serving"]
  ];
  const FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

  function unitFromWord(word) {
    const w = String(word || "").trim();
    for (let i = 0; i < UNIT_WORDS.length; i++) if (UNIT_WORDS[i][0].test(w)) return UNIT_WORDS[i][1];
    return null;
  }

  // The number at the start of a string: "1.5", "1,5", "1/2", "1 1/2", "½", "1½". -> { value, rest } or null.
  function leadingNumber(text) {
    const t = String(text).trim();
    let m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])\s*(.*)$/);
    if (m) return { value: Number(m[1]) + FRACTIONS[m[2]], rest: m[3] };
    m = t.match(/^([½¼¾⅓⅔⅛])\s*(.*)$/);
    if (m) return { value: FRACTIONS[m[1]], rest: m[2] };
    m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)(?!\d)\s*(.*)$/);
    if (m && Number(m[3]) > 0) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: m[4] };
    m = t.match(/^(\d+)\s*\/\s*(\d+)(?!\d)\s*(.*)$/);
    if (m && Number(m[2]) > 0) return { value: Number(m[1]) / Number(m[2]), rest: m[3] };
    m = t.match(/^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(.*)$/);
    if (m) return { value: Number(m[1].replace(",", ".")), rest: m[2] };
    return null;
  }

  // What someone typed into the amount box: "200", "200g", "6 oz", "8 fl oz", "1.5", "2 servings", "1/2". A bare number takes
  // defaultUnit (the unit chosen beside the box). -> { value, unit } | null (nothing usable) | { error: "unit" } (a number, but no unit to say what it is)
  function parseEntry(text, defaultUnit) {
    const lead = leadingNumber(text === undefined || text === null ? "" : String(text));
    if (!lead || !isFinite(lead.value) || lead.value <= 0 || lead.value > 100000) return null;
    const word = lead.rest.replace(/[.,;]+$/, "").trim();
    if (word) {
      const unit = unitFromWord(word);
      return unit ? { value: clean(lead.value), unit: unit } : null;
    }
    if (!defaultUnit || !UNITS[defaultUnit]) return { error: "unit" };
    return { value: clean(lead.value), unit: defaultUnit };
  }

  function unitLabel(unit, value) {
    const u = UNITS[unit];
    if (!u) return "";
    if (unit === "serving") return value === 1 ? "serving" : "servings";
    return u.label;
  }

  // "55 g", "1.5 servings", "8 fl oz", "250 mL" -- the amount as words, in the unit it was entered in.
  function describeEntry(entry) {
    if (!entry || !UNITS[entry.unit] || !isNum(entry.value)) return "";
    return String(round(entry.value, 2)) + " " + unitLabel(entry.unit, entry.value);
  }

  /* ---------------- the label baseline of a food ---------------- */

  function validSize(s) {
    return !!s && isNum(s.value) && s.value > 0 && s.value <= 100000 && (s.unit === "g" || s.unit === "ml");
  }

  // The weight or volume of one label serving: { value, unit: "g" | "ml", text, perContainer } or null when the label gives none.
  // Taken from the size the food was saved with (what you confirmed on the review screen), else read from the serving text
  // ("2/3 cup (55g)", "1 bottle (355 mL)"). The household measure ("2/3 cup") on its own is never turned into a weight.
  function baseOf(food) {
    if (!food) return null;
    const lab = food.label && typeof food.label === "object" ? food.label : null;
    if (lab) {
      const text = typeof lab.serving === "string" ? lab.serving : "";
      const per = isNum(lab.perContainer) && lab.perContainer > 0 ? lab.perContainer : null;
      if (validSize(lab.size)) return { value: lab.size.value, unit: lab.size.unit, text: text, perContainer: per };
      const a = text ? P.parseAmount(text) : null;
      if (a) return { value: a.value, unit: a.unit, text: text, perContainer: per };
    }
    // A food saved without a label: its own serving, when that is a weight or volume ("125g") and not a multiple ("1.6x 125g").
    const serving = String(food.serving || "");
    if (!lab && serving && !/^\s*[\d.]+\s*[x×]\s/i.test(serving)) {
      const a = P.parseAmount(serving);
      if (a) return { value: a.value, unit: a.unit, text: serving, perContainer: null };
    }
    return null;
  }

  // The numbers the baseline is for: the label's, else (a food saved without one) its own top-level numbers.
  function valuesOf(food) {
    if (!food) return {};
    const src = food.label && food.label.values && typeof food.label.values === "object" ? food.label.values : food;
    const out = {};
    ALL_FIELDS.forEach(function (k) { if (isNum(src[k]) && src[k] >= 0) out[k] = src[k]; });
    return out;
  }

  /* ---------------- an amount against the baseline ---------------- */

  // How many label servings an amount is. base from baseOf (or null). entry { value, unit }.
  //   -> { ok: true, factor, amount, unit, unusual } | { ok: false, reason }
  //   reason: "amount" (nothing usable), "unit" (not a unit this knows), "no-base" (the label gives no weight or volume, so only servings
  //   work), "units" (a weight against a volume, or the other way round: never converted), "range" (so large or small it is a mistake)
  function factorFor(base, entry) {
    if (!entry || !isNum(entry.value) || !(entry.value > 0)) return { ok: false, reason: "amount" };
    const u = UNITS[entry.unit];
    if (!u) return { ok: false, reason: "unit" };
    let factor, amount = null, unit = null;
    if (u.kind === "serving") factor = entry.value;
    else {
      if (!base) return { ok: false, reason: "no-base" };
      const want = base.unit === "g" ? "mass" : "volume";
      if (u.kind !== want) return { ok: false, reason: "units", label: base.unit, entered: u.kind };
      amount = entry.value * u.per;
      unit = base.unit;
      factor = amount / base.value;
    }
    if (!(factor >= MIN_FACTOR && factor <= MAX_FACTOR)) return { ok: false, reason: "range", factor: factor };
    return { ok: true, factor: factor, amount: amount === null ? null : clean(amount), unit: unit, unusual: factor < UNUSUAL_LOW || factor > UNUSUAL_HIGH };
  }

  // Which units can be used for this food, in the order to show them.
  function unitsFor(base) {
    if (!base) return ["serving"];
    return base.unit === "g" ? ["g", "oz", "serving"] : ["ml", "floz", "serving"];
  }

  // What an amount is in every other unit this food allows: [{ unit, value }], servings first.
  function equivalents(base, factor) {
    if (!isNum(factor) || !(factor > 0)) return [];
    const out = [{ unit: "serving", value: clean(factor) }];
    if (base) {
      const amount = factor * base.value;
      if (base.unit === "g") { out.push({ unit: "g", value: clean(amount) }); out.push({ unit: "oz", value: clean(amount / G_PER_OZ) }); }
      else { out.push({ unit: "ml", value: clean(amount) }); out.push({ unit: "floz", value: clean(amount / ML_PER_FLOZ) }); }
    }
    return out;
  }

  // The entry (same food, another unit) that is the same amount: 2 servings of a 55 g food in grams is 110 g. null when the unit isn't
  // allowed for the food. Used when the unit is switched, so the amount carries over instead of resetting.
  function convertEntry(base, entry, toUnit) {
    const f = factorFor(base, entry);
    if (!f.ok || !UNITS[toUnit]) return null;
    if (toUnit === "serving") return { value: clean(f.factor), unit: "serving" };
    if (!base) return null;
    const amount = f.factor * base.value;
    if (base.unit === "g" && UNITS[toUnit].kind === "mass") return { value: clean(amount / UNITS[toUnit].per), unit: toUnit };
    if (base.unit === "ml" && UNITS[toUnit].kind === "volume") return { value: clean(amount / UNITS[toUnit].per), unit: toUnit };
    return null;
  }

  // Display rounding: whole calories and minerals, one decimal for the rest.
  const DECIMALS = { calories: 0, sodium: 0, calcium: 0, potassium: 0, fat: 1, carbs: 1, fiber: 1, protein: 1, iron: 1, vitaminC: 1, vitaminD: 1 };
  function scaleExact(values, factor) {
    const out = {};
    Object.keys(values || {}).forEach(function (k) { if (isNum(values[k])) out[k] = values[k] * factor; });
    return out;
  }
  // Scaled from the baseline and rounded once. Never fed a value that was already scaled.
  function scaleRounded(values, factor) {
    const out = {};
    Object.keys(values || {}).forEach(function (k) {
      if (!isNum(values[k])) return;
      out[k] = round(values[k] * factor, DECIMALS[k] === undefined ? 1 : DECIMALS[k]);
    });
    return out;
  }

  /* ---------------- an amount of a food, worked out in one place ---------------- */

  function problemText(base, f) {
    if (f.reason === "amount") return "Enter an amount above 0.";
    if (f.reason === "unit") return "Pick a unit for the amount.";
    if (f.reason === "no-base") return "This food's label gives no weight or volume, so use servings.";
    if (f.reason === "units") return base && base.unit === "g"
      ? "This label is in grams, so use g, oz or servings. Grams and millilitres are never converted into each other."
      : "This label is in millilitres, so use mL, fl oz or servings. Grams and millilitres are never converted into each other.";
    return "That amount is too far from one serving to be right. Check it.";
  }

  // The words a logged entry carries for an amount: "55 g", "3 oz (85 g)", "1.5x 2/3 cup (55g)", or the label's serving for exactly one.
  function servingText(food, base, entry, f) {
    const per = String((food && food.label && food.label.serving) || (food && food.serving) || "").replace(/\s+/g, " ").trim();
    if (entry.unit === "serving") {
      const n = round(entry.value, 2);
      if (!per) return n === 1 ? "1 serving" : n + " servings";
      return n === 1 ? per : n + "x " + per;
    }
    let text = describeEntry(entry);
    if ((entry.unit === "oz" || entry.unit === "floz") && base && isNum(f.amount)) text += " (" + round(f.amount, f.amount < 100 ? 1 : 0) + " " + (base.unit === "g" ? "g" : "mL") + ")";
    return text;
  }

  // Everything about an amount of a food: how many label servings it is, its numbers (exact, and rounded once for showing),
  // the words for the log, and the same amount in the other units. food: a saved food, a logged entry or a recipe made into one.
  //   -> { ok, factor, unusual, base, exact, values, serving, equivalents } | { ok: false, reason, message }
  function compute(food, entry) {
    const base = baseOf(food), f = factorFor(base, entry);
    if (!f.ok) return { ok: false, reason: f.reason, message: problemText(base, f) };
    const vals = valuesOf(food);
    return {
      ok: true, factor: f.factor, unusual: f.unusual, base: base, exact: scaleExact(vals, f.factor), values: scaleRounded(vals, f.factor),
      serving: servingText(food, base, entry, f), equivalents: equivalents(base, f.factor)
    };
  }

  // The label baseline as it is stored: { serving, values, size?, perContainer? }, or null when it is not a serving with numbers.
  // Anything that is not a usable number is left out; nothing is filled in.
  function cleanLabel(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.serving !== "string" || !raw.values || typeof raw.values !== "object") return null;
    const values = {};
    ALL_FIELDS.forEach(function (k) { const v = raw.values[k]; if (isNum(v) && v >= 0) values[k] = v; });
    if (!Object.keys(values).length) return null;
    const out = { serving: raw.serving.slice(0, 60), values: values };
    if (validSize(raw.size)) out.size = { value: raw.size.value, unit: raw.size.unit };
    if (isNum(raw.perContainer) && raw.perContainer > 0 && raw.perContainer <= 200) out.perContainer = raw.perContainer;
    return out;
  }

  /* ---------------- portions ---------------- */

  function cleanName(s) { return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 30); }

  // Is an amount in this unit possible for the food's baseline?
  function unitAllowed(base, unit) { return !!UNITS[unit] && unitsFor(base).indexOf(unit) !== -1; }

  function cleanEntry(raw) {
    if (!raw || typeof raw !== "object" || !UNITS[raw.unit] || !isNum(raw.value) || !(raw.value > 0) || raw.value > 100000) return null;
    return { unit: raw.unit, value: clean(raw.value) };
  }

  // What to storage-clean: a food's saved portions ([{ id, name, unit, value }]), its last portion and its default.
  function cleanPortions(raw) {
    const out = [], seen = {};
    (Array.isArray(raw) ? raw : []).forEach(function (p) {
      const e = cleanEntry(p), name = cleanName(p && p.name), id = p && typeof p.id === "string" ? p.id.slice(0, 40) : "";
      if (!e || !name || !id || seen[id] || out.length >= MAX_PORTIONS) return;
      seen[id] = true;
      out.push({ id: id, name: name, unit: e.unit, value: e.value });
    });
    return out;
  }

  // The amount to offer first for a food: your default portion, else the last amount you used, else one serving.
  // A remembered amount in a unit the food no longer allows (its label changed) is skipped, never converted by guessing.
  function suggestEntry(food) {
    const base = baseOf(food);
    const portions = cleanPortions(food && food.portions);
    const dflt = food && food.defaultPortionId ? portions.filter(function (p) { return p.id === food.defaultPortionId; })[0] : null;
    if (dflt && unitAllowed(base, dflt.unit)) return { value: dflt.value, unit: dflt.unit, from: "default", name: dflt.name };
    const last = cleanEntry(food && food.lastPortion);
    if (last && unitAllowed(base, last.unit)) return { value: last.value, unit: last.unit, from: "last" };
    return { value: 1, unit: "serving", from: "serving" };
  }

  // What to remember after logging an amount: { lastPortion, lastUsedAt, useCount }.
  function afterUse(food, entry, now) {
    const e = cleanEntry(entry);
    const out = { lastUsedAt: isNum(now) ? now : Date.now(), useCount: (isNum(food && food.useCount) && food.useCount > 0 ? Math.floor(food.useCount) : 0) + 1 };
    if (e) out.lastPortion = e;
    return out;
  }

  // Adds a named portion to a food. input { name, value, unit }, makeId() -> a new id. -> { ok, portions, id } | { ok: false, error }
  function addPortion(food, input, makeId) {
    const base = baseOf(food), e = cleanEntry(input), name = cleanName(input && input.name);
    if (!name) return { ok: false, error: "Give the portion a name, like “my bowl”." };
    if (!e) return { ok: false, error: "Enter an amount above 0." };
    if (!unitAllowed(base, e.unit)) return { ok: false, error: e.unit === "serving" ? "That unit isn't available." : "This food's label is in " + (base ? (base.unit === "g" ? "grams" : "millilitres") : "servings only") + ", so use " + (base ? (base.unit === "g" ? "g, oz or servings" : "mL, fl oz or servings") : "servings") + "." };
    const have = cleanPortions(food && food.portions);
    if (have.length >= MAX_PORTIONS) return { ok: false, error: "A food can have up to " + MAX_PORTIONS + " portions. Remove one first." };
    const same = have.filter(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })[0];
    const id = same ? same.id : makeId();
    const next = same ? have.map(function (p) { return p.id === id ? { id: id, name: same.name, unit: e.unit, value: e.value } : p; }) : have.concat([{ id: id, name: name, unit: e.unit, value: e.value }]);
    return { ok: true, portions: next, id: id, replaced: !!same };
  }

  function removePortion(food, id) {
    const have = cleanPortions(food && food.portions);
    const next = have.filter(function (p) { return p.id !== id; });
    return { portions: next, defaultPortionId: food && food.defaultPortionId === id ? "" : (food && food.defaultPortionId) || "" };
  }

  /* ---------------- reviewing a scan ---------------- */

  const NAMES = { calories: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat", fiber: "Fiber", sodium: "Sodium", calcium: "Calcium", iron: "Iron", potassium: "Potassium", vitaminC: "Vitamin C", vitaminD: "Vitamin D" };

  // How sure each field of a scan is: { key: { state: "ok" | "unsure" | "missing", reason } }. Fields the label doesn't print in the
  // scan's text are "missing" (only the four main ones and fiber are reported; the others are optional and simply absent).
  function reviewState(parsed) {
    const out = {};
    const fields = (parsed && parsed.fields) || {}, unsure = (parsed && parsed.uncertain) || [];
    ALL_FIELDS.forEach(function (k) {
      if (fields[k] === undefined) {
        if (MAIN.indexOf(k) !== -1 || k === "fiber") out[k] = { state: "missing", reason: "Not read from the label. Enter it, or 0 if the label shows none." };
        return;
      }
      out[k] = unsure.indexOf(k) !== -1 ? { state: "unsure", reason: "Check this against the label." } : { state: "ok", reason: "" };
    });
    return out;
  }

  // Can the review go on? Needs a name and a number (0 counts) for calories, protein, carbs and fat. values: { name, calories, ... } as typed.
  // -> { ok, problems: ["Calories", ...] }
  function readyToContinue(values) {
    const v = values || {}, problems = [];
    if (!String(v.name || "").trim()) problems.push("Name");
    MAIN.forEach(function (k) {
      const raw = v[k];
      const n = raw === "" || raw === null || raw === undefined ? NaN : Number(raw);
      if (!(isFinite(n) && n >= 0)) problems.push(NAMES[k]);
    });
    return { ok: problems.length === 0, problems: problems };
  }

  /* ---------------- recipes ---------------- */

  // The label baseline an ingredient was made from ({ serving, size?, values }), as a "food" baseOf understands.
  function ingredientBase(ing) { return ing && ing.label ? baseOf({ label: ing.label }) : null; }

  // One ingredient's numbers, exact. An ingredient made from a food (it has its label and the amount used) is worked out from the label,
  // so changing the amount never scales numbers that were already rounded. Any other ingredient is its own numbers, as typed.
  function ingredientExact(ing) {
    const out = {};
    if (ing && ing.label && ing.label.values && ing.amount) {
      const f = factorFor(ingredientBase(ing), ing.amount);
      if (f.ok) { return Object.assign(out, scaleExact(valuesOf({ label: ing.label }), f.factor)); }
    }
    MACROS.forEach(function (k) { const n = ing ? Number(ing[k]) : NaN; if (isFinite(n) && n > 0) out[k] = n; });
    return out;
  }

  // The whole recipe, exact (nothing rounded): { totals, counted, uncounted } where uncounted names the ingredients with no numbers at all.
  function recipeExact(ingredients) {
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    let counted = 0;
    const uncounted = [];
    (ingredients || []).forEach(function (ing) {
      const x = ingredientExact(ing);
      const any = Object.keys(x).length > 0;
      MACROS.forEach(function (k) { if (x[k]) totals[k] += x[k]; });
      if (any) counted++; else uncounted.push((ing && ing.name) || "an ingredient");
    });
    return { totals: totals, counted: counted, uncounted: uncounted };
  }

  // The whole divided into portions: { calories, protein, carbs, fat, fiber } for one. portions: a whole number of 1 or more.
  function perPortion(totals, portions) {
    const n = Math.round(Number(portions));
    const d = n >= 1 ? n : 1;
    const out = {};
    MACROS.forEach(function (k) { out[k] = (totals && isNum(totals[k]) ? totals[k] : 0) / d; });
    return out;
  }
  function roundMacros(m) {
    const out = {};
    MACROS.forEach(function (k) { if (isNum(m && m[k])) out[k] = round(m[k], DECIMALS[k]); });
    return out;
  }

  // The quantity of each ingredient for the whole recipe and for one portion: [{ name, whole, each }] as text ("500 g", "125 g").
  // Worked out from the amount the ingredient was added with, or from a quantity typed with a unit ("2 oz"); a count ("2 eggs")
  // has no unit to divide, so its portion is left blank rather than guessed.
  function ingredientQuantities(ingredients, portions) {
    const n = Math.round(Number(portions)) >= 1 ? Math.round(Number(portions)) : 1;
    return (ingredients || []).map(function (ing) {
      const name = (ing && ing.name) || "";
      let entry = ing && ing.amount && UNITS[ing.amount.unit] ? cleanEntry(ing.amount) : null;
      // an amount in servings of a food whose label gives a weight or volume is shown as that weight or volume (2.5 servings of 40 g = 100 g)
      if (entry && entry.unit === "serving" && ing.label) {
        const b = ingredientBase(ing), conv = b ? convertEntry(b, entry, b.unit) : null;
        if (conv) entry = conv;
      }
      if (!entry && ing && ing.quantity) {
        const e = parseEntry(ing.quantity, null);
        entry = e && !e.error ? e : null;
      }
      if (!entry) return { name: name, whole: ing && ing.quantity ? String(ing.quantity) : "", each: "" };
      return { name: name, whole: describeEntry(entry), each: describeEntry({ unit: entry.unit, value: clean(entry.value / n) }) };
    });
  }

  // Grams in one portion when the finished dish weighs `cooked` grams and is divided into `portions`. null without a usable weight.
  function portionWeight(cooked, portions) {
    const w = Number(cooked), n = Math.round(Number(portions));
    if (!(isFinite(w) && w > 0) || !(n >= 1)) return null;
    return round(w / n, 1);
  }

  // How many portions an amount of the finished dish is, when one portion weighs `portionGrams`. Grams and ounces only (the weight is
  // a mass); anything else gives a reason. { ok, factor } | { ok: false, reason }
  function recipeFactor(portionGrams, entry) {
    if (!isNum(portionGrams) || !(portionGrams > 0)) return { ok: false, reason: "no-base" };
    return factorFor({ value: portionGrams, unit: "g" }, entry);
  }

  return {
    UNITS: UNITS, MACROS: MACROS, MICROS: MICROS, ALL_FIELDS: ALL_FIELDS, MAIN: MAIN, NAMES: NAMES, DECIMALS: DECIMALS, MAX_PORTIONS: MAX_PORTIONS,
    G_PER_OZ: G_PER_OZ, ML_PER_FLOZ: ML_PER_FLOZ,
    parseEntry: parseEntry, describeEntry: describeEntry, unitLabel: unitLabel, unitFromWord: unitFromWord,
    baseOf: baseOf, valuesOf: valuesOf, validSize: validSize, factorFor: factorFor, unitsFor: unitsFor, equivalents: equivalents, convertEntry: convertEntry,
    scaleExact: scaleExact, scaleRounded: scaleRounded, cleanEntry: cleanEntry, cleanPortions: cleanPortions, suggestEntry: suggestEntry, afterUse: afterUse,
    addPortion: addPortion, removePortion: removePortion, unitAllowed: unitAllowed,
    reviewState: reviewState, readyToContinue: readyToContinue,
    ingredientBase: ingredientBase, ingredientExact: ingredientExact, recipeExact: recipeExact, perPortion: perPortion, roundMacros: roundMacros,
    ingredientQuantities: ingredientQuantities, portionWeight: portionWeight, recipeFactor: recipeFactor,
    compute: compute, problemText: problemText, servingText: servingText, cleanLabel: cleanLabel
  };
});
