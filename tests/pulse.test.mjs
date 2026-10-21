// Crisp Pulse today state: parsing, the lines the pet says, and the panel wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-pulse-"));
await esbuild.build({
  entryPoints: [path.join(root, "src/pulse.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(outDir, "pulse.mjs"),
  logLevel: "error",
});
const { canReadToday, parseToday, pulseReactions, isStreakMilestone } = await import(
  pathToFileURL(path.join(outDir, "pulse.mjs")).href
);

const day = (over = {}) => ({ date: "2026-10-21", score: 0, streak: 4, active: false, memos: { today: 0, pending: 0 }, ...over });

test("needs Pulse with the today-state API", () => {
  assert.equal(canReadToday(undefined), false);
  assert.equal(canReadToday({ getTodaySnapshot() {} }), false);
  assert.equal(canReadToday({ pulseStateApiVersion: 1, getTodaySnapshot() {} }), true);
});

test("parse keeps a missing memo read as null, not zero", () => {
  assert.equal(parseToday(null), null);
  assert.equal(parseToday({ score: 1 }), null);
  assert.deepEqual(parseToday({ date: "2026-10-21", score: "12.5", streak: 3, active: true, memos: null }), {
    date: "2026-10-21", score: 12.5, streak: 3, active: true, memos: null,
  });
});

test("the first snapshot is a baseline: an already-active day says nothing", () => {
  assert.deepEqual(pulseReactions(null, day({ active: true }), 10, null), []);
});

test("first activity of the day greets, with the streak", () => {
  const [line] = pulseReactions(day(), day({ active: true, streak: 5, score: 2 }), 10, null);
  assert.equal(line.text, "今天开张了 · 连续 5 天");
  assert.equal(line.celebrate, false);
  assert.equal(pulseReactions(day(), day({ active: true, streak: 1 }), 10, null)[0].text, "今天开张了");
});

test("reaching a streak milestone celebrates instead", () => {
  const [line] = pulseReactions(day(), day({ active: true, streak: 30 }), 10, null);
  assert.equal(line.text, "连续 30 天了");
  assert.equal(line.celebrate, true);
  assert.equal(isStreakMilestone(7), true);
  assert.equal(isStreakMilestone(8), false);
  assert.equal(isStreakMilestone(500), true);
});

test("score changes on an already-active day, or a new day, stay quiet", () => {
  assert.deepEqual(pulseReactions(day({ active: true, score: 3 }), day({ active: true, score: 9 }), 10, null), []);
  assert.deepEqual(pulseReactions(day({ date: "2026-10-20", active: true }), day({ active: true }), 10, null), []);
});

test("in the evening, pending memos are mentioned once a day", () => {
  const next = day({ memos: { today: 5, pending: 3 } });
  assert.deepEqual(pulseReactions(next, next, 17, null), []);
  const [line] = pulseReactions(next, next, 18, null);
  assert.equal(line.text, "今天还有 3 条速记没去处");
  assert.equal(line.openMemos, true);
  assert.deepEqual(pulseReactions(next, next, 21, "2026-10-21"), []);
  assert.deepEqual(pulseReactions(next, day({ memos: { today: 5, pending: 0 } }), 21, null), []);
  assert.deepEqual(pulseReactions(next, day({ memos: null }), 21, null), []);
});
