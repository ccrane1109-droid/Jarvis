/* ==========================================================================
   JARVIS — Marketing numbers calculated from real research results.

   Pure functions with no page or network access, so every figure the
   Overview shows can be checked by tests. Nothing here estimates, predicts
   or fills gaps: when the data needed for a number isn't there, the number
   is null and the page says why.

   A "run" is the object the Marketing server returns for Research My Niche:
   { finishedAt, trigger, creditsUsed, sources: [{ platform, status, items: [post] }] }
   and a post is { id, url, text, author, views, likes, comments, shares, publishedAt }.
   A library post (the server's saved research memory) is a post plus
   { key, firstSeenAt, lastSeenAt, seenCount, prevViews, queries, sessions, bookmarked }.
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
  // A caption counts as relevant when it matches at least this share of one of
  // your keywords' words (an exact phrase is 100). Two-word keywords need both
  // words, three-word keywords two of three.
  const RELEVANT_MIN = 60;
  // Captions shorter than this are too short to call two posts copies.
  const MIN_CAPTION_CHARS = 12;
  const STOP_WORDS = { the: 1, and: 1, for: 1, with: 1, your: 1, you: 1, our: 1, are: 1, from: 1, that: 1, this: 1 };

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

  /* ---------------- keyword relevance, duplicates, filters, sorting ---------------- */

  function words(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").split(/\s+/).filter(Boolean);
  }

  // How closely a caption matches your research keywords: 0-100, or null when
  // the post has no caption (nothing to compare). It reads the caption only,
  // never the video. An exact phrase (also as a hashtag) is 100; otherwise it is
  // the share of a keyword's words found in the caption. matched lists the
  // keywords that cleared RELEVANT_MIN, best first.
  function keywordRelevance(text, keywords) {
    const caption = words(text);
    if (!caption.length) return null;
    const joined = " " + caption.join(" ") + " ";
    const squashed = caption.join("");
    const present = {};
    caption.forEach(function (w) { present[w] = true; });
    const scored = [];
    (Array.isArray(keywords) ? keywords : []).forEach(function (k) {
      const kw = words(k);
      if (!kw.length) return;
      let score;
      if (joined.indexOf(" " + kw.join(" ") + " ") !== -1 || (kw.join("").length >= 6 && squashed.indexOf(kw.join("")) !== -1)) {
        score = 100;
      } else {
        const useful = kw.filter(function (w) { return w.length >= 3 && !STOP_WORDS[w]; });
        const pool = useful.length ? useful : kw;
        score = Math.round(100 * pool.filter(function (w) { return present[w]; }).length / pool.length);
      }
      scored.push({ keyword: String(k), score: score });
    });
    if (!scored.length) return { score: 0, matched: [] };
    scored.sort(function (a, b) { return b.score - a.score; });
    return {
      score: scored[0].score,
      matched: scored.filter(function (x) { return x.score >= RELEVANT_MIN; }).map(function (x) { return x.keyword; })
    };
  }

  // Lower-case caption without links, hashtags, mentions and punctuation, or
  // null when it is too short to compare.
  function captionKey(text) {
    const t = String(text == null ? "" : text).toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[#@]\S+/g, " ")
      .replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
    return t.length >= MIN_CAPTION_CHARS ? t : null;
  }

  // Adds the derived fields the filters and sorts use. Every one is null when
  // the data for it is missing; nothing is estimated.
  function enrich(posts, keywords, now) {
    const rel = {};
    const list = posts.map(function (p) {
      const r = keywordRelevance(p.text, keywords);
      return Object.assign({}, p, {
        rate: engagementRate(p),
        age: ageDays(p.publishedAt, now),
        relevance: r ? r.score : null,
        matched: r ? r.matched : [],
        dupOf: null
      });
    });
    // Posts with the same caption: the most viewed one leads, the rest point at it.
    const groups = {};
    list.forEach(function (p, i) {
      const k = captionKey(p.text);
      if (k) (groups[k] = groups[k] || []).push(i);
    });
    Object.keys(groups).forEach(function (k) {
      const idx = groups[k];
      if (idx.length < 2) return;
      idx.sort(function (a, b) { return (isNum(list[b].views) ? list[b].views : -1) - (isNum(list[a].views) ? list[a].views : -1); });
      for (let j = 1; j < idx.length; j++) list[idx[j]].dupOf = list[idx[0]].key || list[idx[0]].id;
    });
    return list;
  }

  // filter: { platform: "all"|"instagram"|"tiktok", days: 0 (any) | N, minViews, minRate (0-1),
  //          relevantOnly, bookmarkedOnly, hideDupes, search, session }
  // Posts missing the data a filter needs are left out of that filter's results,
  // and counted in hidden so the page can say so.
  function filterPosts(list, f) {
    const q = String(f.search || "").trim().toLowerCase();
    const hidden = { undated: 0, noViews: 0, noRate: 0, noCaption: 0 };
    const out = list.filter(function (p) {
      if (f.platform && f.platform !== "all" && p.platform !== f.platform) return false;
      if (f.bookmarkedOnly && !p.bookmarked) return false;
      if (f.session && (!Array.isArray(p.sessions) || p.sessions.indexOf(f.session) === -1)) return false;
      if (f.hideDupes && p.dupOf) return false;
      if (q) {
        const hay = (String(p.text || "") + " " + (p.author || "") + " " + (Array.isArray(p.queries) ? p.queries.join(" ") : "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (f.days > 0) {
        if (p.age === null) { hidden.undated++; return false; }
        if (p.age > f.days) return false;
      }
      if (f.minViews > 0) {
        if (!isNum(p.views)) { hidden.noViews++; return false; }
        if (p.views < f.minViews) return false;
      }
      if (f.minRate > 0) {
        if (p.rate === null) { hidden.noRate++; return false; }
        if (p.rate < f.minRate) return false;
      }
      if (f.relevantOnly) {
        if (p.relevance === null) { hidden.noCaption++; return false; }
        if (p.relevance < RELEVANT_MIN) return false;
      }
      return true;
    });
    return { posts: out, hidden: hidden };
  }

  // by: "views" | "engagement" | "recent" | "relevance" | "new". Posts without the
  // sorted-by value go last, in their existing order.
  function sortPosts(list, by) {
    const pick = {
      views: function (p) { return isNum(p.views) ? p.views : null; },
      engagement: function (p) { return p.rate; },
      recent: function (p) { return p.publishedAt ? Date.parse(p.publishedAt) : null; },
      relevance: function (p) { return p.relevance; },
      "new": function (p) { return p.firstSeenAt ? Date.parse(p.firstSeenAt) : null; }
    }[by] || function () { return null; };
    return list.map(function (p, i) { return { p: p, i: i, v: pick(p) }; }).sort(function (a, b) {
      const av = a.v !== null && isFinite(a.v), bv = b.v !== null && isFinite(b.v);
      if (av && bv && a.v !== b.v) return b.v - a.v;
      if (av !== bv) return av ? -1 : 1;
      return a.i - b.i;
    }).map(function (x) { return x.p; });
  }

  // Growth since the previous sighting, only when there was one: { from, to, change }.
  function viewsChange(p) {
    if (!isNum(p.views) || !isNum(p.prevViews) || !p.prevSeenAt) return null;
    return { from: p.prevViews, to: p.views, change: p.views - p.prevViews, since: p.prevSeenAt };
  }

  return {
    MIN_VIEWS_FOR_RATE: MIN_VIEWS_FOR_RATE, FRESH_DAYS: FRESH_DAYS, RELEVANT_MIN: RELEVANT_MIN,
    engagementRate: engagementRate, formatRate: formatRate, uniquePosts: uniquePosts, ageDays: ageDays,
    runStats: runStats, describeRun: describeRun,
    keywordRelevance: keywordRelevance, captionKey: captionKey, enrich: enrich, filterPosts: filterPosts, sortPosts: sortPosts, viewsChange: viewsChange
  };
});
