/* ==========================================================================
   JARVIS — Meal Prep › Grocery List.

   The grocery list that Nutrition > Groceries keeps (jarvisGroceryList), drawn for shopping: it is built from the meals in your plan (a
   recipe's ingredients, scaled to the portions you planned), duplicate ingredients are combined into one total, amounts you already have
   at home (the pantry) are taken off, and items are grouped by aisle. Tick items as you buy them (that adds them to the pantry estimate),
   add your own, remove any. Nothing here is a second list: it is the same one the Groceries tab shows, so the two always agree.
   ========================================================================== */

(function () {
  "use strict";

  const MP = window.JarvisMealPrep;
  if (!MP) return;
  const k = MP.kit, L = k.L, esc = k.esc;

  function api() { return k.G(); }

  function itemHtml(it) {
    const nf = it.neededFor && it.neededFor.length ? '<span class="mp-dim mp-gi-for">For ' + esc(it.neededFor.slice(0, 3).join(", ")) + (it.neededFor.length > 3 ? " and " + (it.neededFor.length - 3) + " more" : "") + '</span>' : '';
    return '<li class="mp-gi' + (it.purchased ? ' is-bought' : '') + '"><label class="mp-gi-check"><input type="checkbox" data-mp="grocery:buy" data-id="' + esc(it.id) + '"' + (it.purchased ? " checked" : "") + ' aria-label="' + esc("Bought: " + it.name) + '"><span class="mp-gi-box" aria-hidden="true"></span></label>' +
      '<span class="mp-gi-main"><span class="mp-gi-name">' + esc(it.name) + (it.manual ? ' <span class="mp-chip">Added by you</span>' : '') + '</span>' + nf + '</span>' +
      '<span class="mp-gi-qty">' + esc(api().formatQty(it.quantity, it.unit)) + '</span>' +
      (it.purchased ? '' : '<button type="button" class="mp-gi-btn" data-mp="grocery:have" data-id="' + esc(it.id) + '" aria-label="' + esc("Have it: " + it.name) + '">Have it</button>') +
      '<button type="button" class="mp-gi-btn" data-mp="grocery:remove" data-id="' + esc(it.id) + '" aria-label="' + esc("Remove " + it.name) + '">Remove</button></li>';
  }

  function pantryHtml(g) {
    const pantry = g.pantry(), keys = Object.keys(pantry).filter(function (key) { return pantry[key] && Number(pantry[key].quantity) > 0; }).sort();
    let h = '<details class="card mp-card" data-open-key="pantry"' + k.openAttr("pantry", false) + '><summary class="mp-card-sum"><span class="mp-card-title">At home</span><span class="mp-dim">' + keys.length + ' ' + k.plural(keys.length, "item") + ' in your pantry</span></summary><div class="mp-card-body">' +
      '<p class="mp-dim">What you already have is taken off the list. Bought items are added here, and a meal you eat or cook uses up its ingredients (an estimate: correct it any time).</p>';
    h += keys.length ? '<ul class="mp-list">' + keys.map(function (key) { const p = pantry[key]; return '<li><span>' + esc(p.name) + '<span class="mp-dim"> · ' + esc(g.formatQty(Math.round(p.quantity * 100) / 100, p.unit)) + (p.source === "estimate" ? ' (estimate)' : '') + '</span></span><button type="button" class="btn btn-secondary" data-mp="grocery:unstock" data-key="' + esc(key) + '" aria-label="' + esc("Remove " + p.name + " from the pantry") + '">Remove</button></li>'; }).join("") + '</ul>' : '<p class="mp-dim">Nothing in your pantry yet.</p>';
    return h + '<div class="mp-actions"><button type="button" class="btn btn-secondary" data-mp="grocery:stock">+ I have something at home</button></div></div></details>';
  }

  function render() {
    const g = api();
    if (!g) return '<div class="card"><p class="mp-dim">The grocery list isn\'t available right now.</p></div>';
    const list = g.list().filter(function (it) { return !it.excluded; });
    const need = list.filter(function (it) { return !it.purchased; }), bought = list.filter(function (it) { return it.purchased; });
    const noRecipe = L.occurrences(g.plan(), k.today(), L.addDays(k.today(), 6)).filter(function (o) { return !o.entry.recipeId && !o.entry.isRestaurant && !(o.entry.completedDates || []).length; });
    let h = '<h2 class="mp-sr">Grocery list</h2><div class="card mp-gsum"><div><p class="mp-gsum-n">' + need.length + '</p><p class="mp-dim">' + k.plural(need.length, "item") + ' to buy</p></div><div><p class="mp-gsum-n">' + bought.length + '</p><p class="mp-dim">bought</p></div>' +
      '<div class="mp-gsum-btns"><button type="button" class="btn btn-primary" data-mp="grocery:add">+ Add item</button><button type="button" class="btn btn-secondary" data-mp="grocery:trip">Schedule shopping</button></div></div>';
    if (!list.length) {
      h += '<div class="card mp-emptycard"><p>Your list is empty.</p><p class="mp-dim">Plan meals with recipes in the Weekly Plan and the groceries appear here, with duplicates combined and what you already have left off. You can also add items yourself.</p><button type="button" class="btn btn-secondary" data-mp="grocery:plan">Go to the Weekly Plan</button></div>';
    } else {
      const cats = g.categories.filter(function (c) { return list.some(function (it) { return (it.category || "Other") === c; }); });
      h += cats.map(function (c) {
        const items = list.filter(function (it) { return (it.category || "Other") === c; }).sort(function (a, b) { return (a.purchased ? 1 : 0) - (b.purchased ? 1 : 0) || a.name.localeCompare(b.name); });
        const left = items.filter(function (it) { return !it.purchased; }).length;
        return '<details class="card mp-card mp-gcat" data-open-key="gcat:' + esc(c) + '"' + k.openAttr("gcat:" + c, true) + '><summary class="mp-card-sum"><span class="mp-card-title">' + esc(c) + '</span><span class="mp-dim">' + (left ? left + ' to buy' : 'all bought') + '</span></summary><ul class="mp-glist">' + items.map(itemHtml).join("") + '</ul></details>';
      }).join("");
    }
    if (noRecipe.length) h += '<p class="mp-note">' + noRecipe.length + ' planned ' + k.plural(noRecipe.length, "meal") + ' this week ' + k.plural(noRecipe.length, "has", "have") + ' no recipe, so nothing is added to the list for ' + k.plural(noRecipe.length, "it", "them") + '. Save them as recipes to include their ingredients.</p>';
    h += pantryHtml(g);
    h += '<p class="mp-foot">Amounts are combined when the units match (grams with ounces, cups with tablespoons). Different kinds of unit, like cans and cloves, stay as separate lines. Amounts you already have are taken off, so the list can be shorter than a recipe needs. Edit amounts and the shopping-day setup in Nutrition › Groceries.</p>';
    return h;
  }

  /* ---------------- taps ---------------- */

  function openAdd() {
    const A = k.A(), g = api();
    if (!A || !g) return;
    const body = A.fText("name", "Item", "", { required: true, max: 60, placeholder: "e.g. Greek yogurt" }) +
      '<div class="form-row two-col"><div>' + A.row("qty", "Amount", '<input type="number" id="spf_qty" name="qty" min="0" step="any" value="1" inputmode="decimal">', {}) + '</div><div>' + A.fSelect("unit", "Unit", g.units.map(function (u) { return [u, u]; }), "each") + '</div></div>';
    A.openSheet({ title: "Add a grocery item", body: body, submit: "Add", focus: '[name="name"]',
      onSubmit: function (v) {
        const r = g.addItem(v.name, v.qty, v.unit);
        if (!r.ok) return { ok: false, errors: { name: r.error } };
        k.render({ keepScroll: true }); k.say("Added " + v.name + ".");
        return { ok: true };
      } });
  }
  function openStock() {
    const A = k.A(), g = api();
    if (!A || !g) return;
    const body = '<p class="field-hint">Things you already have are taken off your grocery list.</p>' + A.fText("name", "Item", "", { required: true, max: 60, placeholder: "e.g. Rice" }) +
      '<div class="form-row two-col"><div>' + A.row("qty", "How much", '<input type="number" id="spf_qty" name="qty" min="0" step="any" value="1" inputmode="decimal">', {}) + '</div><div>' + A.fSelect("unit", "Unit", g.units.map(function (u) { return [u, u]; }), "each") + '</div></div>';
    A.openSheet({ title: "I have this at home", body: body, submit: "Save", focus: '[name="name"]',
      onSubmit: function (v) {
        const r = g.setPantry(v.name, v.qty, v.unit);
        if (!r.ok) return { ok: false, errors: { name: r.error } };
        k.render({ keepScroll: true });
        return { ok: true };
      } });
  }

  function click(act, el) {
    const g = api(), id = el.getAttribute("data-id");
    if (!g) return;
    if (act === "add") { openAdd(); return; }
    if (act === "stock") { openStock(); return; }
    if (act === "plan") { k.setTab("plan", true); return; }
    if (act === "trip") { if (k.openSessionSheet) k.openSessionSheet({ kind: "shopping" }); return; }
    if (act === "have") {
      const it = g.list().filter(function (x) { return x.id === id; })[0];
      const r = g.alreadyHave(id);
      if (r.ok) { k.render({ keepScroll: true }); if (it) k.toast("Noted: you have " + it.name + "."); } else k.toast(r.error);
      return;
    }
    if (act === "remove") {
      const it = g.list().filter(function (x) { return x.id === id; })[0];
      const r = g.removeItem(id);
      if (!r.ok) { k.toast(r.error); return; }
      k.render({ keepScroll: true });
      if (it) k.undo("Removed " + it.name + ". If a planned meal needs it, it comes back on its own.", function () { if (it.manual) g.addItem(it.name, it.quantity, it.unit); else g.refresh(); k.render({ keepScroll: true }); });
      return;
    }
    if (act === "unstock") { g.removePantry(el.getAttribute("data-key")); k.render({ keepScroll: true }); return; }
  }
  function change(act, el) {
    const g = api();
    if (act === "buy" && g) {
      const id = el.getAttribute("data-id"), on = el.checked;
      const r = g.setPurchased(id, on);
      if (!r.ok) { k.toast(r.error); k.render({ keepScroll: true }); return; }
      k.render({ keepScroll: true, focus: '[data-mp="grocery:buy"][data-id="' + id + '"]' });
      k.say(on ? "Marked bought." : "Marked not bought.");
    }
  }

  MP.register("grocery", { render: render, click: click, change: change });
})();
