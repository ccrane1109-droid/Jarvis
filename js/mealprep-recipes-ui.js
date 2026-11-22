/* ==========================================================================
   JARVIS — Meal Prep › Recipes.

   Your recipe library: the same recipes Nutrition > Foods keeps (jarvisNutritionRecipes), shown with what Meal Prep adds to a recipe:
   categories (Breakfast, Lunch, Dinner, Snacks; "High-protein" is worked out from the numbers), favorites, preparation and cooking time,
   storage notes, and an optional picture. Search, edit, duplicate, favorite, delete (with Undo), add to the plan, and cook a batch.

   The numbers on an ingredient are for its whole amount; calories and macros per serving are always worked out (sum / servings).
   A number you did not type is marked "Estimated": it came from the typical-values list (mealprep-foods.js) or from the AI estimate that
   Nutrition already offers. Typing over it makes it yours.

   Also here: the portion calculator. Enter what you cooked, say whether each weight is raw or cooked, choose the number of portions, and
   it works out one portion. Raw and cooked weights are not the same food: 100 g of cooked rice is about a third of the rice 100 g
   of dry rice is, so the calculator asks, and converts with a typical yield when it has to.
   ========================================================================== */

(function () {
  "use strict";

  const MP = window.JarvisMealPrep;
  if (!MP) return;
  const k = MP.kit, L = k.L, esc = k.esc, F = window.JarvisMealPrepFoods;
  const FILTERS = [["all", "All"], ["favorites", "Favorites"], ["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snacks", "Snacks"], ["high-protein", "High-protein"]];
  const st = { q: "", cat: "all" };
  let pendingImage = null;          // while the recipe sheet is open: undefined = unchanged, "" = removed, data: URL = new

  const ICON_STAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  function perLine(r) {
    if (!L.hasNutrition(r)) return '<span class="mp-dim">No nutrition numbers yet</span>';
    const p = L.roundMacros(L.recipePer(r)), src = L.recipeSource(r);
    return esc(p.calories + " kcal · P " + Math.round(p.protein) + " g · C " + Math.round(p.carbs) + " g · F " + Math.round(p.fat) + " g per serving") + (src.kind === "estimated" || src.kind === "mixed" ? ' <em class="mp-est" title="Some numbers are estimates">est.</em>' : '');
  }
  function catNames(r) { return (r.cats || []).map(function (c) { return L.MEAL_LABELS[c]; }); }

  /* ---------------- the library ---------------- */

  function cardHtml(r) {
    const mins = L.totalMinutes(r), steps = String(r.instructions || "").split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
    const meta = [r.servings + " " + k.plural(r.servings, "serving")].concat(mins ? [(mins >= 60 ? Math.floor(mins / 60) + " h " + (mins % 60 ? mins % 60 + " min" : "") : mins + " min")] : [], catNames(r), L.isHighProtein(r) ? ["High-protein"] : []);
    let body = '<div class="mp-recipe-body">';
    if (r.image) body += '<img class="mp-recipe-img" src="' + esc(r.image) + '" alt="' + esc(r.name) + '">';
    body += '<h3 class="mp-h5">Ingredients</h3><ul class="mp-ings">' + (r.ingredients || []).map(function (i) { return '<li><span>' + esc(i.name) + (i.est ? ' <em class="mp-est">est.</em>' : '') + '</span><span>' + esc(i.quantity || "") + (i.state ? ' (' + esc(i.state) + ')' : '') + '</span></li>'; }).join("") + '</ul>';
    if (steps.length) body += '<h3 class="mp-h5">Steps</h3><ol class="mp-steps">' + steps.map(function (s) { return '<li>' + esc(s.replace(/^\d+[.)]\s*/, "")) + '</li>'; }).join("") + '</ol>';
    if (r.prepMin || r.cookMin) body += '<p class="mp-meal-line mp-dim">' + (r.prepMin ? 'Prep ' + r.prepMin + ' min' : '') + (r.prepMin && r.cookMin ? ' · ' : '') + (r.cookMin ? 'Cook ' + r.cookMin + ' min' : '') + '</p>';
    if (r.storage && (r.storage.place || r.storage.notes || r.storage.reheat)) body += '<h3 class="mp-h5">Storage</h3><p class="mp-meal-line">' + (r.storage.place ? esc({ fridge: "Keep in the refrigerator", freezer: "Keep in the freezer", both: "Refrigerator or freezer" }[r.storage.place]) + '. ' : '') + esc(r.storage.notes || "") + (r.storage.reheat ? ' <br>Reheat: ' + esc(r.storage.reheat) : '') + '</p>';
    body += '<div class="mp-actions"><button type="button" class="btn btn-primary" data-mp="recipes:plan" data-id="' + esc(r.id) + '">Add to plan</button>' +
      '<button type="button" class="btn btn-secondary" data-mp="recipes:batch" data-id="' + esc(r.id) + '">I cooked this</button>' +
      '<button type="button" class="btn btn-secondary" data-mp="recipes:edit" data-id="' + esc(r.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary" data-mp="recipes:dup" data-id="' + esc(r.id) + '">Duplicate</button>' +
      '<button type="button" class="btn btn-secondary danger" data-mp="recipes:delete" data-id="' + esc(r.id) + '">Delete</button></div></div>';
    return '<div class="mp-recipe"><button type="button" class="mp-fav' + (r.favorite ? ' is-on' : '') + '" data-mp="recipes:fav" data-id="' + esc(r.id) + '" aria-pressed="' + !!r.favorite + '" aria-label="' + esc("Favorite: " + r.name) + '">' + ICON_STAR + '</button>' +
      '<details class="mp-recipe-d" data-open-key="recipe:' + esc(r.id) + '"' + k.openAttr("recipe:" + r.id, false) + '><summary class="mp-recipe-sum">' +
      (r.image ? '<img class="mp-thumb" src="' + esc(r.image) + '" alt="">' : '') +
      '<span class="mp-recipe-main"><span class="mp-recipe-name">' + esc(r.name) + '</span><span class="mp-recipe-nums">' + perLine(r) + '</span><span class="mp-dim mp-recipe-meta">' + esc(meta.join(" · ")) + '</span></span></summary>' + body + '</details></div>';
  }

  function render() {
    const all = k.recipes().sort(function (a, b) { return a.name.localeCompare(b.name); });
    const shown = L.searchRecipes(all, st.q).filter(function (r) { return L.inCategory(r, st.cat); });
    let h = '<h2 class="mp-sr">Recipes</h2><div class="mp-toolbar mp-toolbar-wrap"><div class="mp-search"><label class="mp-sr" for="mpRecipeSearch">Search recipes</label><input type="search" id="mpRecipeSearch" data-mp="recipes:search" value="' + esc(st.q) + '" placeholder="Search recipes or ingredients" autocomplete="off"></div>' +
      '<button type="button" class="btn btn-primary" data-mp="recipes:new">+ New recipe</button><button type="button" class="btn btn-secondary" data-mp="recipes:calc">Portion calculator</button></div>';
    h += '<div class="mp-pills" role="group" aria-label="Filter recipes">' + FILTERS.map(function (f) {
      const n = all.filter(function (r) { return L.inCategory(r, f[0]); }).length;
      return '<button type="button" class="mp-pill' + (st.cat === f[0] ? ' is-on' : '') + '" aria-pressed="' + (st.cat === f[0]) + '" data-mp="recipes:cat" data-cat="' + f[0] + '">' + esc(f[1]) + ' <span class="mp-dim">' + n + '</span></button>';
    }).join("") + '</div>';
    h += '<div class="mp-recipes" id="mpRecipeList">' + (shown.length ? shown.map(cardHtml).join("") :
      '<div class="card mp-emptycard"><p>' + (all.length ? 'No recipes match.' : 'No recipes yet.') + '</p><p class="mp-dim">' + (all.length ? 'Try another search or filter.' : 'Save the meals you make often. Each one gets calories and protein per serving, adds to your week plan in a tap, and builds your grocery list.') + '</p>' + (all.length ? '' : '<button type="button" class="btn btn-primary" data-mp="recipes:new">+ New recipe</button>') + '</div>') + '</div>';
    h += '<p class="mp-foot">Recipes here are the same ones in Nutrition › Foods. Nutrition per serving is worked out from the ingredients. Numbers marked "est." are estimates.</p>';
    return h;
  }

  /* ---------------- the recipe form ---------------- */

  function ingRowHtml(i, n) {
    const A = k.A(), v = function (x) { return x ? esc(x) : ""; };
    return '<div class="mp-ing" data-est="' + (i.est ? 1 : 0) + '" data-fiber="' + (Number(i.fiber) || 0) + '">' +
      '<div class="mp-ing-h"><span class="mp-ing-n">Ingredient ' + n + (i.est ? ' <em class="mp-est">estimated</em>' : '') + '</span><button type="button" class="btn-icon danger" data-sheet-act="rm-ing" aria-label="Remove ingredient ' + n + '">&times;</button></div>' +
      '<div class="form-row"><label>Name<input type="text" class="mp-i-name" maxlength="80" value="' + v(i.name) + '" list="mpFoodNames" autocomplete="off" placeholder="e.g. Ground turkey"></label></div>' +
      '<div class="form-row two-col"><div><label>Amount<input type="text" class="mp-i-qty" maxlength="40" value="' + v(i.quantity) + '" placeholder="e.g. 500 g"></label></div>' +
      '<div><label>Weighed<select class="mp-i-state"><option value="">Usual</option><option value="raw"' + (i.state === "raw" ? " selected" : "") + '>Raw</option><option value="cooked"' + (i.state === "cooked" ? " selected" : "") + '>Cooked</option><option value="packaged"' + (i.state === "packaged" ? " selected" : "") + '>As packaged</option></select></label></div></div>' +
      '<div class="mp-macro-grid"><label>Cal<input type="number" class="mp-i-cal" min="0" step="any" inputmode="decimal" value="' + (i.calories ? esc(Math.round(i.calories * 10) / 10) : "") + '"></label>' +
      '<label>Protein g<input type="number" class="mp-i-pro" min="0" step="any" inputmode="decimal" value="' + (i.protein ? esc(Math.round(i.protein * 10) / 10) : "") + '"></label>' +
      '<label>Carbs g<input type="number" class="mp-i-carb" min="0" step="any" inputmode="decimal" value="' + (i.carbs ? esc(Math.round(i.carbs * 10) / 10) : "") + '"></label>' +
      '<label>Fat g<input type="number" class="mp-i-fat" min="0" step="any" inputmode="decimal" value="' + (i.fat ? esc(Math.round(i.fat * 10) / 10) : "") + '"></label></div></div>';
  }
  function readRows(root) {
    return Array.prototype.map.call(root.querySelectorAll(".mp-ing"), function (r) {
      const q = function (c) { return r.querySelector(c); };
      const o = { name: q(".mp-i-name").value, quantity: q(".mp-i-qty").value, state: q(".mp-i-state").value, calories: q(".mp-i-cal").value, protein: q(".mp-i-pro").value, carbs: q(".mp-i-carb").value, fat: q(".mp-i-fat").value, fiber: r.getAttribute("data-fiber"), est: r.getAttribute("data-est") === "1" };
      return o;
    });
  }
  function drawRows(root, list) {
    const box = root.querySelector("#mpIngRows");
    box.innerHTML = list.map(function (i, n) { return ingRowHtml(i, n + 1); }).join("");
  }

  // o: { id } to edit, { draft } to start from a recipe made elsewhere (the calculator), nothing for a new one
  function openRecipeSheet(o) {
    const A = k.A();
    if (!A) { k.toast("Recipes can't be edited here right now."); return; }
    const op = o || {}, r = op.id ? k.recipeById(op.id) : null;
    if (op.id && !r) { k.toast("That recipe isn't there any more."); return; }
    const d = r || op.draft || { name: "", servings: 4, ingredients: [{ name: "", quantity: "" }], cats: [] };
    pendingImage = undefined;
    let body = A.fText("name", "Recipe name", d.name, { required: true, max: 70 });
    body += '<div class="form-row"><fieldset class="cdp-days"><legend>Categories</legend><div class="cal-chips">' + L.CATS.map(function (c) { return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="cats" value="' + c + '"' + ((d.cats || []).indexOf(c) !== -1 ? " checked" : "") + '> ' + esc(L.MEAL_LABELS[c]) + '</label>'; }).join("") + '</div><p class="field-hint">"High-protein" is added automatically when a serving has ' + L.HIGH_PROTEIN_G + ' g of protein or more.</p></fieldset></div>';
    body += '<div class="form-row two-col"><div>' + A.row("servings", "Servings", '<input type="number" id="spf_servings" name="servings" min="1" max="100" step="1" value="' + esc(d.servings || 4) + '">', {}) + '</div><div>' + A.row("prepMin", "Prep (min)", '<input type="number" id="spf_prepMin" name="prepMin" min="0" max="1440" step="1" value="' + esc(d.prepMin || "") + '">', {}) + '</div></div>';
    body += A.row("cookMin", "Cooking time (min)", '<input type="number" id="spf_cookMin" name="cookMin" min="0" max="1440" step="1" value="' + esc(d.cookMin || "") + '">', {});
    body += '<h3 class="mp-h3">Ingredients</h3><p class="field-hint">Each ingredient’s numbers are for the whole amount you use. Leave them empty and use “Estimate” for a rough value from a typical-values list (weights work best).</p><div id="mpIngRows"></div>' +
      '<datalist id="mpFoodNames">' + F.suggestions().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + '</datalist>' +
      '<div class="mp-actions"><button type="button" class="btn btn-secondary" data-sheet-act="add-ing">+ Add ingredient</button><button type="button" class="btn btn-secondary" data-sheet-act="estimate">Estimate missing numbers</button></div><p class="field-hint" id="mpEstMsg" role="status"></p>';
    body += A.fArea("instructions", "Steps (one per line)", d.instructions || "", { rows: 5, max: 4000 });
    body += A.fSelect("place", "Storage", [["", "Not set"], ["fridge", "Refrigerator"], ["freezer", "Freezer"], ["both", "Refrigerator or freezer"]], d.storage && d.storage.place || "");
    body += A.fText("snotes", "Storage notes", d.storage && d.storage.notes || "", { max: 300, placeholder: "e.g. Airtight containers, sauce on the side" });
    body += A.fText("reheat", "Reheating (optional)", d.storage && d.storage.reheat || "", { max: 300, placeholder: "e.g. Microwave 2 min, stir, 1 more min" });
    body += '<div class="form-row"><label for="mpImage">Picture (optional)</label><input type="file" id="mpImage" accept="image/*"><div id="mpImgBox" class="mp-imgbox">' + (d.image ? '<img src="' + esc(d.image) + '" alt="Current picture"><button type="button" class="btn btn-secondary" data-sheet-act="rm-img">Remove picture</button>' : '') + '</div></div>';
    body += '<label class="cal-check"><input type="checkbox" name="favorite"' + (d.favorite ? " checked" : "") + '> Favorite</label>';
    if (r) body += '<p class="field-hint">Changing a recipe changes meals you plan from now on. Meals you already marked eaten, and your food log, keep the numbers they had.</p>';
    A.openSheet({
      title: r ? "Edit recipe" : "New recipe", body: body, submit: "Save recipe", focus: '[name="name"]',
      onOpen: function (root) {
        drawRows(root, (d.ingredients && d.ingredients.length ? d.ingredients : [{ name: "", quantity: "" }]).map(function (i) { return Object.assign({}, i); }));
        root.querySelector("#mpIngRows").addEventListener("input", function (e) {
          const row = e.target.closest(".mp-ing"); if (!row) return;
          if (/mp-i-(cal|pro|carb|fat)/.test(e.target.className) && row.getAttribute("data-est") === "1") { row.setAttribute("data-est", "0"); const b = row.querySelector(".mp-est"); if (b) b.remove(); }   // typing a number makes it yours
        });
        root.querySelector("#mpImage").addEventListener("change", function (e) { readImage(e.target.files && e.target.files[0], root); });
      },
      onAct: function (act, el, root) {
        if (act === "add-ing") { const rows = readRows(root); rows.push({ name: "", quantity: "" }); drawRows(root, rows); const last = root.querySelectorAll(".mp-i-name"); if (last.length) last[last.length - 1].focus(); }
        else if (act === "rm-ing") { const rows = readRows(root), i = Array.prototype.indexOf.call(root.querySelectorAll(".mp-ing"), el.closest(".mp-ing")); if (rows.length > 1) { rows.splice(i, 1); drawRows(root, rows); } else k.toast("A recipe needs at least one ingredient."); }
        else if (act === "estimate") estimateRows(root);
        else if (act === "rm-img") { pendingImage = ""; root.querySelector("#mpImgBox").innerHTML = '<p class="field-hint">The picture will be removed when you save.</p>'; }
      },
      onSubmit: function (v, form) { return saveRecipe(v, form, r); }
    });
  }
  function estimateRows(root) {
    const rows = readRows(root), missing = [], failed = [];
    let filled = 0;
    rows.forEach(function (row, i) {
      if (!row.name.trim() || row.calories || row.protein || row.carbs || row.fat) return;
      const e = L.estimate(row.name, row.quantity, row.state);
      if (e.error) { failed.push(row.name.trim() + " (" + e.error.replace(/\.$/, "") + ")"); return; }
      rows[i] = Object.assign(row, { calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat, est: true });
      filled++;
    });
    drawRows(root, rows);
    root.querySelector("#mpEstMsg").textContent = (filled ? "Filled " + filled + " from typical values (marked estimated). " : "Nothing to fill. ") + (failed.length ? "Could not estimate: " + failed.join("; ") + "." : "");
  }
  function readImage(file, root) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { k.toast("Choose a picture file."); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      try {
        let side = 480, q = 0.72, out = "";
        for (let tries = 0; tries < 4; tries++) {
          const sc = Math.min(1, side / Math.max(img.width, img.height)), c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", q);
          if (out.length <= 110000) break;
          side = Math.round(side * 0.75); q = Math.max(0.5, q - 0.08);
        }
        if (out.length > 120000) throw new Error("too big");
        pendingImage = out;
        root.querySelector("#mpImgBox").innerHTML = '<img src="' + out + '" alt="New picture"><button type="button" class="btn btn-secondary" data-sheet-act="rm-img">Remove picture</button>';
      } catch (e) { k.toast("That picture couldn't be used. Try a smaller one."); }
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { URL.revokeObjectURL(url); k.toast("That picture couldn't be read."); };
    img.src = url;
  }
  function saveRecipe(v, form, existing) {
    const name = String(v.name || "").replace(/\s+/g, " ").trim();
    const errors = {};
    if (!name) errors.name = "Give the recipe a name.";
    const servings = Math.round(Number(v.servings));
    if (!(servings >= 1)) errors.servings = "Servings must be 1 or more.";
    const ings = readRows(form).filter(function (i) { return i.name.trim(); }).map(function (i) {
      const c = L.cleanIngredient({ name: i.name, quantity: i.quantity, calories: i.calories, protein: i.protein, carbs: i.carbs, fat: i.fat, fiber: i.fiber, state: i.state, est: i.est });
      return c;
    });
    if (!ings.length) errors.name = errors.name || "Add at least one ingredient.";
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    const ex = L.recipeExtras({ cats: v.cats || [], favorite: !!v.favorite, prepMin: v.prepMin, cookMin: v.cookMin, storage: { place: v.place, notes: v.snotes, reheat: v.reheat }, image: pendingImage === undefined ? (existing && existing.image) : pendingImage });
    const rec = Object.assign({}, existing || {}, { name: name, instructions: String(v.instructions || "").trim(), servings: servings, ingredients: ings });
    ["cats", "favorite", "prepMin", "cookMin", "storage", "image"].forEach(function (f) { delete rec[f]; });
    Object.assign(rec, ex);
    const N = k.N(), before = existing ? JSON.parse(JSON.stringify(existing)) : null;
    const r = N.recipes.save(rec);
    if (!r.ok) return { ok: false, message: r.error };
    k.render({ keepScroll: true });
    k.undo((existing ? "Saved “" : "Added “") + name + "”.", function () { if (before) N.recipes.save(before); else N.recipes.remove(r.recipe.id); k.render({ keepScroll: true }); });
    return { ok: true };
  }

  function toggleFav(id) {
    const r = k.recipeById(id); if (!r) return;
    const N = k.N(), next = Object.assign({}, r);
    if (r.favorite) delete next.favorite; else next.favorite = true;
    const res = N.recipes.save(next);
    if (!res.ok) { k.toast(res.error); return; }
    k.render({ keepScroll: true, focus: '[data-mp="recipes:fav"][data-id="' + id + '"]' });
    k.say(r.favorite ? "Removed from favorites." : "Added to favorites.");
  }
  function duplicate(id) {
    const r = k.recipeById(id); if (!r) return;
    const N = k.N(), copy = L.duplicateRecipe(r, k.uid("recipe"), k.now());
    const res = N.recipes.save(copy);
    if (!res.ok) { k.toast(res.error); return; }
    k.ui.open["recipe:" + copy.id] = true;
    k.render({ keepScroll: true });
    k.undo("Made a copy: “" + copy.name + "”.", function () { N.recipes.remove(copy.id); k.render({ keepScroll: true }); });
  }
  function remove(id) {
    const r = k.recipeById(id); if (!r) return;
    const N = k.N(), res = N.recipes.remove(id);
    if (!res.ok) { k.toast(res.error); return; }
    k.render({ keepScroll: true });
    k.undo("Deleted “" + r.name + "”. Meals already in your plan keep their name.", function () { N.recipes.save(r); k.render({ keepScroll: true }); });
  }

  /* ---------------- the portion calculator ---------------- */

  function calcRowHtml(row, n) {
    const v = function (x) { return x === undefined || x === null ? "" : esc(x); };
    return '<div class="mp-crow" data-own="' + (row.own ? 1 : 0) + '">' +
      '<div class="mp-ing-h"><span class="mp-ing-n">Ingredient ' + n + '</span><button type="button" class="btn-icon danger" data-sheet-act="rm-row" aria-label="Remove ingredient ' + n + '">&times;</button></div>' +
      '<div class="form-row"><label>Name<input type="text" class="mp-c-name" maxlength="60" value="' + v(row.name) + '" list="mpFoodNames2" autocomplete="off" placeholder="e.g. ground turkey"></label></div>' +
      '<div class="form-row two-col"><div><label>Amount<input type="number" class="mp-c-amt" min="0" step="any" inputmode="decimal" value="' + v(row.amount) + '"></label></div>' +
      '<div><label>Unit<select class="mp-c-unit">' + ["g", "kg", "oz", "lb", "each", "tbsp", "cup"].map(function (u) { return '<option value="' + u + '"' + ((row.unit || "g") === u ? " selected" : "") + '>' + u + '</option>'; }).join("") + '</select></label></div></div>' +
      '<div class="form-row"><label>Weighed<select class="mp-c-state"><option value="">Usual for this food</option><option value="raw"' + (row.state === "raw" ? " selected" : "") + '>Raw (as bought)</option><option value="cooked"' + (row.state === "cooked" ? " selected" : "") + '>Cooked</option></select></label></div>' +
      '<div class="mp-c-match mp-dim" aria-live="polite"></div>' +
      '<label class="cal-check"><input type="checkbox" class="mp-c-own"' + (row.own ? " checked" : "") + '> Use my own numbers (from a label)</label>' +
      '<div class="mp-c-ownbox' + (row.own ? "" : " hidden") + '"><div class="form-row two-col"><div><label>Numbers are for<select class="mp-c-basis"><option value="total"' + (row.own && row.own.basis === "total" ? " selected" : "") + '>This whole amount</option><option value="per100"' + (!row.own || row.own.basis !== "total" ? " selected" : "") + '>Every 100 g</option></select></label></div>' +
      '<div><label>Food state on the label<select class="mp-c-ostate"><option value="">Not sure</option><option value="raw"' + (row.own && row.own.state === "raw" ? " selected" : "") + '>Raw / dry</option><option value="cooked"' + (row.own && row.own.state === "cooked" ? " selected" : "") + '>Cooked</option></select></label></div></div>' +
      '<div class="mp-macro-grid"><label>Cal<input type="number" class="mp-c-cal" min="0" step="any" value="' + v(row.own && row.own.calories) + '"></label><label>Protein g<input type="number" class="mp-c-pro" min="0" step="any" value="' + v(row.own && row.own.protein) + '"></label><label>Carbs g<input type="number" class="mp-c-carb" min="0" step="any" value="' + v(row.own && row.own.carbs) + '"></label><label>Fat g<input type="number" class="mp-c-fat" min="0" step="any" value="' + v(row.own && row.own.fat) + '"></label></div></div></div>';
  }
  function readCalc(root) {
    const rows = Array.prototype.map.call(root.querySelectorAll(".mp-crow"), function (r) {
      const q = function (c) { return r.querySelector(c); }, own = q(".mp-c-own").checked;
      return { name: q(".mp-c-name").value, amount: q(".mp-c-amt").value, unit: q(".mp-c-unit").value, state: q(".mp-c-state").value,
        own: own ? { basis: q(".mp-c-basis").value, state: q(".mp-c-ostate").value, calories: q(".mp-c-cal").value, protein: q(".mp-c-pro").value, carbs: q(".mp-c-carb").value, fat: q(".mp-c-fat").value } : null };
    });
    return { rows: rows, portions: root.querySelector('[name="portions"]').value, dishWeight: root.querySelector('[name="dish"]').value };
  }
  function drawCalc(root, rows) { root.querySelector("#mpCalcRows").innerHTML = rows.map(function (r, i) { return calcRowHtml(r, i + 1); }).join(""); Array.prototype.forEach.call(root.querySelectorAll(".mp-crow"), function (r) { matchNote(r); }); }
  // Says which food in the list a name matched, so a surprise is seen before the numbers are trusted.
  function matchNote(rowEl) {
    const name = rowEl.querySelector(".mp-c-name").value, box = rowEl.querySelector(".mp-c-match");
    if (!name.trim()) { box.textContent = ""; return; }
    const f = F.find(name), own = rowEl.querySelector(".mp-c-own").checked;
    box.textContent = own ? "" : f ? "Typical value used: " + f.names[0] + (f.generic ? " (a generic mix)" : "") + ". Usually weighed " + f.def + "." : "No typical value for this name. Use your own numbers.";
  }
  function resultHtml(res, recipeFrom) {
    if (!res.rows.length) return '<p class="mp-dim">Add at least one ingredient.</p>';
    let h = '';
    if (res.perPortion) h += '<div class="mp-result"><p class="mp-result-k">One portion (of ' + res.portions + ')</p><p class="mp-result-big">' + k.num(res.perPortion.calories) + ' <span>kcal</span></p><dl class="mp-result-d"><div><dt>Protein</dt><dd>' + res.perPortion.protein + ' g</dd></div><div><dt>Carbs</dt><dd>' + res.perPortion.carbs + ' g</dd></div><div><dt>Fat</dt><dd>' + res.perPortion.fat + ' g</dd></div></dl>' + (res.gramsPerPortion ? '<p class="mp-dim">About ' + res.gramsPerPortion + ' g of food per portion.</p>' : '') + '</div>';
    else h += '<p class="mp-dim">Enter the number of portions to see one portion.</p>';
    h += '<p class="mp-dim">Whole batch: ' + esc(res.totals.calories + " kcal · P " + res.totals.protein + " g · C " + res.totals.carbs + " g · F " + res.totals.fat + " g") + '</p>';
    h += '<ul class="mp-ings mp-crows">' + res.rows.map(function (r) {
      return '<li><span>' + esc(r.name) + (r.source === "typical" ? ' <em class="mp-est">typical value, est.</em>' : r.source === "yours" ? ' <em class="mp-yours">your numbers</em>' : '') + (r.note ? '<br><span class="mp-dim">' + esc(r.note) + '</span>' : '') + (r.error ? '<br><span class="mp-err">' + esc(r.error) + '</span>' : '') + '</span><span>' + (r.nutrition ? esc(Math.round(r.nutrition.calories) + " kcal") : '—') + '</span></li>';
    }).join("") + '</ul>';
    if (res.warnings.length) h += '<ul class="mp-notes">' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join("") + '</ul>';
    h += '<p class="mp-foot">' + (res.anyEstimated ? 'Estimated: typical values for common foods, rounded. Brands, cuts and cooking methods differ, so check a label when it matters. ' : '') + 'These are not medical advice.</p>';
    if (res.perPortion && !res.rows.some(function (r) { return r.error; })) h += '<div class="mp-actions"><button type="button" class="btn btn-secondary" data-sheet-act="save-recipe">Save as a recipe</button></div>';
    return h;
  }
  function openCalculator() {
    const A = k.A();
    if (!A) { k.toast("The calculator can't open right now."); return; }
    let last = null;
    const start = [{ name: "ground turkey", amount: 1000, unit: "g", state: "raw" }, { name: "rice", amount: 500, unit: "g", state: "cooked" }, { name: "mixed vegetables", amount: 200, unit: "g", state: "raw" }];
    const body = '<p class="field-hint">Enter what you cooked. Say whether each weight is raw or cooked: they are very different amounts of food. Example below: change it to your own.</p>' +
      '<datalist id="mpFoodNames2">' + F.suggestions().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + '</datalist>' +
      '<div id="mpCalcRows"></div><div class="mp-actions"><button type="button" class="btn btn-secondary" data-sheet-act="add-row">+ Add ingredient</button></div>' +
      '<div class="form-row two-col"><div>' + A.row("portions", "Divide into (portions)", '<input type="number" id="spf_portions" name="portions" min="1" max="100" step="1" value="5">', {}) + '</div><div>' + A.row("dish", "Finished weight (g, optional)", '<input type="number" id="spf_dish" name="dish" min="0" step="any" value="">', { hint: "Weigh the finished dish to see grams per portion." }) + '</div></div>' +
      '<div class="mp-actions"><button type="button" class="btn btn-primary" data-sheet-act="calc">Calculate</button></div><div id="mpCalcOut" aria-live="polite"></div>';
    A.openSheet({
      title: "Portion calculator", body: body, focus: '[data-sheet-act="calc"]',
      onOpen: function (root) {
        drawCalc(root, start);
        const rows = root.querySelector("#mpCalcRows");
        rows.addEventListener("input", function (e) { const r = e.target.closest(".mp-crow"); if (r && e.target.classList.contains("mp-c-name")) matchNote(r); });
        rows.addEventListener("change", function (e) {
          const r = e.target.closest(".mp-crow"); if (!r) return;
          if (e.target.classList.contains("mp-c-own")) { r.querySelector(".mp-c-ownbox").classList.toggle("hidden", !e.target.checked); matchNote(r); }
          if (e.target.classList.contains("mp-c-name")) matchNote(r);
        });
      },
      onAct: function (act, el, root) {
        if (act === "add-row") { const c = readCalc(root); c.rows.push({ name: "", amount: "", unit: "g", state: "" }); drawCalc(root, c.rows); const n = root.querySelectorAll(".mp-c-name"); n[n.length - 1].focus(); }
        else if (act === "rm-row") { const c = readCalc(root), i = Array.prototype.indexOf.call(root.querySelectorAll(".mp-crow"), el.closest(".mp-crow")); c.rows.splice(i, 1); drawCalc(root, c.rows); }
        else if (act === "calc") {
          const c = readCalc(root);
          const res = L.calculate({ rows: c.rows.map(function (r) { return { name: r.name, amount: r.amount, unit: r.unit, state: r.state, own: r.own ? { basis: r.own.basis, state: r.own.state, calories: r.own.calories, protein: r.own.protein, carbs: r.own.carbs, fat: r.own.fat } : null }; }), portions: c.portions, dishWeight: c.dishWeight });
          last = { res: res, input: c };
          const out = root.querySelector("#mpCalcOut");
          out.innerHTML = resultHtml(res);
          out.scrollIntoView({ block: "nearest" });      // the answer is below the form on a phone: bring it into view
        }
        else if (act === "save-recipe" && last) {
          const c = last.input, draft = { name: "", servings: Math.round(Number(c.portions)) || 1, cats: [], instructions: "", ingredients: last.res.rows.map(function (r, i) {
            const src = c.rows[i] || {};
            return { name: r.name, quantity: (src.amount || "") + " " + (src.unit || "g"), state: r.state === "raw" || r.state === "cooked" ? r.state : (src.state || ""), calories: r.nutrition ? r.nutrition.calories : 0, protein: r.nutrition ? r.nutrition.protein : 0, carbs: r.nutrition ? r.nutrition.carbs : 0, fat: r.nutrition ? r.nutrition.fat : 0, est: r.source === "typical" };
          }) };
          A.closeSheet(true);
          window.setTimeout(function () { openRecipeSheet({ draft: draft }); }, 0);
        }
      }
    });
  }

  /* ---------------- taps ---------------- */

  function click(act, el) {
    const id = el.getAttribute("data-id");
    if (act === "new") { openRecipeSheet({}); return; }
    if (act === "calc") { openCalculator(); return; }
    if (act === "cat") { st.cat = el.getAttribute("data-cat"); k.render({ keepScroll: true, focus: '[data-mp="recipes:cat"][data-cat="' + st.cat + '"]' }); return; }
    if (act === "edit") { openRecipeSheet({ id: id }); return; }
    if (act === "fav") { toggleFav(id); return; }
    if (act === "dup") { duplicate(id); return; }
    if (act === "delete") { remove(id); return; }
    if (act === "plan") { if (k.openMealSheet) k.openMealSheet({ recipeId: id }); return; }
    if (act === "batch") { if (k.openBatchSheet) k.openBatchSheet({ recipeId: id }); return; }
  }
  let searchTimer = null;
  function input(act, el) {
    if (act !== "search") return;
    st.q = el.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      const pos = el.selectionStart;
      k.render({ keepScroll: true });
      const again = document.getElementById("mpRecipeSearch"); if (again) { again.focus({ preventScroll: true }); try { again.setSelectionRange(pos, pos); } catch (e) { /* not supported for this input */ } }
    }, 150);
  }

  k.openRecipeSheet = openRecipeSheet;
  k.openCalculator = openCalculator;
  MP.register("recipes", { render: render, click: click, input: input });
})();
