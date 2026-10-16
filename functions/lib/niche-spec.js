/* ==========================================================================
   Niche-search plan shared by the server (functions/lib/niche.js) and the
   browser (js/niche-research.js loads this file directly from the site), so
   the cost shown before "Research My Niche" is the plan the server runs.

   Only endpoints taken from InsightSocial's published API reference
   (https://github.com/insightsocial/openapi) are planned, and only ones with
   a fixed price per call, so the cost of a run is known before it starts:
     tiktok/search/top          10 credits  (keyword; TikTok's Top tab)
     instagram/search/hashtag   50 credits  (hashtag; type=top)

   Plain data and pure functions only: no requires, no network.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisNicheSpec = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PLATFORMS = ["instagram", "tiktok"];
  const MAX_KEYWORDS = 20;
  const KEYWORD_MAX_CHARS = 60;
  // How many places one run searches. These bound a run's cost no matter how
  // many keywords the niche has: 7 x 10 + 3 x 50 = 220 credits at most.
  const TIKTOK_MAX_QUERIES = 7;
  const INSTAGRAM_MAX_HASHTAGS = 3;
  const HASHTAG_MAX_CHARS = 40;
  const DEFAULT_RUN_CREDIT_CAP = 250;
  // Saved results are reused for this long. Shorter than a day so a daily
  // run always refreshes them.
  const RESULT_TTL_HOURS = 20;
  const ITEMS_PER_SOURCE = 10;

  const STEP_TYPES = {
    "tiktok.search.top": { platform: "tiktok", credits: 10 },
    "instagram.search.hashtag": { platform: "instagram", credits: 50 }
  };

  // The most one run can cost: every search slot used.
  const MAX_RUN_CREDITS = TIKTOK_MAX_QUERIES * STEP_TYPES["tiktok.search.top"].credits +
    INSTAGRAM_MAX_HASHTAGS * STEP_TYPES["instagram.search.hashtag"].credits;

  function cleanKeyword(v) {
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    // eslint-disable-next-line no-control-regex
    if (t.length < 2 || t.length > KEYWORD_MAX_CHARS || /[\u0000-\u001f<>]/.test(t)) return "";
    return t;
  }

  function hashtagOf(keyword) {
    const t = String(keyword || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return t.length >= 2 && t.length <= HASHTAG_MAX_CHARS ? t : "";
  }

  // { keywords, platforms } from anything: unique cleaned keywords (case-
  // insensitive), known platforms only.
  function sanitizeProfile(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const seen = {};
    const keywords = [];
    (Array.isArray(r.keywords) ? r.keywords : []).forEach(function (k) {
      const c = cleanKeyword(k);
      if (!c || seen[c.toLowerCase()] || keywords.length >= MAX_KEYWORDS) return;
      seen[c.toLowerCase()] = true;
      keywords.push(c);
    });
    const platforms = PLATFORMS.filter(function (p) { return Array.isArray(r.platforms) && r.platforms.indexOf(p) !== -1; });
    return { keywords: keywords, platforms: platforms };
  }

  // The searches one run would make, in the order they are made.
  // -> { steps: [{id, platform, kind, label, endpoint, params, credits}], credits, omitted: {tiktok, instagram} }
  function planSearches(rawProfile) {
    const profile = sanitizeProfile(rawProfile);
    const steps = [];
    const omitted = { tiktok: 0, instagram: 0 };

    if (profile.platforms.indexOf("tiktok") !== -1) {
      profile.keywords.forEach(function (k, i) {
        if (i >= TIKTOK_MAX_QUERIES) { omitted.tiktok++; return; }
        steps.push({
          id: "tiktok:" + k.toLowerCase(), platform: "tiktok", kind: "keyword", label: k,
          endpoint: "tiktok.search.top", params: { query: k }, credits: STEP_TYPES["tiktok.search.top"].credits
        });
      });
    }
    if (profile.platforms.indexOf("instagram") !== -1) {
      const seenTags = {};
      let used = 0;
      profile.keywords.forEach(function (k) {
        const tag = hashtagOf(k);
        if (!tag || seenTags[tag]) return;
        seenTags[tag] = true;
        if (used >= INSTAGRAM_MAX_HASHTAGS) { omitted.instagram++; return; }
        used++;
        steps.push({
          id: "instagram:" + tag, platform: "instagram", kind: "hashtag", label: "#" + tag,
          endpoint: "instagram.search.hashtag", params: { hashtag: tag }, credits: STEP_TYPES["instagram.search.hashtag"].credits
        });
      });
    }
    const credits = steps.reduce(function (sum, s) { return sum + s.credits; }, 0);
    return { steps: steps, credits: credits, omitted: omitted };
  }

  return {
    PLATFORMS: PLATFORMS, MAX_KEYWORDS: MAX_KEYWORDS, KEYWORD_MAX_CHARS: KEYWORD_MAX_CHARS,
    TIKTOK_MAX_QUERIES: TIKTOK_MAX_QUERIES, INSTAGRAM_MAX_HASHTAGS: INSTAGRAM_MAX_HASHTAGS, HASHTAG_MAX_CHARS: HASHTAG_MAX_CHARS,
    DEFAULT_RUN_CREDIT_CAP: DEFAULT_RUN_CREDIT_CAP, RESULT_TTL_HOURS: RESULT_TTL_HOURS, ITEMS_PER_SOURCE: ITEMS_PER_SOURCE,
    STEP_TYPES: STEP_TYPES, MAX_RUN_CREDITS: MAX_RUN_CREDITS,
    cleanKeyword: cleanKeyword, hashtagOf: hashtagOf, sanitizeProfile: sanitizeProfile, planSearches: planSearches
  };
});
