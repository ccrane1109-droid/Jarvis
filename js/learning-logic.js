/* ==========================================================================
   JARVIS — Learning & Research Hub: the rules (pure functions; no page, storage or network, so they can be
   tested outside the browser).

   Five kinds of record, each its own list in its own storage key (and its own cloud-backup key, merged by id):
     books     jarvisLearnBooks     { id, title, author, category, totalPages, currentPage, status, startDate, endDate,
                                      rating, cover, log: [{ d, p }], createdAt, updatedAt, deletedAt? }
     research  jarvisLearnResearch  { id, title, category, question, purpose, priority, status, conclusion, completedAt,
                                      sources: [{ id, title, url, kind, note, addedAt }], createdAt, updatedAt, deletedAt? }
     notes     jarvisLearnNotes     { id, type, title, text, evidence, page, tags[], category, bookIds[], researchIds[],
                                      sourceId, important, day, createdAt, updatedAt, deletedAt? }
     actions   jarvisLearnActions   { id, lesson, plan, sourceType, sourceId, sourceLabel, targetDate, status,
                                      implementedAt, createdAt, updatedAt, deletedAt? }
     reviews   jarvisLearnReviews   { id (= "wk_" + the Monday), weekStart, reflection, focusNext, createdAt, updatedAt }

   Nothing is invented. Every count, percentage and weekly figure is worked out from these records:
     - reading progress is currentPage / totalPages (unknown when the total isn't set);
     - pages read in a week come from the page updates you logged (book.log), never from a guess: pages before a
       book's first logged update are not counted, and nothing is credited on days with no update;
     - the weekly review lists what the records say happened that week and says so plainly when nothing did.

   Deleting keeps a "tombstone" (deletedAt) for 30 days so a deletion reaches your other devices; purge() then drops it.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisLearningLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEYS = { books: "jarvisLearnBooks", research: "jarvisLearnResearch", notes: "jarvisLearnNotes", actions: "jarvisLearnActions", reviews: "jarvisLearnReviews" };
  // The id prefix of each kind. Other modules (cards, goals, reading sessions, collections) add theirs with registerKind().
  const PREFIX = { books: "bk", research: "rs", notes: "nt", actions: "ac", reviews: "wk" };
  // The spaced-repetition rules live in learning-srs.js (loaded first in the page; required in Node).
  function srsMod() { return typeof module === "object" && module.exports ? require("./learning-srs") : (typeof self !== "undefined" ? self : globalThis).JarvisLearningSRS; }
  const TOMBSTONE_DAYS = 30;
  const MAX_COVER_CHARS = 90000;       // a resized cover is about 20-40 KB; this is the ceiling
  const MAX_LOG = 400;

  const BOOK_STATUS = [{ key: "want", label: "Want to Read" }, { key: "reading", label: "Reading" }, { key: "completed", label: "Completed" }, { key: "paused", label: "Paused" }];
  const RESEARCH_STATUS = [{ key: "planned", label: "Planned" }, { key: "researching", label: "Researching" }, { key: "analyzing", label: "Analyzing" }, { key: "completed", label: "Completed" }];
  const PRIORITY = [{ key: "low", label: "Low" }, { key: "medium", label: "Medium" }, { key: "high", label: "High" }];
  const ACTION_STATUS = [{ key: "todo", label: "Not Started" }, { key: "doing", label: "In Progress" }, { key: "done", label: "Implemented" }];
  const NOTE_TYPE = [
    { key: "takeaway", label: "Key takeaway" }, { key: "chapter", label: "Chapter summary" }, { key: "quote", label: "Quote" },
    { key: "reflection", label: "Reflection" }, { key: "finding", label: "Finding" }, { key: "opinion", label: "My opinion" },
    { key: "idea", label: "Research idea" }, { key: "question", label: "Question" }, { key: "note", label: "Note" }
  ];
  // Kinds of note that can be reviewed with spaced repetition (an idea or a question is not a lesson to remember).
  const SRS_TYPES = ["takeaway", "chapter", "quote", "reflection", "finding", "opinion", "note"];
  const SOURCE_STATE = [{ key: "unreviewed", label: "Not reviewed" }, { key: "reading", label: "Reading" }, { key: "reviewed", label: "Reviewed" }];
  const SOURCE_KIND = [{ key: "article", label: "Article" }, { key: "video", label: "Video" }, { key: "website", label: "Website" }, { key: "paper", label: "Paper" }, { key: "book", label: "Book" }, { key: "other", label: "Other" }];

  const keysOf = function (list) { return list.map(function (x) { return x.key; }); };
  const labelOf = function (list, key) { const f = list.filter(function (x) { return x.key === key; })[0]; return f ? f.label : ""; };
  const BOOK_KEYS = keysOf(BOOK_STATUS), RESEARCH_KEYS = keysOf(RESEARCH_STATUS), PRIORITY_KEYS = keysOf(PRIORITY), ACTION_KEYS = keysOf(ACTION_STATUS), NOTE_KEYS = keysOf(NOTE_TYPE), SOURCE_KEYS = keysOf(SOURCE_KIND), SOURCE_STATE_KEYS = keysOf(SOURCE_STATE);

  /* ---------------- small helpers ---------------- */

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  // Single-line text: control characters and runs of spaces collapsed, trimmed, cut to max.
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  // Multi-line text: newlines kept, other control characters dropped, trimmed, cut to max.
  function para(v, max) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : ""; }
  function pick(list, v, fallback) { return list.indexOf(v) !== -1 ? v : fallback; }
  function intIn(v, lo, hi, fallback) { const n = typeof v === "number" ? v : (typeof v === "string" && /^\d{1,7}$/.test(v.trim()) ? Number(v) : NaN); return isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi ? n : fallback; }

  function isDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function dayMs(s) { return Date.parse(s + "T00:00:00Z"); }
  function addDays(s, n) { return new Date(dayMs(s) + n * 86400000).toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((dayMs(b) - dayMs(a)) / 86400000); }     // b - a
  function weekStart(s) { const wd = new Date(dayMs(s)).getUTCDay(); return addDays(s, -((wd + 6) % 7)); }   // the Monday on or before s
  function localDate(ms) { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dayOfRecord(r) { return isDate(r.day) ? r.day : (num(r.createdAt) ? localDate(r.createdAt) : ""); }

  function live(list) { return (Array.isArray(list) ? list : []).filter(function (r) { return r && !r.deletedAt; }); }
  function stamp(r, now) { return Object.assign({}, r, { updatedAt: now }); }
  function tombstone(r, now) { return Object.assign({}, r, { deletedAt: now, updatedAt: now }); }
  function restore(r, now) { const c = Object.assign({}, r, { updatedAt: now }); delete c.deletedAt; return c; }
  // Drops records deleted more than 30 days ago.
  function purge(list, now) { const cutoff = now - TOMBSTONE_DAYS * 86400000; return (list || []).filter(function (r) { return !(r && r.deletedAt && r.deletedAt < cutoff); }); }

  // #tags and commas -> up to 12 lowercase tags of up to 30 characters each, each once.
  function parseTags(v) {
    const parts = Array.isArray(v) ? v : (typeof v === "string" ? v.split(/[,\n]+/) : []);
    const out = [];
    parts.forEach(function (p) {
      const t = line(String(p == null ? "" : p), 60).replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9À-￿_-]+/g, "").replace(/^-+|-+$/g, "").slice(0, 30);
      if (t && out.indexOf(t) === -1 && out.length < 12) out.push(t);
    });
    return out;
  }
  function idList(v) { const out = []; (Array.isArray(v) ? v : []).forEach(function (x) { if (typeof x === "string" && x && x.length <= 80 && out.indexOf(x) === -1 && out.length < 50) out.push(x); }); return out; }

  // A web address someone typed: "example.com/x" gets https://; only http and https are accepted. -> normalised text or ""
  function cleanUrl(v) {
    let s = typeof v === "string" ? v.trim() : "";
    if (!s || s.length > 2000 || /\s/.test(s)) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    if (!/^https?:\/\//i.test(s)) return "";
    try { const u = new URL(s); return u.hostname && u.hostname.indexOf(".") !== -1 ? u.href : ""; } catch (e) { return ""; }
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function coverOk(v) { return typeof v === "string" && v.length <= MAX_COVER_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v); }

  /* ---------------- reading progress ---------------- */

  // Percent read (0-100, whole number) or null when the total number of pages isn't known.
  function progress(book) {
    const total = num(book && book.totalPages), cur = num(book && book.currentPage);
    if (total <= 0) return null;
    return Math.max(0, Math.min(100, Math.round(cur / total * 100)));
  }
  function pagesLeft(book) { const t = num(book && book.totalPages); return t > 0 ? Math.max(0, t - num(book.currentPage)) : null; }

  // Records a new current page for a day (one entry per day; a second update the same day replaces it).
  function withPage(book, page, today, now) {
    const log = (Array.isArray(book.log) ? book.log : []).slice();
    const at = log.length ? log.length - 1 : -1;
    if (at >= 0 && log[at].d === today) log[at] = { d: today, p: page };
    else log.push({ d: today, p: page });
    while (log.length > MAX_LOG) log.splice(1, 1);                 // keep the first entry: it is where counting starts
    return Object.assign({}, book, { currentPage: page, log: log, updatedAt: now });
  }

  // Pages read per day, from the logged updates only. Each page is counted once: a day's pages are how far past the furthest page
  // reached so far the update went. So correcting a page number downwards, or going back to re-read, adds nothing, and the
  // pages in between are counted when you get past the old high point (100 -> 120 -> corrected to 110 -> 130 is 30 pages, not 40).
  // The first logged update is the starting point and adds nothing. -> [{ d, pages }] oldest first, one entry per day with updates.
  function dailyPages(book) {
    const log = (Array.isArray(book && book.log) ? book.log : []).filter(function (e) { return e && isDate(e.d) && typeof e.p === "number" && isFinite(e.p) && e.p >= 0; });
    if (!log.length) return [];
    log.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    let high = log[0].p;
    const byDay = {}, order = [];
    log.forEach(function (e, i) {
      const gained = i === 0 ? 0 : Math.max(0, e.p - high);
      high = Math.max(high, e.p);
      if (!(e.d in byDay)) { byDay[e.d] = 0; order.push(e.d); }
      byDay[e.d] += gained;
    });
    return order.map(function (d) { return { d: d, pages: byDay[d] }; });
  }
  // Pages read between two dates (inclusive).
  function pagesInRange(book, from, to) {
    return dailyPages(book).reduce(function (sum, e) { return e.d >= from && e.d <= to ? sum + e.pages : sum; }, 0);
  }
  function lastLogged(book) {
    const log = (Array.isArray(book && book.log) ? book.log : []).filter(function (e) { return e && isDate(e.d); });
    return log.length ? log.reduce(function (m, e) { return e.d > m ? e.d : m; }, "") : "";
  }

  /* ---------------- reading what's stored ---------------- */

  function base(raw) {
    return { id: raw.id, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), deletedAt: num(raw.deletedAt) || undefined };
  }
  function undef(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }

  function readBook(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const title = line(raw.title, 200);
    if (!title) return null;
    const total = intIn(raw.totalPages, 0, 100000, 0);
    let cur = intIn(raw.currentPage, 0, 100000, 0);
    if (total > 0 && cur > total) cur = total;
    const log = (Array.isArray(raw.log) ? raw.log : []).filter(function (e) { return isObj(e) && isDate(e.d) && intIn(e.p, 0, 100000, -1) >= 0; }).map(function (e) { return { d: e.d, p: e.p }; }).slice(-MAX_LOG);
    return undef(Object.assign(base(raw), {
      title: title, author: line(raw.author, 120), category: line(raw.category, 60), totalPages: total, currentPage: cur,
      status: pick(BOOK_KEYS, raw.status, "want"), startDate: isDate(raw.startDate) ? raw.startDate : "", endDate: isDate(raw.endDate) ? raw.endDate : "",
      rating: intIn(raw.rating, 0, 5, 0), cover: coverOk(raw.cover) ? raw.cover : "", log: log
    }));
  }
  function readSource(raw) {
    if (!isObj(raw)) return null;
    const url = cleanUrl(raw.url);
    if (!url || typeof raw.id !== "string" || !raw.id) return null;
    return { id: raw.id, title: line(raw.title, 200) || hostOf(url), url: url, kind: pick(SOURCE_KEYS, raw.kind, "article"), note: line(raw.note, 500), addedAt: num(raw.addedAt),
      state: pick(SOURCE_STATE_KEYS, raw.state, "unreviewed"), credibility: para(raw.credibility, 600) };
  }
  // A research checklist: [{ id, text, done, doneAt }]. doneAt is the day it was ticked (only when it is ticked).
  function readChecklist(raw) {
    const seen = {};
    return (Array.isArray(raw) ? raw : []).map(function (x) {
      if (!isObj(x) || typeof x.id !== "string" || !x.id || seen[x.id]) return null;
      const text = line(x.text, 200);
      if (!text) return null;
      seen[x.id] = true;
      return { id: x.id, text: text, done: x.done === true, doneAt: x.done === true && isDate(x.doneAt) ? x.doneAt : "" };
    }).filter(Boolean).slice(0, 60);
  }
  function checklistProgress(r) {
    const list = (r && r.checklist) || [], done = list.filter(function (x) { return x.done; }).length;
    return { done: done, total: list.length, pct: list.length ? Math.round(done / list.length * 100) : null };
  }
  function readResearch(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const title = line(raw.title, 200);
    if (!title) return null;
    const seen = {};
    const sources = (Array.isArray(raw.sources) ? raw.sources : []).map(readSource).filter(function (s) { if (!s || seen[s.id]) return false; seen[s.id] = true; return true; }).slice(0, 200);
    const status = pick(RESEARCH_KEYS, raw.status, "planned");
    return undef(Object.assign(base(raw), {
      title: title, category: line(raw.category, 60), question: para(raw.question, 500), purpose: para(raw.purpose, 1000),
      priority: pick(PRIORITY_KEYS, raw.priority, "medium"), status: status, conclusion: para(raw.conclusion, 5000),
      completedAt: status === "completed" && isDate(raw.completedAt) ? raw.completedAt : "", sources: sources,
      checklist: readChecklist(raw.checklist), archived: raw.archived === true ? true : undefined, template: line(raw.template, 40) || undefined
    }));
  }
  function readNote(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const text = para(raw.text, 10000);
    if (!text) return null;
    return undef(Object.assign(base(raw), {
      type: pick(NOTE_KEYS, raw.type, "note"), title: line(raw.title, 200), text: text, evidence: para(raw.evidence, 5000), page: line(raw.page, 40),
      tags: parseTags(raw.tags), category: line(raw.category, 60), bookIds: idList(raw.bookIds), researchIds: idList(raw.researchIds),
      sourceId: typeof raw.sourceId === "string" ? raw.sourceId.slice(0, 80) : "", important: raw.important === true, day: isDate(raw.day) ? raw.day : "",
      linkIds: idList(raw.linkIds), inbox: raw.inbox === true ? true : undefined, srs: srsMod().read(raw.srs) || undefined
    }));
  }
  function readAction(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const lesson = para(raw.lesson, 500);
    if (!lesson) return null;
    const status = pick(ACTION_KEYS, raw.status, "todo");
    const st = pick(["none", "book", "research", "note", "other"], raw.sourceType, "none");
    return undef(Object.assign(base(raw), {
      lesson: lesson, plan: para(raw.plan, 2000), sourceType: st, sourceId: st === "other" || st === "none" ? "" : (typeof raw.sourceId === "string" ? raw.sourceId.slice(0, 80) : ""),
      sourceLabel: st === "other" ? line(raw.sourceLabel, 200) : "", targetDate: isDate(raw.targetDate) ? raw.targetDate : "", status: status,
      implementedAt: status === "done" && isDate(raw.implementedAt) ? raw.implementedAt : "", inbox: raw.inbox === true ? true : undefined
    }));
  }
  function readReview(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || !isDate(raw.weekStart)) return null;
    // reflection = "my biggest lesson" and focusNext = "what I want to improve next week" (the two boxes the first version had);
    // struggled and applied are new. A review saved before they existed simply has them empty.
    return undef(Object.assign(base(raw), { weekStart: raw.weekStart, reflection: para(raw.reflection, 5000), struggled: para(raw.struggled, 5000), applied: para(raw.applied, 5000), focusNext: para(raw.focusNext, 2000) }));
  }
  const READERS = { books: readBook, research: readResearch, notes: readNote, actions: readAction, reviews: readReview };
  // Other modules add their own kind of record: { kind, key (storage key), prefix (id prefix), read(raw) -> record | null }.
  function registerKind(def) { KEYS[def.kind] = def.key; PREFIX[def.kind] = def.prefix; READERS[def.kind] = def.read; }
  function kinds() { return Object.keys(KEYS); }

  // What is stored -> { items: records this version understands, kept: anything else exactly as it was (so saving never loses it) }
  function readList(kind, stored) {
    const read = READERS[kind], items = [], kept = [], seen = {};
    (Array.isArray(stored) ? stored : []).forEach(function (raw) {
      const r = read(raw);
      if (r && !seen[r.id]) { seen[r.id] = true; items.push(r); } else if (raw !== null && raw !== undefined) kept.push(raw);
    });
    return { items: items, kept: kept };
  }

  /* ---------------- checking what a form sends ---------------- */

  function fail(errors) { return { ok: false, errors: errors }; }
  function done(value) { return { ok: true, value: value }; }

  // Book form -> a clean book (without id or time stamps), or the problems, one message per field.
  function checkBook(input, ctx) {
    const c = ctx || {}, today = c.today || "", e = {}, i = input || {};
    const title = line(i.title, 200);
    if (!title) e.title = "Give the book a title.";
    const totalRaw = typeof i.totalPages === "string" ? i.totalPages.trim() : i.totalPages;
    const total = totalRaw === "" || totalRaw === undefined || totalRaw === null ? 0 : intIn(totalRaw, 1, 100000, -1);
    if (total < 0) e.totalPages = "Total pages should be a whole number between 1 and 100,000 (or leave it empty if you don't know).";
    const curRaw = typeof i.currentPage === "string" ? i.currentPage.trim() : i.currentPage;
    let cur = curRaw === "" || curRaw === undefined || curRaw === null ? 0 : intIn(curRaw, 0, 100000, -1);
    if (cur < 0) e.currentPage = "The current page should be a whole number (0 or more).";
    else if (total > 0 && cur > total) e.currentPage = "The current page can't be more than the total pages (" + total + ").";
    const status = pick(BOOK_KEYS, i.status, "");
    if (!status) e.status = "Choose a status.";
    let start = i.startDate || "", end = i.endDate || "";
    if (start && !isDate(start)) e.startDate = "That start date isn't valid.";
    if (end && !isDate(end)) e.endDate = "That finish date isn't valid.";
    if (!e.startDate && !e.endDate && start && end && end < start) e.endDate = "The finish date can't be before the start date.";
    const rating = i.rating === "" || i.rating === undefined || i.rating === null ? 0 : intIn(i.rating, 0, 5, -1);
    if (rating < 0) e.rating = "The rating should be 1 to 5 stars.";
    const cover = i.cover || "";
    if (cover && !coverOk(cover)) e.cover = "That image couldn't be used. Choose a smaller picture.";
    if (Object.keys(e).length) return fail(e);
    if (status === "reading" && !start && today) start = today;
    if (status === "completed") { if (!end && today) end = today; if (total > 0) cur = total; } else end = "";
    return done({ title: title, author: line(i.author, 120), category: line(i.category, 60), totalPages: total, currentPage: cur, status: status, startDate: start, endDate: end, rating: rating, cover: cover });
  }

  function checkResearch(input, ctx) {
    const today = (ctx && ctx.today) || "", e = {}, i = input || {};
    const title = line(i.title, 200);
    if (!title) e.title = "Give the research a title.";
    const status = pick(RESEARCH_KEYS, i.status, ""), priority = pick(PRIORITY_KEYS, i.priority, "");
    if (!status) e.status = "Choose a status.";
    if (!priority) e.priority = "Choose a priority.";
    if (Object.keys(e).length) return fail(e);
    const v = { title: title, category: line(i.category, 60), question: para(i.question, 500), purpose: para(i.purpose, 1000), priority: priority, status: status, conclusion: para(i.conclusion, 5000), completedAt: status === "completed" ? (isDate(i.completedAt) ? i.completedAt : today) : "" };
    if (Array.isArray(i.checklist)) v.checklist = cleanChecklist(i.checklist, today);     // left out of the form: the checklist is not touched
    if (typeof i.archived === "boolean") v.archived = i.archived && status === "completed" ? true : undefined;
    if (typeof i.template === "string") v.template = line(i.template, 40) || undefined;
    return done(v);
  }

  // A checklist from a form or a template: [{ id?, text, done? }] -> clean items. A ticked item with no date gets today's.
  function cleanChecklist(list, today) {
    const seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (x, idx) {
      if (!isObj(x)) return;
      const text = line(x.text, 200);
      if (!text) return;
      let id = typeof x.id === "string" && x.id && x.id.length <= 80 ? x.id : "ck" + idx + "_" + text.length;
      while (seen[id]) id += "x";
      seen[id] = true;
      const doneNow = x.done === true;
      out.push({ id: id, text: text, done: doneNow, doneAt: doneNow ? (isDate(x.doneAt) ? x.doneAt : (today || "")) : "" });
    });
    return out.slice(0, 60);
  }
  // Tick or untick one item (the date it was ticked is kept while it stays ticked).
  function toggleChecklistItem(r, itemId, today, now) {
    const list = (r.checklist || []).map(function (x) {
      return x.id !== itemId ? x : { id: x.id, text: x.text, done: !x.done, doneAt: !x.done ? today : "" };
    });
    return Object.assign({}, r, { checklist: list, updatedAt: now });
  }

  // Three optional starting points for a new research project. Everything in them can be edited before and after saving.
  const TEMPLATES = [
    { key: "business", label: "Business and Market Research", category: "Business",
      question: "Is there a real market for this, and how would I win customers in it?",
      purpose: "Decide whether and how to move forward with evidence about the market, the customer and the competition.",
      checklist: ["Describe the customer and the problem they have", "List five direct and indirect competitors", "Compare their pricing, offers and positioning", "Find evidence of demand (searches, sales, communities)", "Talk to or survey at least five potential customers", "Estimate costs, margins and the price people will pay", "List the main risks and what is still unknown", "Write the opportunity in one paragraph and choose the next step"] },
    { key: "psychology", label: "Consumer Psychology Research", category: "Psychology",
      question: "Why do people choose, delay or avoid this, and what influences them?",
      purpose: "Understand the motivations, barriers and biases behind a buying or behaviour decision so I can act on them.",
      checklist: ["Define the specific behaviour I want to understand", "Read two or three studies or reliable summaries on it", "List the main motivations and the main barriers", "Collect real customer language (reviews, comments, interviews)", "Note the biases or triggers that could be at work", "Write a hypothesis I could test", "Plan a small test and what would count as a result", "Summarise what I learned and how I will apply it"] },
    { key: "general", label: "General Learning Research", category: "Learning",
      question: "What do I want to understand, and how will I know I understand it?",
      purpose: "Build a clear, sourced understanding of a topic and decide how to use it.",
      checklist: ["Write the question in one sentence", "List what I already know and what I am unsure about", "Find at least three sources", "Read each source and note the key points", "Compare where the sources agree and disagree", "Write my conclusion in my own words", "Decide one way to apply what I learned"] }
  ];

  function checklistFromTemplate(key, makeId) {
    const t = TEMPLATES.filter(function (x) { return x.key === key; })[0];
    return t ? t.checklist.map(function (text, i) { return { id: makeId ? makeId(i) : "ck" + i + "_" + text.length, text: text, done: false, doneAt: "" }; }) : [];
  }

  function checkSource(input, ctx) {
    const e = {}, i = input || {};
    const url = cleanUrl(i.url);
    if (!url) e.url = "Enter a web address that starts with http:// or https:// (for example example.com/article).";
    const kind = pick(SOURCE_KEYS, i.kind, "");
    if (!kind) e.kind = "Choose what kind of source it is.";
    if (Object.keys(e).length) return fail(e);
    return done({ title: line(i.title, 200) || hostOf(url), url: url, kind: kind, note: line(i.note, 500), state: pick(SOURCE_STATE_KEYS, i.state, "unreviewed"), credibility: para(i.credibility, 600) });
  }

  // ctx: { today, books: [live books], research: [live research] } so links can be checked.
  function checkNote(input, ctx) {
    const c = ctx || {}, e = {}, i = input || {};
    const text = para(i.text, 10000);
    if (!text) e.text = "Write something to save.";
    const type = pick(NOTE_KEYS, i.type, "");
    if (!type) e.type = "Choose what kind of note it is.";
    const bookIds = idList(i.bookIds), researchIds = idList(i.researchIds);
    const bookSet = {}, resSet = {};
    (c.books || []).forEach(function (b) { bookSet[b.id] = true; });
    (c.research || []).forEach(function (r) { resSet[r.id] = true; });
    if (c.books && bookIds.some(function (x) { return !bookSet[x]; })) e.bookIds = "One of the linked books no longer exists.";
    if (c.research && researchIds.some(function (x) { return !resSet[x]; })) e.researchIds = "One of the linked research projects no longer exists.";
    let sourceId = typeof i.sourceId === "string" ? i.sourceId : "";
    if (sourceId) {
      const ok = (c.research || []).some(function (r) { return researchIds.indexOf(r.id) !== -1 && (r.sources || []).some(function (s) { return s.id === sourceId; }); });
      if (!ok && c.research) sourceId = "";
    }
    // notes this one points to (never itself; each must still exist when the list of notes is known)
    const linkIds = idList(i.linkIds).filter(function (x) { return x !== c.selfId; });
    const noteSet = {};
    (c.notes || []).forEach(function (n) { noteSet[n.id] = true; });
    const links = c.notes ? linkIds.filter(function (x) { return noteSet[x]; }) : linkIds;
    if (Object.keys(e).length) return fail(e);
    // Spaced repetition: only acts when the form says so (remember is true or false); a lesson already scheduled and
    // still ticked is left exactly as it is (so editing the wording never un-pauses it or moves its date).
    let srs = c.existingSrs || null;
    if (typeof i.remember === "boolean" && SRS_TYPES.indexOf(type) !== -1) {
      const S = srsMod();
      if (i.remember) srs = c.existingSrs && c.existingSrs.on ? c.existingSrs : S.setEnabled(c.existingSrs || null, true, c.today || "");
      else if (c.existingSrs) srs = S.setEnabled(c.existingSrs, false, c.today || "");
    }
    return done({ type: type, title: line(i.title, 200), text: text, evidence: type === "finding" || type === "opinion" ? para(i.evidence, 5000) : "", page: line(i.page, 40), tags: parseTags(i.tags), category: line(i.category, 60), bookIds: bookIds, researchIds: researchIds, sourceId: researchIds.length ? sourceId : "", important: i.important === true, day: c.today && isDate(c.today) ? c.today : "", linkIds: links, inbox: i.inbox === true ? true : undefined, srs: srs || undefined });
  }

  // ctx: { today, books, research, notes } for checking where the lesson came from.
  function checkAction(input, ctx) {
    const c = ctx || {}, e = {}, i = input || {};
    const lesson = para(i.lesson, 500);
    if (!lesson) e.lesson = "Write the lesson or idea you want to act on.";
    const status = pick(ACTION_KEYS, i.status, "");
    if (!status) e.status = "Choose a status.";
    const st = pick(["none", "book", "research", "note", "other"], i.sourceType, "none");
    let sourceId = "", sourceLabel = "";
    if (st === "book" || st === "research" || st === "note") {
      sourceId = typeof i.sourceId === "string" ? i.sourceId : "";
      const list = st === "book" ? c.books : st === "research" ? c.research : c.notes;
      if (!sourceId) e.sourceId = "Choose where you learned it.";
      else if (list && !list.some(function (x) { return x.id === sourceId; })) e.sourceId = "That source no longer exists.";
    } else if (st === "other") sourceLabel = line(i.sourceLabel, 200);
    let target = i.targetDate || "";
    if (target && !isDate(target)) e.targetDate = "That target date isn't valid.";
    if (Object.keys(e).length) return fail(e);
    return done({ lesson: lesson, plan: para(i.plan, 2000), sourceType: st, sourceId: sourceId, sourceLabel: sourceLabel, targetDate: target, status: status, implementedAt: status === "done" ? (isDate(i.implementedAt) ? i.implementedAt : (c.today || "")) : "", inbox: i.inbox === true ? true : undefined });
  }

  function checkReview(input) {
    const i = input || {};
    if (!isDate(i.weekStart) || weekStart(i.weekStart) !== i.weekStart) return fail({ weekStart: "A review belongs to a week that starts on a Monday." });
    return done({ weekStart: i.weekStart, reflection: para(i.reflection, 5000), struggled: para(i.struggled, 5000), applied: para(i.applied, 5000), focusNext: para(i.focusNext, 2000) });
  }

  // Changing a book's status from a quick control (not the full form): what else follows.
  //   Reading: the start date is filled in if there isn't one. Completed: the finish date is filled in if there isn't one and
  //   the current page becomes the last page (when the total is known) so the bar is full. That page is NOT added to the
  //   reading log: pages you never logged are not counted as read on the day you tapped Completed. Anything else: the
  //   finish date is cleared.
  function withStatus(book, status, today, now) {
    if (BOOK_KEYS.indexOf(status) === -1) return book;
    const b = Object.assign({}, book, { status: status, updatedAt: now });
    if (status === "reading" && !b.startDate) b.startDate = today;
    if (status === "completed") {
      if (!b.endDate) b.endDate = today;
      if (num(b.totalPages) > 0 && num(b.currentPage) < b.totalPages) b.currentPage = b.totalPages;
    } else b.endDate = "";
    return b;
  }
  // Changing a research project's status from a quick control: the completed date is set when it becomes Completed
  // (kept if it already had one) and cleared when it is taken out of Completed.
  function withResearchStatus(r, status, today, now) {
    if (RESEARCH_KEYS.indexOf(status) === -1) return r;
    const next = Object.assign({}, r, { status: status, completedAt: status === "completed" ? (r.completedAt || today) : "", updatedAt: now });
    if (status !== "completed") next.archived = undefined;                 // only completed projects are archived
    return next;
  }
  function withArchived(r, archived, now) {
    return r.status === "completed" ? Object.assign({}, r, { archived: archived ? true : undefined, updatedAt: now }) : r;
  }
  function withActionStatus(a, status, today, now) {
    if (ACTION_KEYS.indexOf(status) === -1) return a;
    return Object.assign({}, a, { status: status, implementedAt: status === "done" ? (a.implementedAt || today) : "", updatedAt: now });
  }

  /* ---------------- search, filter, sort ---------------- */

  function haystack(parts) { return parts.filter(Boolean).join(" \n ").toLowerCase(); }
  function matchesQuery(q, hay) {
    const tokens = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
  }
  function cmpText(a, b) { a = String(a || "").toLowerCase(); b = String(b || "").toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; }

  // f: { q, status, category, sort: "recent" | "title" | "progress" | "rating" | "added" }
  function filterBooks(books, f) {
    f = f || {};
    let out = live(books).filter(function (b) {
      if (f.status && b.status !== f.status) return false;
      if (f.category && cmpText(b.category, f.category) !== 0) return false;
      return !f.q || matchesQuery(f.q, haystack([b.title, b.author, b.category]));
    });
    const sorts = {
      title: function (a, b) { return cmpText(a.title, b.title); },
      progress: function (a, b) { return (progress(b) === null ? -1 : progress(b)) - (progress(a) === null ? -1 : progress(a)) || cmpText(a.title, b.title); },
      rating: function (a, b) { return num(b.rating) - num(a.rating) || cmpText(a.title, b.title); },
      added: function (a, b) { return num(b.createdAt) - num(a.createdAt); },
      recent: function (a, b) { return num(b.updatedAt) - num(a.updatedAt); }
    };
    out = out.slice().sort(sorts[f.sort] || sorts.recent);
    return out;
  }

  const PRIO_RANK = { high: 0, medium: 1, low: 2 };
  // f: { q, status, active (researching or analyzing), priority, category, sort: "recent" | "priority" | "title" | "added" }
  function filterResearch(list, f) {
    f = f || {};
    const out = live(list).filter(function (r) {
      if (f.status && r.status !== f.status) return false;
      if (f.active && r.status !== "researching" && r.status !== "analyzing") return false;
      if (f.priority && r.priority !== f.priority) return false;
      if (f.category && cmpText(r.category, f.category) !== 0) return false;
      // archived projects are hidden unless asked for: f.archived "show" lists everything, "only" lists just the archived ones
      if (f.archived === "only" ? !r.archived : (f.archived !== "show" && r.archived)) return false;
      return !f.q || matchesQuery(f.q, haystack([r.title, r.category, r.question, r.purpose, r.conclusion].concat((r.sources || []).map(function (s) { return s.title + " " + s.url + " " + (s.credibility || ""); }), (r.checklist || []).map(function (x) { return x.text; }))));
    });
    const sorts = {
      priority: function (a, b) { return PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || num(b.updatedAt) - num(a.updatedAt); },
      title: function (a, b) { return cmpText(a.title, b.title); },
      added: function (a, b) { return num(b.createdAt) - num(a.createdAt); },
      recent: function (a, b) { return num(b.updatedAt) - num(a.updatedAt); }
    };
    return out.slice().sort(sorts[f.sort] || sorts.recent);
  }

  // f: { q, tag, type, category, bookId, researchId, from, to, important, sort: "newest" | "oldest" | "type" }
  // The category of a note without one of its own is that of the book or research it is linked to.
  function noteCategory(n, state) {
    if (n.category) return n.category;
    const byId = {};
    live(state && state.books).forEach(function (b) { byId[b.id] = b; });
    live(state && state.research).forEach(function (r) { byId[r.id] = r; });
    const ids = (n.bookIds || []).concat(n.researchIds || []);
    for (let i = 0; i < ids.length; i++) if (byId[ids[i]] && byId[ids[i]].category) return byId[ids[i]].category;
    return "";
  }
  function filterNotes(notes, state, f) {
    f = f || {};
    const names = {};
    live(state && state.books).forEach(function (b) { names[b.id] = b.title + " " + b.author; });
    live(state && state.research).forEach(function (r) { names[r.id] = r.title; });
    const out = live(notes).filter(function (n) {
      if (f.type && n.type !== f.type) return false;
      if (f.tag && (n.tags || []).indexOf(f.tag) === -1) return false;
      if (f.bookId && (n.bookIds || []).indexOf(f.bookId) === -1) return false;
      if (f.researchId && (n.researchIds || []).indexOf(f.researchId) === -1) return false;
      if (f.important && !n.important) return false;
      if (f.inbox && !n.inbox) return false;
      if (f.remember && !(n.srs && n.srs.on)) return false;
      if (f.category && cmpText(noteCategory(n, state), f.category) !== 0) return false;
      const d = dayOfRecord(n);
      if (f.from && (!d || d < f.from)) return false;
      if (f.to && (!d || d > f.to)) return false;
      if (!f.q) return true;
      const linked = (n.bookIds || []).concat(n.researchIds || []).map(function (id) { return names[id]; });
      return matchesQuery(f.q, haystack([n.title, n.text, n.evidence, n.page, labelOf(NOTE_TYPE, n.type)].concat(n.tags || [], linked)));
    });
    const newest = function (a, b) { return num(b.createdAt) - num(a.createdAt); };
    const sorts = { oldest: function (a, b) { return -newest(a, b); }, type: function (a, b) { return NOTE_KEYS.indexOf(a.type) - NOTE_KEYS.indexOf(b.type) || newest(a, b); } };
    return out.slice().sort(sorts[f.sort] || newest);
  }

  // f: { q, status, sort: "date" | "newest" | "status" }. "date" = target date soonest first, no date last.
  function filterActions(actions, state, f) {
    f = f || {};
    const names = {};
    live(state && state.books).forEach(function (b) { names[b.id] = b.title; });
    live(state && state.research).forEach(function (r) { names[r.id] = r.title; });
    live(state && state.notes).forEach(function (n) { names[n.id] = n.title || n.text; });
    const out = live(actions).filter(function (a) {
      if (f.status && a.status !== f.status) return false;
      return !f.q || matchesQuery(f.q, haystack([a.lesson, a.plan, a.sourceLabel, names[a.sourceId]]));
    });
    const newest = function (a, b) { return num(b.createdAt) - num(a.createdAt); };
    const sorts = {
      newest: newest,
      status: function (a, b) { return ACTION_KEYS.indexOf(a.status) - ACTION_KEYS.indexOf(b.status) || newest(a, b); },
      date: function (a, b) {
        if (!a.targetDate && !b.targetDate) return newest(a, b);
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : newest(a, b);
      }
    };
    return out.slice().sort(sorts[f.sort] || sorts.date);
  }

  function allTags(notes) {
    const count = {};
    live(notes).forEach(function (n) { (n.tags || []).forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
    return Object.keys(count).sort(function (a, b) { return count[b] - count[a] || cmpText(a, b); }).map(function (t) { return { tag: t, count: count[t] }; });
  }
  function allCategories(state) {
    const seen = {}, out = [];
    [live(state && state.books), live(state && state.research), live(state && state.notes)].forEach(function (list) {
      list.forEach(function (r) { const c = r.category; if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = true; out.push(c); } });
    });
    return out.sort(cmpText);
  }

  function notesFor(notes, kind, id) { return live(notes).filter(function (n) { return (kind === "book" ? (n.bookIds || []) : (n.researchIds || [])).indexOf(id) !== -1; }); }
  function actionsFor(actions, kind, id) { return live(actions).filter(function (a) { return a.sourceType === kind && a.sourceId === id; }); }

  // Things saved with Quick Capture that have not been organised yet: notes, actions and flashcards, newest first.
  // -> [{ kind: "notes" | "actions" | "cards", record }]
  function inboxItems(state) {
    const out = [];
    ["notes", "actions", "cards"].forEach(function (kind) {
      live(state && state[kind]).forEach(function (r) { if (r.inbox) out.push({ kind: kind, record: r }); });
    });
    return out.sort(function (a, b) { return num(b.record.createdAt) - num(a.record.createdAt); });
  }

  /* ---------------- dashboard ---------------- */

  function stats(state) {
    const books = live(state && state.books), research = live(state && state.research), notes = live(state && state.notes), actions = live(state && state.actions);
    return {
      booksReading: books.filter(function (b) { return b.status === "reading"; }).length,
      activeResearch: research.filter(function (r) { return r.status === "researching" || r.status === "analyzing"; }).length,
      takeaways: notes.filter(function (n) { return n.type === "takeaway"; }).length,
      implemented: actions.filter(function (a) { return a.status === "done"; }).length,
      booksCompleted: books.filter(function (b) { return b.status === "completed"; }).length
    };
  }
  function currentBooks(state) { return live(state && state.books).filter(function (b) { return b.status === "reading"; }).sort(function (a, b) { return num(b.updatedAt) - num(a.updatedAt); }); }
  function activeResearch(state) { return filterResearch(state && state.research, { sort: "priority" }).filter(function (r) { return r.status === "researching" || r.status === "analyzing"; }); }
  function recentNotes(state, n) { return filterNotes(state && state.notes, state, {}).slice(0, n); }
  // Actions still to do: soonest target date first, undated ones after. Each says whether it is overdue (target date before today).
  function upcomingActions(state, n, today) {
    return filterActions(state && state.actions, state, { sort: "date" }).filter(function (a) { return a.status !== "done"; }).slice(0, n).map(function (a) {
      return Object.assign({}, a, { overdue: !!(a.targetDate && today && a.targetDate < today), dueInDays: a.targetDate && today ? diffDays(today, a.targetDate) : null });
    });
  }

  /* ---------------- the weekly review ---------------- */

  // state: { books, research, notes, actions, reviews }; week: the Monday; today: for "stalled" and "overdue".
  function weeklyReview(state, week, today) {
    const from = week, to = addDays(week, 6);
    const inWeek = function (d) { return !!d && d >= from && d <= to; };
    const books = live(state && state.books), research = live(state && state.research), notes = live(state && state.notes), actions = live(state && state.actions);

    const perBook = books.map(function (b) { return { id: b.id, title: b.title, pages: pagesInRange(b, from, to) }; }).filter(function (x) { return x.pages > 0; }).sort(function (a, b) { return b.pages - a.pages; });
    const finished = books.filter(function (b) { return b.status === "completed" && inWeek(b.endDate); });
    const started = books.filter(function (b) { return inWeek(b.startDate); });

    const completedResearch = research.filter(function (r) { return r.status === "completed" && inWeek(r.completedAt); });
    const weekNotes = notes.filter(function (n) { return inWeek(dayOfRecord(n)); });
    const findings = weekNotes.filter(function (n) { return n.type === "finding"; });
    const sourcesAdded = research.reduce(function (s, r) { return s + (r.sources || []).filter(function (x) { return x.addedAt && inWeek(localDate(x.addedAt)); }).length; }, 0);
    const byType = {};
    weekNotes.forEach(function (n) { byType[n.type] = (byType[n.type] || 0) + 1; });

    const starred = weekNotes.filter(function (n) { return n.important; });
    const takeawaysThisWeek = weekNotes.filter(function (n) { return n.type === "takeaway"; });
    const implemented = actions.filter(function (a) { return a.status === "done" && inWeek(a.implementedAt); });

    const focus = [];
    const add = function (kind, id, title, reason) { if (focus.length < 6) focus.push({ kind: kind, id: id, title: title, reason: reason }); };
    const open = actions.filter(function (a) { return a.status !== "done"; });
    open.filter(function (a) { return a.targetDate && today && a.targetDate < today; }).sort(function (a, b) { return a.targetDate < b.targetDate ? -1 : 1; })
      .forEach(function (a) { add("action", a.id, a.lesson, "Overdue: it was due " + a.targetDate + " (" + labelOf(ACTION_STATUS, a.status) + ")."); });
    open.filter(function (a) { return a.targetDate && today && a.targetDate >= today && diffDays(today, a.targetDate) <= 7; }).sort(function (a, b) { return a.targetDate < b.targetDate ? -1 : 1; })
      .forEach(function (a) { add("action", a.id, a.lesson, "Due " + a.targetDate + " (" + labelOf(ACTION_STATUS, a.status) + ")."); });
    open.filter(function (a) { return a.status === "doing" && !(a.targetDate && today && diffDays(today, a.targetDate) <= 7); })
      .forEach(function (a) { add("action", a.id, a.lesson, "Already in progress."); });
    books.filter(function (b) { return b.status === "reading"; }).forEach(function (b) {
      const last = lastLogged(b);
      if (today && last && diffDays(last, today) >= 7) add("book", b.id, b.title, "No page update for " + diffDays(last, today) + " days (last on " + last + ").");
      else if (today && !last) add("book", b.id, b.title, "You're reading it but haven't logged a page yet.");
    });
    research.filter(function (r) { return r.priority === "high" && r.status !== "completed"; }).forEach(function (r) { add("research", r.id, r.title, "High priority, still " + labelOf(RESEARCH_STATUS, r.status).toLowerCase() + "."); });

    const saved = live(state && state.reviews).filter(function (r) { return r.weekStart === week; })[0] || null;
    const pages = perBook.reduce(function (s, x) { return s + x.pages; }, 0);
    return {
      week: { start: from, end: to },
      reading: { pages: pages, perBook: perBook, finished: finished, started: started },
      research: { completed: completedResearch, findingsAdded: findings.length, sourcesAdded: sourcesAdded },
      notes: { total: weekNotes.length, byType: byType },
      lessons: { starred: starred, takeaways: takeawaysThisWeek },
      implemented: implemented,
      focus: focus,
      saved: saved,
      empty: !pages && !finished.length && !started.length && !completedResearch.length && !weekNotes.length && !implemented.length && !sourcesAdded
    };
  }

  return {
    KEYS: KEYS, PREFIX: PREFIX, registerKind: registerKind, kinds: kinds, TOMBSTONE_DAYS: TOMBSTONE_DAYS, MAX_COVER_CHARS: MAX_COVER_CHARS, MAX_LOG: MAX_LOG,
    BOOK_STATUS: BOOK_STATUS, RESEARCH_STATUS: RESEARCH_STATUS, PRIORITY: PRIORITY, ACTION_STATUS: ACTION_STATUS, NOTE_TYPE: NOTE_TYPE, SOURCE_KIND: SOURCE_KIND, SOURCE_STATE: SOURCE_STATE, SRS_TYPES: SRS_TYPES, labelOf: labelOf,
    isDate: isDate, addDays: addDays, diffDays: diffDays, weekStart: weekStart, localDate: localDate,
    live: live, stamp: stamp, tombstone: tombstone, restore: restore, purge: purge,
    parseTags: parseTags, cleanUrl: cleanUrl, hostOf: hostOf, coverOk: coverOk,
    progress: progress, pagesLeft: pagesLeft, withPage: withPage, dailyPages: dailyPages, pagesInRange: pagesInRange, lastLogged: lastLogged,
    readList: readList, readBook: readBook, readResearch: readResearch, readNote: readNote, readAction: readAction, readReview: readReview,
    checkBook: checkBook, checkResearch: checkResearch, checkSource: checkSource, checkNote: checkNote, checkAction: checkAction, checkReview: checkReview,
    withStatus: withStatus, withResearchStatus: withResearchStatus, withArchived: withArchived, withActionStatus: withActionStatus,
    TEMPLATES: TEMPLATES, checklistFromTemplate: checklistFromTemplate, cleanChecklist: cleanChecklist, checklistProgress: checklistProgress, toggleChecklistItem: toggleChecklistItem, inboxItems: inboxItems,
    filterBooks: filterBooks, filterResearch: filterResearch, filterNotes: filterNotes, filterActions: filterActions, noteCategory: noteCategory,
    allTags: allTags, allCategories: allCategories, notesFor: notesFor, actionsFor: actionsFor,
    stats: stats, currentBooks: currentBooks, activeResearch: activeResearch, recentNotes: recentNotes, upcomingActions: upcomingActions, weeklyReview: weeklyReview
  };
});
