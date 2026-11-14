"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const K = require("../../js/learning-links-logic");

const note = (o) => L.readNote(Object.assign({ id: "n1", type: "takeaway", text: "Small habits compound.", day: "2026-11-09", createdAt: 1, updatedAt: 1 }, o));
const book = (id, title) => L.readBook({ id, title, createdAt: 1, updatedAt: 1 });

test("keywords: meaningful words only, plurals folded, each once", () => {
  assert.deepEqual(K.keywords("The pricing of products, and the Products' pricing!"), ["pricing", "product"]);
  assert.deepEqual(K.keywords("It is what it is, with them and from you"), [], "common and short words are ignored");
  assert.deepEqual(K.keywords("Customers buy habits; customer habit"), ["customer", "buy".length < 4 ? "" : "buy", "habit"].filter(Boolean), "buy is too short");
  assert.deepEqual(K.keywords(""), []);
  assert.deepEqual(K.keywords(null), []);
  assert.deepEqual(K.shared(["a1", "b2", "c3"], ["c3", "d4", "a1"]), ["c3", "a1"]);
});

test("related notes come with the reasons they matched", () => {
  const a = note({ id: "a", text: "Customers anchor on the first price they see, so pricing order shapes decisions.", tags: ["pricing", "psychology"] });
  const state = { notes: [
    a,
    note({ id: "link", text: "A totally different subject: gardening.", createdAt: 5 }),                                   // matched only because you linked it
    note({ id: "topic", text: "Cold exposure and sleep.", tags: ["psychology"], createdAt: 4 }),                             // shares a topic
    note({ id: "words", text: "Pricing order and the first price shown change what customers decide.", createdAt: 3 }),      // shares wording
    note({ id: "none", text: "Quarterly tax deadlines for sole traders.", createdAt: 2 }),
    note({ id: "gone", text: "Customers anchor first price pricing", tags: ["pricing"], deletedAt: 9 })
  ] };
  a.linkIds = ["link"];
  const r = K.related(a, state);
  assert.deepEqual(r.map((x) => x.note.id), ["link", "topic", "words"], "linked by you first, then a shared topic (a stronger sign), then shared wording; unrelated and deleted notes are left out");
  assert.deepEqual(r[0].reasons, [{ kind: "link", detail: "Linked by you" }]);
  assert.deepEqual(r[1].reasons, [{ kind: "topic", detail: "#psychology" }]);
  assert.deepEqual(r[2].reasons.map((x) => x.kind), ["words"]);
  assert.ok(r[2].reasons[0].detail.split(", ").every((w) => ["customer", "pricing", "first", "price", "order"].includes(w)), "it says which words matched");
  assert.equal(K.related(a, state, 2).length, 2, "limited");
  assert.ok(!r.some((x) => x.note.id === "a"), "a note is not related to itself");
});

test("a link counts both ways, and one note can match for several reasons", () => {
  const a = note({ id: "a", text: "Habit stacking uses an existing routine as the cue.", tags: ["habits"] });
  const b = note({ id: "b", text: "Routines make cues obvious; stacking a habit on a routine works.", tags: ["habits"], linkIds: ["a"] });
  const r = K.related(a, { notes: [a, b] });
  assert.deepEqual(r[0].reasons.map((x) => x.kind), ["link", "topic", "words"], "b links to a, shares #habits, and shares wording");
  assert.equal(r[0].reasons[0].detail, "Links back to this");
});

test("short notes need two shared words, longer ones three", () => {
  const short1 = note({ id: "s1", text: "Compounding matters." }), short2 = note({ id: "s2", text: "Compounding, matters greatly." });
  assert.equal(K.related(short1, { notes: [short1, short2] }).length, 1, "2 shared words between short notes");
  const long = (extra) => note({ id: extra, text: "alpha bravo charlie delta echo foxtrot golf hotel india juliet " + extra });
  const a = long("kilo"), b = Object.assign(long("lima"), { text: "alpha bravo xxxxx yyyyy zzzzz qqqqq wwwww eeeee rrrrr ttttt" });
  assert.equal(K.related(a, { notes: [a, b] }).length, 0, "two shared words between long notes is not enough");
});

test("which other books discuss the same idea", () => {
  const mine = note({ id: "a", text: "Anchoring changes what people will pay.", tags: ["pricing"], bookIds: ["b1"] });
  const state = { books: [book("b1", "Thinking Fast and Slow"), book("b2", "Influence"), book("b3", "Unrelated")], notes: [
    mine,
    note({ id: "x", text: "Pay attention to anchoring in negotiation.", tags: ["pricing"], bookIds: ["b2"] }),
    note({ id: "y", text: "Pricing anchors", tags: ["pricing"], bookIds: ["b2", "b1"] }),
    note({ id: "z", text: "Tax tips", bookIds: ["b3"] })
  ] };
  const r = K.booksDiscussing(mine, state);
  assert.deepEqual(r.map((x) => [x.book.title, x.notes]), [["Influence", 2]], "other books only (not the note's own), with how many related notes each has");
  assert.deepEqual(K.booksDiscussing(note({ id: "q", text: "nothing similar here" }), state), []);
});

test("topics: every tag with what it touches", () => {
  const state = { books: [book("b1", "One"), book("b2", "Two")], research: [L.readResearch({ id: "r1", title: "R", createdAt: 1, updatedAt: 1 })],
    notes: [note({ id: "a", tags: ["habits", "memory"], bookIds: ["b1"] }), note({ id: "b", tags: ["habits"], bookIds: ["b2"], researchIds: ["r1"] }), note({ id: "c", tags: ["memory"], deletedAt: 5 })],
    cards: [{ id: "c1", tags: ["habits"], bookIds: ["b1"], researchIds: [] }, { id: "c2", tags: ["solo"], bookIds: [], researchIds: [] }] };
  const t = K.topics(state);
  assert.deepEqual(t.map((x) => [x.tag, x.notes, x.cards]), [["habits", 2, 1], ["memory", 1, 0], ["solo", 0, 1]], "most used first; a deleted note does not count");
  assert.deepEqual(t[0].books.map((b) => b.title), ["One", "Two"]);
  assert.deepEqual(t[0].research.map((r) => r.id), ["r1"]);
  assert.deepEqual(K.topics({}), []);
});

test("renaming or merging a topic changes only the records that have it", () => {
  const notes = [note({ id: "a", tags: ["habbits", "memory"] }), note({ id: "b", tags: ["habits", "habbits"] }), note({ id: "c", tags: ["other"] }), note({ id: "d", tags: ["habbits"], deletedAt: 1 })];
  const ch = K.renameTag(notes, "habbits", "Habits");
  assert.deepEqual(ch.map((x) => [x.before.id, x.after.tags]), [["a", ["habits", "memory"]], ["b", ["habits"]]], "renamed (cleaned like any tag), and merged where the new name was already there; deleted and unrelated notes untouched");
  assert.equal(notes[0].tags[0], "habbits", "the originals are not changed");
  assert.deepEqual(K.renameTag(notes, "habbits", "habbits"), []);
  assert.deepEqual(K.renameTag(notes, "habbits", "###"), [], "a name that cleans to nothing is refused");
});

test("collections: a name, what is in them, and a topic that fills them by itself", () => {
  assert.equal(L.KEYS.collections, "jarvisLearnCollections");
  assert.equal(L.PREFIX.collections, "cl");
  assert.equal(K.read({ id: "x", name: "" }), null);
  const c = K.read({ id: "c1", name: "  Pricing  ", description: "How people judge value", tag: "#Pricing", noteIds: ["a", "a", "z"], bookIds: ["b1"], researchIds: [], createdAt: 1, updatedAt: 1 });
  assert.deepEqual([c.name, c.tag, c.noteIds], ["Pricing", "pricing", ["a", "z"]]);
  const ctx = { notes: [{ id: "a" }], books: [{ id: "b1" }], research: [] };
  assert.equal(K.check({ name: "" }, ctx).errors.name, "Give the collection a name.");
  assert.equal(K.check({ name: "X", noteIds: ["gone"] }, ctx).errors.noteIds, "One of those notes no longer exists.");
  assert.equal(K.check({ name: "X", bookIds: ["gone"] }, ctx).errors.bookIds, "One of those books no longer exists.");
  assert.deepEqual(K.check({ name: "X", tag: "Big Idea" }, ctx).value.tag, "big-idea");
  const state = { books: [book("b1", "One")], research: [L.readResearch({ id: "r1", title: "R", createdAt: 1, updatedAt: 1 })], notes: [note({ id: "a", createdAt: 1 }), note({ id: "b", tags: ["pricing"], createdAt: 2 }), note({ id: "d", tags: ["pricing"], createdAt: 3, deletedAt: 1 }), note({ id: "e", createdAt: 4 })], cards: [{ id: "c1", tags: ["pricing"] }, { id: "c2", tags: [] }] };
  const got = K.contents(Object.assign({}, c, { noteIds: ["a", "gone"], researchIds: ["r1"] }), state);
  assert.deepEqual(got.notes.map((x) => x.note.id + ":" + x.via), ["b:topic", "a:added"], "notes you added plus every note with the topic (newest first); a missing or deleted note is skipped");
  assert.deepEqual([got.books.map((b) => b.id), got.research.map((r) => r.id), got.cards.map((x) => x.id)], [["b1"], ["r1"], ["c1"]]);
  const noTag = K.contents({ noteIds: ["a"], bookIds: [], researchIds: [] }, state);
  assert.deepEqual(noTag.notes.map((x) => x.note.id), ["a"], "without a topic only what you added");
  const m = K.withMember(c, "notes", "q", true, 99), m2 = K.withMember(m, "notes", "a", false, 100);
  assert.deepEqual([m.noteIds, m2.noteIds, m2.updatedAt, c.noteIds], [["a", "z", "q"], ["z", "q"], 100, ["a", "z"]], "adding and removing leave the original alone");
  assert.deepEqual(K.collectionsOf(note({ id: "b", tags: ["pricing"] }), [c, K.read({ id: "c2", name: "Other", noteIds: ["b"], createdAt: 1, updatedAt: 1 }), K.read({ id: "c3", name: "Nope", createdAt: 1, updatedAt: 1 })]).map((x) => x.id), ["c1", "c2"]);
});
