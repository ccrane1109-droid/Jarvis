/* ==========================================================================
   JARVIS — Marketing numbers calculated from real research results.

   Pure functions with no page or network access, so every figure the
   Overview shows can be checked by tests. Nothing here estimates, predicts
   or fills gaps: when the data needed for a number isn't there, the number
   is null and the page says why.

   A "run" is the object the Marketing server returns for Research My Niche:
   { finishedAt, trigger, creditsUsed, sources: [{ platform, status, items: [post] }] }
   and a post is { id, url, text, author, views, likes, comments, shares, publishedAt }.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisMarketingStats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Below this many views a post's engagement rate is too noisy to use.
  const MIN_VIEWS_FOR_RATE = 100;
  // "Recent" means published within this many days.
  const FRESH_DAYS = 30;
  const DAY_MS = 864e5;
  const PLATFORM_NAMES = { instagram: "Instagram", tiktok: "TikTok" };

  function isNum(n) { return typeof n === "number" && isFinite(n); }

  // (likes + comments + shares) / views, using only the counts the platform
  // reported. Null without a usable view count or without any other count.
  function engagementRate(item) {
    if (!item || !isNum(item.views) || item.views < MIN_VIEWS_FOR_RATE) return null;
    const reported = [item.likes, item.comments, item.shares].filter(isNum);
    if (!reported.length) return null;
    return reported.reduce(function (sum, n) { return sum + n; }, 0) / item.views;
  }

  function formatRate(rate) {
    return isNum(rate) ? (rate * 100).toFixed(1) + "%" : "—";
  }

  // Posts from every search in the run, each counted once per platform.
  function uniquePosts(run) {
    const seen = {};
    const out = [];
    (run && Array.isArray(run.sources) ? run.sources : []).forEach(function (s) {
      (Array.isArray(s.items) ? s.items : []).forEach(function (it) {
        if (!it || typeof it !== "object" || typeof it.id !== "string") return;
        const key = s.platform + ":" + it.id;
        if (seen[key]) return;
        seen[key] = true;
        out.push({ platform: s.platform, via: s.label, item: it });
      });
    });
    return out;
  }

  function ageDays(iso, now) {
    if (typeof iso !== "string") return null;
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    return Math.max(0, Math.floor(((now instanceof Date ? now.getTime() : Date.now()) - t) / DAY_MS));
  }

  function mean(list) { return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : null; }
  function median(list) {
    if (!list.length) return null;
    const s = list.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Everything the Overview shows about the latest run. Null run -> null.
  function runStats(run, now) {
    if (!run || !Array.isArray(run.sources)) return null;
    const posts = uniquePosts(run);
    const byPlatform = { instagram: 0, tiktok: 0 };
    const ratedByPlatform = { instagram: 0, tiktok: 0 };
    const rates = [];
    const ages = [];
    posts.forEach(function (p) {
      if (byPlatform[p.platform] !== undefined) byPlatform[p.platform]++;
      const rate = engagementRate(p.item);
      if (rate !== null) {
        rates.push(rate);
        if (ratedByPlatform[p.platform] !== undefined) ratedByPlatform[p.platform]++;
      }
      const age = ageDays(p.item.publishedAt, now);
      if (age !== null) ages.push(age);
    });
    const sources = run.sources;
    const topByViews = posts.filter(function (p) { return isNum(p.item.views); })
      .sort(function (a, b) { return b.item.views - a.item.views; }).slice(0, 3);
    return {
      posts: posts.length,
      byPlatform: byPlatform,
      ratedByPlatform: ratedByPlatform,
      rated: rates.length,
      avgRate: mean(rates),
      medianRate: median(rates),
      dated: ages.length,
      fresh: ages.filter(function (a) { return a <= FRESH_DAYS; }).length,
      newestDays: ages.length ? Math.min.apply(null, ages) : null,
      oldestDays: ages.length ? Math.max.apply(null, ages) : null,
      topByViews: topByViews,
      searches: {
        total: sources.length,
        ok: sources.filter(function (s) { return s.status === "completed" || s.status === "cached"; }).length,
        failed: sources.filter(function (s) { return s.status === "failed"; }).length,
        skipped: sources.filter(function (s) { return s.status === "unavailable"; }).length
      },
      creditsUsed: isNum(run.creditsUsed) ? run.creditsUsed : 0,
      finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
      trigger: run.trigger === "schedule" ? "scheduled" : "manual"
    };
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }

  // Plain sentences describing the stats. Each says only what the numbers show.
  function describeRun(stats) {
    if (!stats) return [];
    const lines = [];
    const s = stats.searches;
    if (!stats.posts) {
      lines.push("The searches ran but returned no posts. Try broader keywords in Edit niche.");
    } else {
      const parts = [];
      if (stats.byPlatform.tiktok) parts.push(stats.byPlatform.tiktok + " TikTok");
      if (stats.byPlatform.instagram) parts.push(stats.byPlatform.instagram + " Instagram");
      lines.push(plural(s.ok, "search", "searches") + " of " + s.total + " returned results: " + plural(stats.posts, "post") + " (" + parts.join(", ") + ")." +
        (s.failed ? " " + plural(s.failed, "search", "searches") + " failed." : "") +
        (s.skipped ? " " + plural(s.skipped, "search", "searches") + " skipped to stay within your credit limits." : ""));
    }
    if (stats.posts) {
      if (stats.dated) {
        lines.push(stats.fresh + " of " + stats.dated + " posts with a date were published in the last " + FRESH_DAYS + " days. The newest is " +
          plural(stats.newestDays, "day") + " old and the oldest " + plural(stats.oldestDays, "day") + ".");
      } else {
        lines.push("None of these posts included a publish date, so how recent they are can't be checked.");
      }
      if (stats.rated) {
        lines.push("Average engagement rate is " + formatRate(stats.avgRate) + " (typical post " + formatRate(stats.medianRate) + ") across " +
          plural(stats.rated, "post") + " that report at least " + MIN_VIEWS_FOR_RATE + " views. Rate = (likes + comments + shares) ÷ views.");
      } else {
        lines.push("Engagement rate needs view counts, and none of these posts reported at least " + MIN_VIEWS_FOR_RATE + " views.");
      }
      Object.keys(PLATFORM_NAMES).forEach(function (p) {
        if (stats.byPlatform[p] >= 3 && stats.ratedByPlatform[p] / stats.byPlatform[p] < 0.5) {
          lines.push("Most " + PLATFORM_NAMES[p] + " posts here don't report views, so they're left out of the engagement rate.");
        }
      });
    }
    return lines;
  }

  return {
    MIN_VIEWS_FOR_RATE: MIN_VIEWS_FOR_RATE, FRESH_DAYS: FRESH_DAYS,
    engagementRate: engagementRate, formatRate: formatRate, uniquePosts: uniquePosts, ageDays: ageDays,
    runStats: runStats, describeRun: describeRun
  };
});
