"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../../js/learning-overview-logic");

const TODAY = "2026-11-04";   // a Wednesday
const ts = (day, h) => Date.parse(day + "T" + (h || "10:00") + ":00-05:00");
const state = () => ({
  books: [
    { id: "b1", title: "Atomic Habits", status: "reading", totalPages: 300, currentPage: 60, updatedAt: 50, log: [{ d: "2026-11-01", p: 20 }, { d: "2026-11-03", p: 35 }, { d: "2026-11-04", p: 55 }] },
    { id: "b2", title: "Influence", status: "reading", totalPages: 200, currentPage: 10, updatedAt: 90, log: [{ d: "2026-11-04", p: 0 }, { d: "2026-11-04", p: 10 }] },
    { id: "b3", title: "Deep Work", status: "completed", totalPages: 100, currentPage: 100, endDate: "2026-11-02", updatedAt: 20, log: [] },
    { id: "b4", title: "To read", status: "want", updatedAt: 70, log: [] },
    { id: "b5", title: "Gone", status: "reading", updatedAt: 99, deletedAt: 1, log: [{ d: "2026-11-04", p: 0 }, { d: "2026-11-04", p: 50 }] }
  ],
  notes: [
    { id: "n1", type: "takeaway", text: "Small habits compound", day: "2026-11-04", createdAt: ts("2026-11-04", "09:00"), srs: { on: true, due: "2026-11-03", reviews: [{ d: "2026-11-02", g: "good" }, { d: "2026-11-02", g: "easy" }] } },
    { id: "n2", type: "quote", title: "On focus", text: "Focus is rare", day: "2026-11-03", createdAt: ts("2026-11-03"), srs: { on: true, due: "2026-11-09", reviews: [] } },
    { id: "n3", type: "note", text: "Deleted", day: "2026-11-04", createdAt: ts("2026-11-04"), deletedAt: 5 },
    { id: "n4", type: "note", text: "Paused one", day: "2026-11-01", createdAt: ts("2026-11-01"), srs: { on: true, paused: true, due: "2026-10-30", reviews: [] } }
  ],
  cards: [{ id: "c1", question: "What compounds?", answer: "Habits", srs: { on: true, due: "2026-11-04", reviews: [{ d: "2026-11-04", g: "good" }] }, createdAt: 3 }],
  sessions: [{ id: "s1", bookId: "b1", day: "2026-11-04", minutes: 25 }, { id: "s2", bookId: "", day: "2026-11-03", minutes: 10 }, { id: "s3", bookId: "b1", day: "2026-11-04", minutes: 99, deletedAt: 2 }],
  research: [{ id: "r1", title: "Sleep and memory", status: "researching", createdAt: ts("2026-11-02"), sources: [{ id: "x1", title: "Paper", url: "https://a.example", addedAt: ts("2026-11-03", "08:00") }] }, { id: "r2", title: "Old", status: "completed", completedAt: "2026-10-20", createdAt: ts("2026-10-01"), sources: [] }],
  actions: [{ id: "a1", lesson: "Read before bed", status: "done", implementedAt: "2026-11-04" }, { id: "a2", lesson: "Not yet", status: "todo" }]
});

test("the three numbers: books being read, pages read today, notes saved", () => {
  const f = O.figures(state(), TODAY);
  assert.deepEqual(f, { activeBooks: 2, pagesToday: 30, notesSaved: 3 });      // 20 (b1: 40 to 60) + 10 (b2); the deleted book and the deleted note are not counted
});

test("pages today is zero when nothing was logged (a real zero, not a guess), and never counts the first page entry", () => {
  const s = state();
  assert.equal(O.figures(s, "2026-11-05").pagesToday, 0);
  s.books = [{ id: "b", title: "T", status: "reading", log: [{ d: TODAY, p: 120 }] }];
  assert.equal(O.figures(s, TODAY).pagesToday, 0);                              // a book first logged at page 120 did not read 120 pages today
});

test("the figures work on an empty library", () => {
  assert.deepEqual(O.figures({}, TODAY), { activeBooks: 0, pagesToday: 0, notesSaved: 0 });
  assert.equal(O.logTarget({}), null);
  assert.deepEqual(O.review({}, TODAY), { due: 0, overdue: 0, scheduled: 0, nextDue: "", items: [] });
  assert.deepEqual(O.activity({}, TODAY), []);
});

test("Log reading starts with the book you read in most recently; reading first, then paused, then the to-read list", () => {
  assert.equal(O.logTarget(state()).id, "b2");
  const s = state(); s.books = s.books.filter((b) => b.status !== "reading");
  assert.equal(O.logTarget(s).id, "b4");
  s.books = s.books.filter((b) => b.status === "completed");
  assert.equal(O.logTarget(s), null);                                           // a finished book is not offered
  const p = { books: [{ id: "a", status: "paused", updatedAt: 5 }, { id: "w", status: "want", updatedAt: 99 }] };
  assert.equal(O.logTarget(p).id, "a");
});

test("review: notes and flashcards due today or before, oldest first; paused ones are left out", () => {
  const r = O.review(state(), TODAY);
  assert.equal(r.due, 2);
  assert.equal(r.overdue, 1);
  assert.equal(r.scheduled, 4);
  assert.equal(r.nextDue, "2026-11-09");
  assert.deepEqual(r.items.map((x) => [x.kind, x.id, x.card]), [["notes", "n1", false], ["cards", "c1", true]]);
  assert.equal(r.items[1].title, "What compounds?");
  assert.equal(O.review(state(), TODAY, 1).items.length, 1);
  assert.equal(O.review(state(), TODAY, 1).due, 2);                              // the count is every due item, the list is only the first few
});

test("recent activity: newest first, one line per book per day, merged pages and minutes, only real records", () => {
  const a = O.activity(state(), TODAY, 20);
  const texts = a.map((x) => x.text);
  assert.ok(texts.includes("Read 20 pages of Atomic Habits (25 min)"));
  assert.ok(texts.includes("Read 10 pages of Influence"));
  assert.ok(texts.includes("Read 15 pages of Atomic Habits"), "the day before has its own line (no minutes saved that day)");
  assert.ok(texts.includes("Read 20 pages of Atomic Habits") === false, "pages and minutes of one book on one day are one line");
  assert.ok(texts.includes("Read for 10 min"));                                  // minutes with no book
  assert.ok(texts.includes("Finished Deep Work"));
  assert.ok(texts.includes("Saved a key takeaway: Small habits compound"));
  assert.ok(texts.includes("Saved a quote: On focus"));
  assert.ok(texts.includes("Started research: Sleep and memory"));
  assert.ok(texts.includes("Added a source to Sleep and memory"));
  assert.ok(texts.includes("Completed research: Old"));
  assert.ok(texts.includes("Put into practice: Read before bed"));
  assert.ok(texts.includes("Reviewed 1 item") && texts.includes("Reviewed 2 items"));
  assert.equal(texts.some((t) => /Gone|Deleted|Not yet|99/.test(t)), false, "deleted records and unfinished actions are not activity");
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].day >= a[i].day, "never out of date order: " + a[i - 1].day + " then " + a[i].day);
  assert.equal(O.activity(state(), TODAY, 3).length, 3);
  assert.equal(O.activity(state(), TODAY).length, 6);
});

test("recent activity: each line says where to open it", () => {
  const a = O.activity(state(), TODAY, 30), by = (t) => a.find((x) => x.text.indexOf(t) === 0);
  assert.deepEqual(by("Read 20 pages of Atomic").go, { tab: "books", id: "b1" });
  assert.deepEqual(by("Saved a key takeaway").go, { tab: "knowledge", id: "n1" });
  assert.deepEqual(by("Started research").go, { tab: "research", id: "r1" });
  assert.deepEqual(by("Put into practice").go, { tab: "actions", id: "" });
  assert.deepEqual(by("Reviewed 1").go, { tab: "study", id: "" });
  assert.deepEqual(by("Read for 10 min").go, { tab: "books", id: "" });
});

test("recent activity ignores dates that have not happened yet and works with records that only have a created time", () => {
  const s = state();
  s.notes.push({ id: "nf", type: "note", text: "from the future", day: "2026-12-25", createdAt: ts("2026-12-25") });
  s.notes.push({ id: "nt", type: "note", text: "only a timestamp", createdAt: ts("2026-11-04", "11:00") });
  const texts = O.activity(s, TODAY, 40).map((x) => x.text);
  assert.equal(texts.some((t) => /future/.test(t)), false);
  assert.ok(texts.some((t) => /only a timestamp/.test(t)));
});

test("words for recent days", () => {
  assert.equal(O.whenWords("2026-11-04", TODAY), "Today");
  assert.equal(O.whenWords("2026-11-03", TODAY), "Yesterday");
  assert.equal(O.whenWords("2026-11-01", TODAY), "3 days ago");
  assert.equal(O.whenWords("2026-10-20", TODAY), "");
});
