/* ==========================================================================
   Research memory: every post a niche search returns is kept (once) so the
   Discover tab can be filtered, sorted and searched across all past runs, and
   so a post seen again later can show how its numbers changed.

   Firestore (written only by the server; the page reads it through the
   marketingLibrary callable, so no Firestore rules are needed):
     users/{uid}/marketingPosts/{platform}_{postId}
        { key, platform, id, url, text, author, views, likes, comments, shares, publishedAt,
          firstSeenAt, lastSeenAt, seenCount, prevViews, prevSeenAt,
          history[{at, views, likes, comments, shares}], queries[], sessions[],
          bookmarked, bookmarkedAt }
     users/{uid}/marketingState/library  { count, bookmarks, updatedAt }

   Every number is exactly what InsightSocial reported at the time it was
   fetched ("at" is the fetch time, not the time JARVIS looked at it).
   ========================================================================== */

"use strict";

const insight = require("./insight");

const KEY_RE = /^(instagram|tiktok)_[A-Za-z0-9._-]{1,64}$/;
const MAX_POSTS = 1000;
// When the library grows past MAX_POSTS the least recently seen posts that
// aren't bookmarked are removed, down to this many.
const PRUNE_TO = 900;
const MAX_BOOKMARKS = 300;
const HISTORY_LIMIT = 30;
const QUERIES_LIMIT = 8;
const SESSIONS_LIMIT = 8;
const CHUNK = 20;

const postsPath = (uid) => "users/" + uid + "/marketingPosts";
const statePath = (uid) => "users/" + uid + "/marketingState/library";

function postKey(platform, id) {
  const key = platform + "_" + id;
  return KEY_RE.test(key) ? key : null;
}

function numberOrNull(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

function mergeList(existing, additions, limit) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  additions.forEach(function (a) {
    if (a && out.indexOf(a) === -1) out.push(a);
  });
  return out.slice(-limit);
}

// The browser-facing copy of a stored post: no history array, just the
// previous sighting's views so the page can show a change.
function publicPost(d) {
  return {
    key: d.key, platform: d.platform, id: d.id, url: d.url || null, text: d.text || "", author: d.author || null,
    views: numberOrNull(d.views), likes: numberOrNull(d.likes), comments: numberOrNull(d.comments), shares: numberOrNull(d.shares),
    publishedAt: d.publishedAt || null,
    firstSeenAt: d.firstSeenAt || null, lastSeenAt: d.lastSeenAt || null, seenCount: numberOrNull(d.seenCount) || 1,
    prevViews: numberOrNull(d.prevViews), prevSeenAt: d.prevSeenAt || null,
    queries: Array.isArray(d.queries) ? d.queries : [], sessions: Array.isArray(d.sessions) ? d.sessions : [],
    bookmarked: d.bookmarked === true
  };
}

// The stored post after this sighting. existing is null for a post not seen before.
function mergePost(existing, item, platform, at, query, sessionId) {
  const key = postKey(platform, item.id);
  const point = { at: at, views: item.views, likes: item.likes, comments: item.comments, shares: item.shares };
  if (!existing) {
    return {
      key: key, platform: platform, id: item.id, url: item.url || null, text: item.text || "", author: item.author || null,
      views: item.views, likes: item.likes, comments: item.comments, shares: item.shares, publishedAt: item.publishedAt || null,
      firstSeenAt: at, lastSeenAt: at, seenCount: 1, prevViews: null, prevSeenAt: null,
      history: [point], queries: query ? [query] : [], sessions: sessionId ? [sessionId] : [],
      bookmarked: false, bookmarkedAt: null
    };
  }
  const next = Object.assign({}, existing);
  next.queries = mergeList(existing.queries, [query], QUERIES_LIMIT);
  next.sessions = mergeList(existing.sessions, [sessionId], SESSIONS_LIMIT);
  // The same fetched result seen again (a cached search) adds no new data point.
  if (typeof existing.lastSeenAt === "string" && existing.lastSeenAt >= at) return next;
  const pick = function (fresh, old) { return fresh !== null && fresh !== undefined ? fresh : (old === undefined ? null : old); };
  next.url = item.url || existing.url || null;
  next.text = item.text || existing.text || "";
  next.author = item.author || existing.author || null;
  next.publishedAt = item.publishedAt || existing.publishedAt || null;
  next.prevViews = numberOrNull(existing.views);
  next.prevSeenAt = existing.lastSeenAt || null;
  next.views = pick(item.views, existing.views);
  next.likes = pick(item.likes, existing.likes);
  next.comments = pick(item.comments, existing.comments);
  next.shares = pick(item.shares, existing.shares);
  next.lastSeenAt = at;
  next.seenCount = (numberOrNull(existing.seenCount) || 1) + 1;
  next.history = (Array.isArray(existing.history) ? existing.history : []).concat([point]).slice(-HISTORY_LIMIT);
  return next;
}

async function readState(deps, uid) {
  const snap = await deps.db.doc(statePath(uid)).get();
  const d = snap.exists ? snap.data() : {};
  return { count: numberOrNull(d.count) || 0, bookmarks: numberOrNull(d.bookmarks) || 0 };
}

async function writeState(deps, uid, state) {
  await deps.db.doc(statePath(uid)).set({ count: Math.max(0, state.count), bookmarks: Math.max(0, state.bookmarks), updatedAt: deps.now().toISOString() });
}

// Removes the least recently seen posts that aren't bookmarked. Returns the new state.
async function prune(deps, uid) {
  const snap = await deps.db.collection(postsPath(uid)).get();
  const rows = snap.docs.map(function (d) { return { id: d.id, data: d.data() }; });
  const bookmarks = rows.filter(function (r) { return r.data.bookmarked === true; }).length;
  const removable = rows.filter(function (r) { return r.data.bookmarked !== true; }).sort(function (a, b) {
    const x = String(a.data.lastSeenAt || ""), y = String(b.data.lastSeenAt || "");
    return x < y ? -1 : x > y ? 1 : (numberOrNull(a.data.seenCount) || 1) - (numberOrNull(b.data.seenCount) || 1);
  });
  const excess = Math.min(removable.length, Math.max(0, rows.length - PRUNE_TO));
  for (let i = 0; i < excess; i++) await deps.db.doc(postsPath(uid) + "/" + removable[i].id).delete();
  return { count: rows.length - excess, bookmarks: bookmarks, pruned: excess };
}

// Saves the posts of one finished niche run. Returns what happened, counted
// honestly: created (new to the library), updated (seen before), skipped (an id
// that can't be stored). Never throws for one bad post.
async function ingestRun(uid, deps, run) {
  const found = {};
  let skipped = 0;
  (run.sources || []).forEach(function (s) {
    if (s.status !== "completed" && s.status !== "cached") return;
    const at = s.fetchedAt || run.finishedAt || run.startedAt;
    (s.items || []).forEach(function (item) {
      const key = postKey(s.platform, item && item.id);
      if (!key) { skipped++; return; }
      const f = found[key];
      if (!f) found[key] = { platform: s.platform, item: item, at: at, queries: [s.label] };
      else {
        f.queries.push(s.label);
        if (at > f.at) { f.item = item; f.at = at; }
      }
    });
  });

  const keys = Object.keys(found);
  let created = 0;
  let updated = 0;
  for (let i = 0; i < keys.length; i += CHUNK) {
    await Promise.all(keys.slice(i, i + CHUNK).map(async function (key) {
      const f = found[key];
      const ref = deps.db.doc(postsPath(uid) + "/" + key);
      const snap = await ref.get();
      const existing = snap.exists ? snap.data() : null;
      // Merge the first query here, the rest below, so every search that found it is listed.
      let next = mergePost(existing, f.item, f.platform, f.at, f.queries[0], run.id);
      for (let q = 1; q < f.queries.length; q++) next.queries = mergeList(next.queries, [f.queries[q]], QUERIES_LIMIT);
      await ref.set(next);
      if (existing) updated++; else created++;
    }));
  }

  let state = await readState(deps, uid);
  state = { count: state.count + created, bookmarks: state.bookmarks };
  let pruned = 0;
  if (state.count > MAX_POSTS) {
    const after = await prune(deps, uid);
    state = after;
    pruned = after.pruned;
  }
  await writeState(deps, uid, state);
  return { saved: keys.length, created: created, updated: updated, skipped: skipped, pruned: pruned, count: state.count };
}

async function listLibrary(uid, deps) {
  const snap = await deps.db.collection(postsPath(uid)).get();
  const posts = snap.docs.map(function (d) { return d.data(); }).filter(function (d) { return d && KEY_RE.test(d.key || ""); }).map(publicPost);
  posts.sort(function (a, b) {
    const x = String(a.lastSeenAt || ""), y = String(b.lastSeenAt || "");
    return x < y ? 1 : x > y ? -1 : (b.views || 0) - (a.views || 0);
  });
  const state = await readState(deps, uid);
  return { ok: true, posts: posts.slice(0, MAX_POSTS), total: posts.length, bookmarks: posts.filter(function (p) { return p.bookmarked; }).length, limit: MAX_POSTS, count: state.count };
}

async function setBookmark(uid, deps, key, bookmarked) {
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new insight.InsightError("invalid-argument", "That isn't a post in your library.");
  const want = bookmarked === true;
  const ref = deps.db.doc(postsPath(uid) + "/" + key);
  const snap = await ref.get();
  if (!snap.exists) throw new insight.InsightError("not-found", "That post isn't in your library any more.");
  const was = snap.data().bookmarked === true;
  const state = await readState(deps, uid);
  if (want && !was && state.bookmarks >= MAX_BOOKMARKS) {
    throw new insight.InsightError("resource-exhausted", "You have " + MAX_BOOKMARKS + " bookmarked posts, the most JARVIS keeps. Remove a bookmark first.");
  }
  if (want !== was) {
    await ref.set({ bookmarked: want, bookmarkedAt: want ? deps.now().toISOString() : null }, { merge: true });
    await writeState(deps, uid, { count: state.count, bookmarks: state.bookmarks + (want ? 1 : -1) });
  }
  return { ok: true, key: key, bookmarked: want };
}

// The marketingLibrary callable: { action: "list" } or { action: "bookmark", key, bookmarked }.
async function handle(uid, data, deps) {
  insight.requireOwner(uid, deps);
  const action = data && data.action;
  if (action === "list") return listLibrary(uid, deps);
  if (action === "bookmark") return setBookmark(uid, deps, data.key, data.bookmarked);
  throw new insight.InsightError("invalid-argument", "Unknown library action.");
}

module.exports = {
  KEY_RE, MAX_POSTS, PRUNE_TO, MAX_BOOKMARKS, HISTORY_LIMIT,
  postKey, mergePost, publicPost, ingestRun, listLibrary, setBookmark, handle
};
