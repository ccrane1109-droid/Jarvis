"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../scripts/setup-vapid");

const KEYS = { publicKey: "PUBLIC-KEY-VALUE-1234567890", privateKey: "PRIVATE-KEY-VALUE-SECRET-0987654321" };
// A stand-in for the Firebase tool: `state` maps a secret name to whether it exists.
function fakeRun(state, opts) {
  const calls = [];
  const run = (args, input) => {
    calls.push({ args: args, input: input });
    if (args[0] === "functions:secrets:access") {
      if (opts && opts.unknown) return { status: 1, stderr: "Error: Failed to authenticate, have you run firebase login?", stdout: "" };
      return state[args[1]] ? { status: 0, stdout: "value", stderr: "" } : { status: 1, stderr: "Error: Secret [x] not found", stdout: "" };
    }
    if (opts && opts.failOn === args[1]) return { status: 1, stderr: "boom " + input, stdout: "" };
    state[args[1]] = true;
    return { status: 0, stdout: "", stderr: "" };
  };
  run.calls = calls;
  return run;
}
const logger = () => { const lines = []; const f = (m) => lines.push(m); f.lines = lines; return f; };

test("first run creates both secrets, passing the keys on stdin and never printing them", () => {
  const state = {};
  const run = fakeRun(state);
  const log = logger();
  assert.equal(setup.main({ run, log, generate: () => KEYS }), 0);
  const sets = run.calls.filter((c) => c.args[0] === "functions:secrets:set");
  assert.deepEqual(sets.map((c) => c.args[1]), ["VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY"]);
  assert.deepEqual(sets.map((c) => c.input), [KEYS.privateKey, KEYS.publicKey]);
  sets.forEach((c) => assert.deepEqual(c.args.slice(2), ["--data-file", "-", "--force"], "the key is read from stdin, not put on the command line"));
  assert.ok(!sets.some((c) => c.args.join(" ").includes(KEYS.privateKey)), "never on the command line");
  assert.ok(!log.lines.join("\n").includes(KEYS.privateKey) && !log.lines.join("\n").includes(KEYS.publicKey));
  assert.match(log.lines.join("\n"), /not displayed/);
});

test("it won't replace keys that exist, since that would switch off every phone", () => {
  const state = { VAPID_PUBLIC_KEY: true, VAPID_PRIVATE_KEY: true };
  const run = fakeRun(state);
  const log = logger();
  assert.equal(setup.main({ run, log, generate: () => KEYS }), 0);
  assert.equal(run.calls.filter((c) => c.args[0] === "functions:secrets:set").length, 0);
  assert.match(log.lines[0], /already set up/);
});

test("if it can't tell whether keys exist, or only one exists, it changes nothing", () => {
  const unknown = fakeRun({}, { unknown: true });
  const log = logger();
  assert.equal(setup.main({ run: unknown, log, generate: () => KEYS }), 1);
  assert.equal(unknown.calls.filter((c) => c.args[0] === "functions:secrets:set").length, 0);
  assert.match(log.lines.join(" "), /nothing was changed/i);

  const half = fakeRun({ VAPID_PUBLIC_KEY: true });
  const log2 = logger();
  assert.equal(setup.main({ run: half, log: log2, generate: () => KEYS }), 1);
  assert.equal(half.calls.filter((c) => c.args[0] === "functions:secrets:set").length, 0);
  assert.match(log2.lines.join(" "), /--force-new/);
});

test("--force-new replaces them on purpose, and a failure never echoes the key", () => {
  const state = { VAPID_PUBLIC_KEY: true, VAPID_PRIVATE_KEY: true };
  const run = fakeRun(state);
  assert.equal(setup.main({ run, log: logger(), generate: () => KEYS, forceNew: true }), 0);
  assert.equal(run.calls.filter((c) => c.args[0] === "functions:secrets:access").length, 0, "no check when replacing on purpose");
  assert.equal(run.calls.filter((c) => c.args[0] === "functions:secrets:set").length, 2);

  const failing = fakeRun({}, { failOn: "VAPID_PRIVATE_KEY" });
  const log = logger();
  assert.equal(setup.main({ run: failing, log, generate: () => KEYS }), 1);
  const out = log.lines.join("\n");
  assert.ok(out.includes("Couldn't save VAPID_PRIVATE_KEY") && !out.includes(KEYS.privateKey) && out.includes("[hidden]"));
});
