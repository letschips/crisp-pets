// Bubble pacing, panel content from the Focus snapshot, and memo drop requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-linkage-"));
async function load(name) {
  await esbuild.build({
    entryPoints: [path.join(root, `src/${name}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: path.join(outDir, `${name}.mjs`),
    logLevel: "error",
  });
  return import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
}
const { BubbleGate, MIN_GAP_MS, bubbleDuration } = await load("bubble-gate");
const { focusSection, launcherSections } = await load("panel-model");
const { memoRequest, memoSourceId, normalizeDrop, canCapture } = await load("memo-drop");
const { PetMood } = await load("mood");

const all = () => true;
const none = () => false;

test("bubble gate: per-key cooldown and a minimum gap between any two lines", () => {
  const gate = new BubbleGate();
  assert.equal(gate.allow("a", 60000, 0), true);
  assert.equal(gate.allow("b", 60000, 100), false); // too soon after any line
  assert.equal(gate.allow("b", 60000, MIN_GAP_MS), true);
  assert.equal(gate.allow("a", 60000, MIN_GAP_MS * 3), false); // a still cooling down
  assert.equal(gate.allow("a", 60000, 60000), true);
  gate.note(70000);
  assert.equal(gate.allow("c", 0, 70001), false); // a reply just showed
});

test("bubble stays longer for longer text, within limits", () => {
  assert.ok(bubbleDuration("记下了") < bubbleDuration("这段之前记过了，点我看看"));
  assert.equal(bubbleDuration("字".repeat(500)), 8000);
});

test("panel: idle shows today's pomodoros and the start button that fits the licence", () => {
  const licensed = focusSection({ status: "idle", todayCount: 2, goal: 8, entitled: true }, all);
  assert.equal(licensed.status, "今天 2 个番茄 · 目标 8");
  assert.deepEqual(licensed.actions.map((a) => a.command), ["crisp-focus:start-pomodoro"]);
  const free = focusSection({ status: "idle", todayCount: 0, entitled: false }, all);
  assert.deepEqual(free.actions.map((a) => a.command), ["crisp-focus:start-focus-session-25"]);
});

test("panel: running focus shows time left and the task; a break offers skipping", () => {
  const running = focusSection(
    { status: "running", kind: "focus", remainingMs: 11 * 60000 + 1, task: { title: " 写周报 " } },
    all,
  );
  assert.equal(running.status, "专注中 · 还剩 12 分钟");
  assert.equal(running.task, "写周报");
  assert.deepEqual(running.actions.map((a) => a.label), ["暂停", "结束"]);
  const rest = focusSection({ status: "running", kind: "break", remainingMs: 30000 }, all);
  assert.equal(rest.status, "休息中 · 还剩 1 分钟");
  assert.deepEqual(rest.actions.map((a) => a.label), ["跳过休息"]);
  const paused = focusSection({ status: "paused", kind: "focus", remainingMs: 60000 }, all);
  assert.deepEqual(paused.actions.map((a) => a.label), ["继续", "结束"]);
  const waiting = focusSection({ status: "idle", waiting: true, round: 2 }, all);
  assert.equal(waiting.status, "第 2 个番茄待开始");
});

test("panel: no Focus means no section; missing commands drop their buttons", () => {
  assert.equal(focusSection(null, all), null);
  assert.deepEqual(focusSection({ status: "idle", entitled: true }, none).actions, []);
  assert.deepEqual(launcherSections(none), []);
  const pulseOnly = launcherSections((id) => id.startsWith("crisp-pulse:"));
  assert.deepEqual(pulseOnly.map((s) => s.title), ["Pulse"]);
});

test("memo drop: same text from the same note keeps one source id; ids fit Pulse's pattern", () => {
  const a = memoSourceId("Notes/a.md", "hello");
  assert.equal(a, memoSourceId("Notes/a.md", "hello"));
  assert.notEqual(a, memoSourceId("Notes/b.md", "hello"));
  assert.notEqual(a, memoSourceId(null, "hello"));
  assert.match(a, /^[a-z][a-z0-9-]*:[A-Za-z0-9_-]{1,128}$/);
  const request = memoRequest("hello", null);
  assert.equal(request.apiVersion, 1);
  assert.equal(request.quote, "hello");
  assert.equal(request.revision, "");
});

test("memo drop: text is trimmed and line endings unified", () => {
  assert.equal(normalizeDrop("  a\r\nb\r  "), "a\nb");
});

test("memo drop: needs Pulse with the capture API at version 1 or later", () => {
  const api = { captureMemoFromSource() {}, revealMemo() {} };
  assert.equal(canCapture(undefined), false);
  assert.equal(canCapture({ ...api, memoCaptureApiVersion: 0 }), false);
  assert.equal(canCapture({ ...api, memoCaptureApiVersion: 1 }), true);
  assert.equal(canCapture({ memoCaptureApiVersion: 1, captureMemoFromSource() {} }), false);
});

test("pet waits while text hovers over it", () => {
  const mood = new PetMood(true);
  mood.setFocusing(true);
  mood.setExpecting(true);
  assert.equal(mood.pose(0).state, "waiting");
  mood.setExpecting(false);
  assert.equal(mood.pose(0).state, "running");
});
