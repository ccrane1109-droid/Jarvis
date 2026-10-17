/* ==========================================================================
   Niche-search plan shared by the server (functions/lib/niche.js) and the
   browser (js/niche-research.js loads this file directly from the site), so
   the cost shown before "Research My Niche" is the plan the server runs.

   Only endpoints taken from InsightSocial's published API reference
   (https://github.com/insightsocial/openapi) are planned, and only ones with
   a fixed price per call, so the cost of a run is known before it starts:
     tiktok/search/top          10 credits  (keyword; TikTok's Top tab)
     instagram/search/hashtag   50 credits  (hashtag; type=top)

   A run is either a "full sweep" (every search slot, up to 220 credits) or a
   "quick refresh" (a few TikTok keywords that rotate day by day, 30 credits),
   so a daily habit stays cheap and every keyword still gets its turn.

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
  // A quick refresh searches this many TikTok keywords, chosen by rotating
  // through the list one day at a time (see planSearches). TikTok only: its
  // search can be limited to the last 3 months, Instagram's hashtag search can't.
  const LEAN_TIKTOK_QUERIES = 3;
  // A full sweep is suggested when the last one is older than this.
  const FULL_SWEEP_DAYS = 7;
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

  const DAY_MS = 86400000;

  // Whole UTC days since 1970-01-01: the rotation position for a date.
  function dayIndex(date) {
    const t = date instanceof Date ? date.getTime() : NaN;
    return Number.isFinite(t) ? Math.floor(t / DAY_MS) : 0;
  }

  // "full" when no full sweep has run yet or the last one is a week old,
  // otherwise "quick". lastFullAt is an ISO date string or null.
  function suggestMode(lastFullAt, now) {
    const last = typeof lastFullAt === "string" ? Date.parse(lastFullAt) : NaN;
    const at = now instanceof Date ? now.getTime() : NaN;
    if (!Number.isFinite(last) || !Number.isFinite(at)) return "full";
    return (at - last) / DAY_MS >= FULL_SWEEP_DAYS ? "full" : "lean";
  }

  // When the last full sweep finished, from the saved niche state. Older saved
  // runs (before quick refreshes existed) were all full sweeps, so a successful
  // run that searched 8 or more places counts as one.
  function lastFullAtOf(state) {
    if (!state || typeof state !== "object") return null;
    if (typeof state.lastFullAt === "string" && !Number.isNaN(Date.parse(state.lastFullAt))) return state.lastFullAt;
    const run = state.lastRun;
    if (run && run.ok && !run.mode && Array.isArray(run.sources) && run.sources.length >= 8 && typeof state.lastSuccessfulRunAt === "string") {
      return state.lastSuccessfulRunAt;
    }
    return null;
  }

  function tiktokStep(k) {
    return {
      id: "tiktok:" + k.toLowerCase(), platform: "tiktok", kind: "keyword", label: k,
      endpoint: "tiktok.search.top", params: { query: k }, credits: STEP_TYPES["tiktok.search.top"].credits
    };
  }

  function instagramStep(tag) {
    return {
      id: "instagram:" + tag, platform: "instagram", kind: "hashtag", label: "#" + tag,
      endpoint: "instagram.search.hashtag", params: { hashtag: tag }, credits: STEP_TYPES["instagram.search.hashtag"].credits
    };
  }

  // n items starting at offset, wrapping around the list.
  function rotate(list, offset, n) {
    const out = [];
    for (let i = 0; i < Math.min(n, list.length); i++) out.push(list[(offset + i) % list.length]);
    return out;
  }

  // The searches one run would make, in the order they are made.
  //   opts.mode: "full" (default) searches the first 7 keywords on TikTok and the
  //   first 3 hashtags on Instagram; "lean" searches LEAN_TIKTOK_QUERIES TikTok
  //   keywords chosen by opts.dayIndex (or one Instagram hashtag if TikTok isn't
  //   selected), so consecutive days cover different keywords.
  // -> { mode, steps: [{id, platform, kind, label, endpoint, params, credits}], credits,
  //      omitted: {tiktok, instagram}, resting: {tiktok, instagram} }
  // omitted = keywords a full sweep can't fit; resting = keywords a quick refresh leaves for other days.
  function planSearches(rawProfile, opts) {
    const profile = sanitizeProfile(rawProfile);
    const mode = opts && opts.mode === "lean" ? "lean" : "full";
    const day = opts && Number.isInteger(opts.dayIndex) ? Math.abs(opts.dayIndex) : 0;
    const steps = [];
    const omitted = { tiktok: 0, instagram: 0 };
    const resting = { tiktok: 0, instagram: 0 };
    const wantsTikTok = profile.platforms.indexOf("tiktok") !== -1;
    const wantsInstagram = profile.platforms.indexOf("instagram") !== -1;

    const tags = [];
    const seenTags = {};
    profile.keywords.forEach(function (k) {
      const tag = hashtagOf(k);
      if (tag && !seenTags[tag]) { seenTags[tag] = true; tags.push(tag); }
    });

    if (mode === "lean") {
      if (wantsTikTok) {
        const picked = rotate(profile.keywords, (day * LEAN_TIKTOK_QUERIES) % Math.max(1, profile.keywords.length), LEAN_TIKTOK_QUERIES);
        picked.forEach(function (k) { steps.push(tiktokStep(k)); });
        resting.tiktok = profile.keywords.length - picked.length;
      } else if (wantsInstagram && tags.length) {
        steps.push(instagramStep(rotate(tags, day % tags.length, 1)[0]));
        resting.instagram = tags.length - 1;
      }
    } else {
      if (wantsTikTok) {
        profile.keywords.forEach(function (k, i) {
          if (i >= TIKTOK_MAX_QUERIES) { omitted.tiktok++; return; }
          steps.push(tiktokStep(k));
        });
      }
      if (wantsInstagram) {
        tags.forEach(function (tag, i) {
          if (i >= INSTAGRAM_MAX_HASHTAGS) { omitted.instagram++; return; }
          steps.push(instagramStep(tag));
        });
      }
    }
    const credits = steps.reduce(function (sum, s) { return sum + s.credits; }, 0);
    return { mode: mode, steps: steps, credits: credits, omitted: omitted, resting: resting };
  }

  return {
    PLATFORMS: PLATFORMS, MAX_KEYWORDS: MAX_KEYWORDS, KEYWORD_MAX_CHARS: KEYWORD_MAX_CHARS,
    TIKTOK_MAX_QUERIES: TIKTOK_MAX_QUERIES, INSTAGRAM_MAX_HASHTAGS: INSTAGRAM_MAX_HASHTAGS, HASHTAG_MAX_CHARS: HASHTAG_MAX_CHARS,
    DEFAULT_RUN_CREDIT_CAP: DEFAULT_RUN_CREDIT_CAP, RESULT_TTL_HOURS: RESULT_TTL_HOURS, ITEMS_PER_SOURCE: ITEMS_PER_SOURCE,
    STEP_TYPES: STEP_TYPES, MAX_RUN_CREDITS: MAX_RUN_CREDITS,
    LEAN_TIKTOK_QUERIES: LEAN_TIKTOK_QUERIES, FULL_SWEEP_DAYS: FULL_SWEEP_DAYS,
    cleanKeyword: cleanKeyword, hashtagOf: hashtagOf, sanitizeProfile: sanitizeProfile, planSearches: planSearches,
    dayIndex: dayIndex, suggestMode: suggestMode, lastFullAtOf: lastFullAtOf
  };
});
