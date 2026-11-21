/* ==========================================================================
   JARVIS — Meal Prep: typical values for common foods (data only).

   JARVIS has no food database and never looks anything up. This is a small, fixed list of ordinary foods with typical
   values per 100 g, rounded, taken from published USDA-style reference figures, so the portion calculator and the recipe
   form can give a rough starting number when you have not typed your own. They are ESTIMATES: brands, cuts and cooking
   methods differ, and a package label always wins. Everything that comes from here is labelled "estimated" wherever it is
   shown, and you can type your own numbers over it.

   Each food: { id, names: [words that mean it], group, def: the state it is usually weighed in,
                raw / cooked / packaged: [calories, protein g, carbs g, fat g] per 100 g in that state,
                yield: grams cooked per gram raw (to convert between the two when only one is known),
                each: grams of one piece, tbsp: grams in a tablespoon, cup: grams in a cup }
   "raw" means as bought and uncooked (rice and beans: dry); "cooked" means ready to eat; "packaged" is for foods that are
   not cooked at home (canned tuna, yogurt).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisMealPrepFoods = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FOODS = [
    // protein
    { id: "chicken-breast", names: ["chicken breast", "chicken"], group: "Meat & Seafood", def: "raw", raw: [120, 22.5, 0, 2.6], cooked: [165, 31, 0, 3.6], yield: 0.75 },
    { id: "chicken-thigh", names: ["chicken thigh"], group: "Meat & Seafood", def: "raw", raw: [121, 19.7, 0, 4.1], cooked: [179, 24.8, 0, 8.2], yield: 0.75 },
    { id: "ground-turkey", names: ["ground turkey", "turkey mince", "turkey"], group: "Meat & Seafood", def: "raw", raw: [150, 18.7, 0, 8.3], cooked: [213, 27.1, 0, 11.6], yield: 0.75 },
    { id: "ground-beef", names: ["ground beef", "beef mince", "minced beef", "beef"], group: "Meat & Seafood", def: "raw", raw: [176, 20, 0, 10], cooked: [217, 26.1, 0, 11.8], yield: 0.75 },
    { id: "salmon", names: ["salmon"], group: "Meat & Seafood", def: "raw", raw: [208, 20.4, 0, 13.4], cooked: [206, 22.1, 0, 12.4], yield: 0.85 },
    { id: "cod", names: ["cod"], group: "Meat & Seafood", def: "raw", raw: [82, 17.8, 0, 0.7], cooked: [105, 22.8, 0, 0.9], yield: 0.78 },
    { id: "tilapia", names: ["tilapia"], group: "Meat & Seafood", def: "raw", raw: [96, 20.1, 0, 1.7], cooked: [128, 26.2, 0, 2.7], yield: 0.75 },
    { id: "shrimp", names: ["shrimp", "prawns"], group: "Meat & Seafood", def: "raw", raw: [85, 20.1, 0.2, 0.5], cooked: [99, 24, 0.2, 0.3], yield: 0.85 },
    { id: "tuna-canned", names: ["canned tuna", "tuna"], group: "Canned & Jarred", def: "packaged", packaged: [116, 25.5, 0, 0.8] },
    { id: "egg", names: ["eggs", "egg"], group: "Dairy & Eggs", def: "raw", raw: [143, 12.6, 0.7, 9.5], cooked: [155, 12.6, 1.1, 10.6], yield: 1, each: 50 },
    // dairy
    { id: "greek-yogurt", names: ["greek yogurt", "greek yoghurt"], group: "Dairy & Eggs", def: "packaged", packaged: [59, 10.2, 3.6, 0.4], cup: 245 },
    { id: "cottage-cheese", names: ["cottage cheese"], group: "Dairy & Eggs", def: "packaged", packaged: [81, 10.4, 4.8, 2.3], cup: 225 },
    { id: "milk", names: ["whole milk", "milk"], group: "Dairy & Eggs", def: "packaged", packaged: [61, 3.2, 4.8, 3.3], cup: 244 },
    { id: "skim-milk", names: ["skim milk", "nonfat milk"], group: "Dairy & Eggs", def: "packaged", packaged: [34, 3.4, 5, 0.1], cup: 245 },
    { id: "cheddar", names: ["cheddar cheese", "cheddar"], group: "Dairy & Eggs", def: "packaged", packaged: [403, 24.9, 1.3, 33.1] },
    { id: "mozzarella", names: ["mozzarella"], group: "Dairy & Eggs", def: "packaged", packaged: [254, 24.3, 2.8, 15.9] },
    // grains and starches
    { id: "white-rice", names: ["white rice", "jasmine rice", "basmati rice", "rice"], group: "Grains & Pasta", def: "cooked", raw: [365, 7.1, 80, 0.7], cooked: [130, 2.7, 28.2, 0.3], yield: 2.8 },
    { id: "brown-rice", names: ["brown rice"], group: "Grains & Pasta", def: "cooked", raw: [370, 7.9, 77.2, 2.9], cooked: [123, 2.7, 25.6, 1], yield: 3 },
    { id: "quinoa", names: ["quinoa"], group: "Grains & Pasta", def: "cooked", raw: [368, 14.1, 64.2, 6.1], cooked: [120, 4.4, 21.3, 1.9], yield: 3.07 },
    { id: "pasta", names: ["pasta", "spaghetti", "penne", "noodles"], group: "Grains & Pasta", def: "cooked", raw: [371, 13, 74.7, 1.5], cooked: [158, 5.8, 30.9, 0.9], yield: 2.35 },
    { id: "oats", names: ["rolled oats", "oats", "oatmeal"], group: "Grains & Pasta", def: "raw", raw: [389, 16.9, 66.3, 6.9], cooked: [71, 2.5, 12, 1.5], yield: 5.5 },
    { id: "potato", names: ["potato", "potatoes"], group: "Produce", def: "raw", raw: [77, 2, 17.5, 0.1], cooked: [93, 2.5, 21.2, 0.1], yield: 0.83, each: 170 },
    { id: "sweet-potato", names: ["sweet potato", "sweet potatoes"], group: "Produce", def: "raw", raw: [86, 1.6, 20.1, 0.1], cooked: [90, 2, 20.7, 0.2], yield: 0.95, each: 130 },
    { id: "bread", names: ["whole wheat bread", "bread"], group: "Bakery", def: "packaged", packaged: [252, 12.5, 42.7, 3.5], each: 28 },
    // legumes
    { id: "black-beans", names: ["black beans"], group: "Canned & Jarred", def: "cooked", raw: [341, 21.6, 62.4, 1.4], cooked: [132, 8.9, 23.7, 0.5], yield: 2.58 },
    { id: "chickpeas", names: ["chickpeas", "garbanzo beans"], group: "Canned & Jarred", def: "cooked", raw: [378, 20.5, 62.9, 6], cooked: [164, 8.9, 27.4, 2.6], yield: 2.3 },
    { id: "lentils", names: ["lentils"], group: "Canned & Jarred", def: "cooked", raw: [352, 24.6, 63, 1.1], cooked: [116, 9, 20.1, 0.4], yield: 3 },
    // vegetables and fruit (raw values; cooked ones lose a little water)
    { id: "broccoli", names: ["broccoli"], group: "Produce", def: "raw", raw: [34, 2.8, 6.6, 0.4], cooked: [35, 2.4, 7.2, 0.4], yield: 0.9 },
    { id: "spinach", names: ["spinach"], group: "Produce", def: "raw", raw: [23, 2.9, 3.6, 0.4], yield: 0.9 },
    { id: "kale", names: ["kale"], group: "Produce", def: "raw", raw: [49, 4.3, 8.8, 0.9], yield: 0.9 },
    { id: "carrot", names: ["carrots", "carrot"], group: "Produce", def: "raw", raw: [41, 0.9, 9.6, 0.2], cooked: [35, 0.8, 8.2, 0.2], yield: 1, each: 61 },
    { id: "bell-pepper", names: ["bell pepper", "peppers"], group: "Produce", def: "raw", raw: [31, 1, 6, 0.3], yield: 0.9, each: 120 },
    { id: "onion", names: ["onion", "onions"], group: "Produce", def: "raw", raw: [40, 1.1, 9.3, 0.1], yield: 0.9, each: 110 },
    { id: "tomato", names: ["tomato", "tomatoes"], group: "Produce", def: "raw", raw: [18, 0.9, 3.9, 0.2], yield: 0.9, each: 123 },
    { id: "zucchini", names: ["zucchini", "courgette"], group: "Produce", def: "raw", raw: [17, 1.2, 3.1, 0.3], yield: 0.9, each: 196 },
    { id: "cauliflower", names: ["cauliflower"], group: "Produce", def: "raw", raw: [25, 1.9, 5, 0.3], yield: 0.9 },
    { id: "green-beans", names: ["green beans"], group: "Produce", def: "raw", raw: [31, 1.8, 7, 0.2], yield: 0.9 },
    { id: "mushrooms", names: ["mushrooms", "mushroom"], group: "Produce", def: "raw", raw: [22, 3.1, 3.3, 0.3], yield: 0.8 },
    { id: "cucumber", names: ["cucumber"], group: "Produce", def: "raw", raw: [15, 0.7, 3.6, 0.1], each: 300 },
    { id: "asparagus", names: ["asparagus"], group: "Produce", def: "raw", raw: [20, 2.2, 3.9, 0.1], yield: 0.9 },
    { id: "peas", names: ["green peas", "peas"], group: "Produce", def: "raw", raw: [81, 5.4, 14.5, 0.4], yield: 0.95 },
    { id: "corn", names: ["sweet corn", "corn"], group: "Produce", def: "raw", raw: [86, 3.3, 19, 1.4], yield: 0.95 },
    { id: "mixed-veg", names: ["mixed vegetables", "mixed veg", "vegetables", "veggies"], group: "Produce", def: "raw", raw: [50, 2.5, 10, 0.3], yield: 0.9, generic: true },
    { id: "avocado", names: ["avocado"], group: "Produce", def: "raw", raw: [160, 2, 8.5, 14.7], each: 150 },
    { id: "banana", names: ["banana"], group: "Produce", def: "raw", raw: [89, 1.1, 22.8, 0.3], each: 118 },
    { id: "apple", names: ["apple"], group: "Produce", def: "raw", raw: [52, 0.3, 13.8, 0.2], each: 182 },
    { id: "blueberries", names: ["blueberries"], group: "Produce", def: "raw", raw: [57, 0.7, 14.5, 0.3], cup: 148 },
    // fats and extras
    { id: "olive-oil", names: ["olive oil", "oil"], group: "Condiments & Sauces", def: "packaged", packaged: [884, 0, 0, 100], tbsp: 13.5 },
    { id: "butter", names: ["butter"], group: "Dairy & Eggs", def: "packaged", packaged: [717, 0.9, 0.1, 81], tbsp: 14.2 },
    { id: "peanut-butter", names: ["peanut butter"], group: "Condiments & Sauces", def: "packaged", packaged: [588, 25, 20, 50], tbsp: 16 },
    { id: "almonds", names: ["almonds"], group: "Snacks", def: "packaged", packaged: [579, 21.2, 21.6, 49.9] },
    { id: "honey", names: ["honey"], group: "Condiments & Sauces", def: "packaged", packaged: [304, 0.3, 82.4, 0], tbsp: 21 }
  ];

  const STATES = ["raw", "cooked", "packaged"];

  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

  // The state a name asks for: "cooked rice" -> cooked, "raw chicken" -> raw, "dry rice" -> raw. "" if it does not say.
  function stateInName(name) {
    const n = " " + norm(name) + " ";
    if (/ (cooked|roasted|baked|grilled|boiled|steamed|fried) /.test(n)) return "cooked";
    if (/ (raw|uncooked|dry|dried) /.test(n)) return "raw";
    return "";
  }

  // Words that say it is not the plain food ("chicken broth", "coconut milk", "tomato sauce"): nothing is matched then.
  const NOT_PLAIN = /\b(broth|stock|bouillon|sauce|soup|seasoning|powder|flavou?r|paste|juice|coconut|almond milk|oat milk|soy|bar|chips|crackers|dressing|mayo|ketchup|jam|jelly|syrup|spread|substitute|flour|starch|vinegar|extract)\b/;

  // The food a name means: the longest word-group of any food that appears in it. null when none does (nothing is guessed).
  function find(name) {
    if (NOT_PLAIN.test(norm(name))) return null;
    const n = " " + norm(name) + " ";
    let best = null, bestLen = 0;
    FOODS.forEach(function (f) {
      f.names.forEach(function (w) {
        const key = " " + norm(w) + " ";
        if (n.indexOf(key) !== -1 && key.length > bestLen) { best = f; bestLen = key.length; }
      });
    });
    return best;
  }
  function byId(id) { return FOODS.filter(function (f) { return f.id === id; })[0] || null; }
  function suggestions() { return FOODS.map(function (f) { return f.names[0]; }); }

  return { FOODS: FOODS, STATES: STATES, norm: norm, stateInName: stateInName, find: find, byId: byId, suggestions: suggestions };
});
