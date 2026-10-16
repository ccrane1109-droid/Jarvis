/* ==========================================================================
   Validates and trims InsightSocial's post lists (search results) before
   anything is cached, stored or sent to the browser.

   InsightSocial's "schema 2" returns the same shape for every platform:
     data.items[].post = { id, url, kind, content: { text, ... }, author: { username, ... },
                           engagement: { views, likes, comments, shares, saves }, published_at, ... }
   (https://github.com/insightsocial/openapi). Anything that doesn't match
   is dropped rather than guessed at, links are kept only when they point at
   the right site over https, and text is capped. The browser still renders
   everything as plain text.
   ========================================================================== */

"use strict";

const nicheSpec = require("./niche-spec");

const MAX_TEXT_CHARS = 280;
const MAX_ID_CHARS = 64;
const MAX_URL_CHARS = 500;
const MAX_COUNT = 1e12;
const USERNAME_RE = /^[A-Za-z0-9._]{1,60}$/;

function plainText(v, max) {
  // eslint-disable-next-line no-control-regex
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function count(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null;
}

function isoOrNull(v) {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function hostMatches(hostname, domain) {
  const h = String(hostname || "").toLowerCase();
  return h === domain || h.slice(-(domain.length + 1)) === "." + domain;
}

// The post's own link, only if it is https and on the platform it claims.
function safeUrl(value, platform) {
  if (typeof value !== "string" || value.length > MAX_URL_CHARS) return null;
  let u;
  try { u = new URL(value); } catch (e) { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const domain = platform === "instagram" ? "instagram.com" : platform === "tiktok" ? "tiktok.com" : "";
  if (!domain || !hostMatches(u.hostname, domain)) return null;
  u.hash = "";
  return u.href.length <= MAX_URL_CHARS ? u.href : null;
}

function compactPost(post, platform) {
  if (!post || typeof post !== "object" || Array.isArray(post)) return null;
  const id = typeof post.id === "string" ? post.id.trim().slice(0, MAX_ID_CHARS) : "";
  if (!id) return null;
  const content = post.content && typeof post.content === "object" ? post.content : {};
  const author = post.author && typeof post.author === "object" ? post.author : {};
  const engagement = post.engagement && typeof post.engagement === "object" ? post.engagement : {};
  return {
    id: id,
    url: safeUrl(post.url, platform),
    text: plainText(content.text, MAX_TEXT_CHARS),
    author: typeof author.username === "string" && USERNAME_RE.test(author.username) ? author.username : null,
    views: count(engagement.views),
    likes: count(engagement.likes),
    comments: count(engagement.comments),
    shares: count(engagement.shares),
    publishedAt: isoOrNull(post.published_at)
  };
}

// Returns { items, dropped, total } or null when the body isn't a post list.
// dropped = rows that were unusable (no id, wrong shape) or repeated.
function reducePosts(platform, body) {
  const data = body && typeof body === "object" ? body.data : null;
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.items)) return null;
  const seen = {};
  const items = [];
  let dropped = 0;
  data.items.forEach(function (entry) {
    const c = compactPost(entry && entry.post, platform);
    if (!c || seen[c.id]) { dropped++; return; }
    seen[c.id] = true;
    // Past the cap results are simply not kept; only unusable rows count as dropped.
    if (items.length < nicheSpec.ITEMS_PER_SOURCE) items.push(c);
  });
  return { items: items, dropped: dropped, total: count(data.total) };
}

module.exports = { reducePosts, compactPost, safeUrl, plainText };
