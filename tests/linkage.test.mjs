// Bubble pacing, panel content from the Focus snapshot, and memo drop requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-linkage-"));
const obsidianStub = path.join(outDir, "obsidian-stub.mjs");
writeFileSync(obsidianStub, "export function setIcon(el, icon) { el.icon = icon; }\n");
async function load(name) {
  await esbuild.build({
    entryPoints: [path.join(root, `src/${name}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: path.join(outDir, `${name}.mjs`),
    logLevel: "error",
    alias: { obsidian: obsidianStub },
  });
  return import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
}
const { BubbleGate, MIN_GAP_MS, bubbleDuration } = await load("bubble-gate");
const { focusCard, pulseTiles, shortcuts, clock } = await load("panel-model");
const { memoRequest, memoSourceId, normalizeDrop, canCapture } = await load("memo-drop");
const { PetMood } = await load("mood");
const { PetOverlay } = await load("overlay");

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
  const licensed = focusCard({ status: "idle", todayCount: 2, goal: 8, entitled: true }, all);
  assert.equal(licensed.tone, "idle");
  assert.equal(licensed.caption, "今天 2 / 8 个番茄");
  assert.equal(licensed.primary.command, "crisp-focus:start-pomodoro");
  assert.equal(licensed.time, undefined);
  const free = focusCard({ status: "idle", todayCount: 0, entitled: false }, all);
  assert.equal(free.primary.command, "crisp-focus:open-pomodoro", "unlicensed: no start button the Focus gate would refuse");
  assert.equal(free.caption, "今天 0 个番茄");
});

test("panel: a running session shows a countdown, progress, the task and pause/stop", () => {
  const running = focusCard(
    { status: "running", kind: "focus", remainingMs: 11 * 60000 + 30500, plannedMs: 25 * 60000, task: { title: " 写周报 " } },
    all,
  );
  assert.equal(running.tone, "focus");
  assert.equal(running.time, "11:31");
  assert.ok(Math.abs(running.progress - (1 - (11 * 60000 + 30500) / (25 * 60000))) < 1e-9);
  assert.equal(running.task, "写周报");
  assert.equal(running.primary, undefined);
  assert.deepEqual(running.secondary.map((a) => a.label), ["暂停", "结束"]);
});

test("panel: break offers skipping; paused offers resume; between rounds offers the next one", () => {
  const rest = focusCard({ status: "running", kind: "break", remainingMs: 30000, plannedMs: 300000, todayCount: 3, goal: 8 }, all);
  assert.equal(rest.tone, "break");
  assert.equal(rest.primary.label, "跳过休息");
  assert.deepEqual(rest.secondary, []);
  assert.equal(rest.caption, "今天 3 / 8 个番茄");
  const paused = focusCard({ status: "paused", kind: "focus", remainingMs: 60000 }, all);
  assert.equal(paused.tone, "paused");
  assert.deepEqual(paused.secondary.map((a) => a.label), ["继续", "结束"]);
  assert.equal(paused.progress, undefined);
  const waiting = focusCard({ status: "idle", waiting: true, round: 2 }, all);
  assert.equal(waiting.label, "第 2 个番茄");
  assert.equal(waiting.primary.label, "开始下一个");
});

test("panel: no Focus means no card; missing commands drop their buttons", () => {
  assert.equal(focusCard(null, all), null);
  const bare = focusCard({ status: "running", kind: "focus", remainingMs: 1000 }, none);
  assert.equal(bare.primary, undefined);
  assert.deepEqual(bare.secondary, []);
  assert.deepEqual(shortcuts(none), []);
  assert.deepEqual(shortcuts((id) => id.startsWith("crisp-tempo:")).map((a) => a.label), ["任务", "新建任务"]);
});

test("panel: Pulse tiles open the dashboard or memos, and flag waiting memos", () => {
  assert.deepEqual(pulseTiles(null, all), []);
  const tiles = pulseTiles({ date: "d", score: 12.6, streak: 4, active: true, memos: { today: 3, pending: 2 } }, all);
  assert.deepEqual(tiles.map((t) => [t.value, t.label]), [["13", "今日贡献"], ["4", "连续天数"], ["2", "待处理速记"]]);
  assert.equal(tiles[2].command, "crisp-pulse:open-memo-view");
  assert.equal(tiles[2].attention, true);
  const unread = pulseTiles({ date: "d", score: 0, streak: 0, active: false, memos: null }, none);
  assert.equal(unread[2].value, "—");
  assert.equal(unread[2].attention, false);
  assert.equal(unread[0].command, undefined);
});

test("clock rounds up to whole seconds and never goes negative", () => {
  assert.equal(clock(25 * 60000), "25:00");
  assert.equal(clock(59001), "01:00");
  assert.equal(clock(-5), "00:00");
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

function fakeNode(tag = "div", opts = {}, ownerDocument = null) {
  const classes = new Set((opts.cls ?? "").split(/\s+/).filter(Boolean));
  const attrs = { ...(opts.attr ?? {}) };
  const listeners = new Map();
  let shown = true;
  const node = {
    tag: tag.toLowerCase(),
    text: opts.text ?? "",
    icon: null,
    style: {},
    offsetHeight: 200,
    children: [],
    ownerDocument,
    win: { innerWidth: 1200, innerHeight: 900 },
    createEl(childTag, childOpts = {}) {
      const child = fakeNode(childTag, childOpts, node.ownerDocument);
      node.children.push(child);
      return child;
    },
    createDiv(childOpts = {}) {
      return node.createEl("div", childOpts);
    },
    createSpan(childOpts = {}) {
      return node.createEl("span", childOpts);
    },
    empty() {
      node.children.length = 0;
      node.text = "";
    },
    setText(t) {
      node.text = t;
    },
    toggleClass(cls, on) {
      if (on) classes.add(cls);
      else classes.delete(cls);
    },
    hasClass(cls) {
      return classes.has(cls);
    },
    setAttrs(next) {
      for (const [k, v] of Object.entries(next)) {
        if (v === null) delete attrs[k];
        else attrs[k] = v;
      }
    },
    getAttr(k) {
      return attrs[k];
    },
    show() {
      shown = true;
    },
    hide() {
      shown = false;
    },
    isShown() {
      return shown;
    },
    getBoundingClientRect() {
      return { left: 900, right: 1000, top: 700, bottom: 800, width: 100, height: 100 };
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    click(event = { stopPropagation() {} }) {
      listeners.get("click")?.(event);
    },
    focus() {
      node.focused = true;
    },
    findAll(pred, out = []) {
      for (const c of node.children) {
        if (pred(c)) out.push(c);
        c.findAll(pred, out);
      }
      return out;
    },
    querySelector(sel) {
      if (sel === "button") return node.findAll((c) => c.tag === "button")[0] ?? null;
      if (sel.startsWith(".")) return node.findAll((c) => c.hasClass(sel.slice(1)))[0] ?? null;
      return null;
    },
  };
  return node;
}

test("panel header renders a settings button that closes the panel, clears tooltips, and opens plugin settings", () => {
  let removedTooltips = 0;
  const ownerDocument = {
    body: {
      querySelectorAll(sel) {
        return sel === ".tooltip" ? [{ remove: () => removedTooltips++ }] : [];
      },
    },
  };
  const root = fakeNode("div", { cls: "crisp-pets" }, ownerDocument);
  const commands = [];
  let settingsOpened = 0;
  const overlay = new PetOverlay(
    root,
    (id) => commands.push(id),
    () => settingsOpened++,
  );
  overlay.openPanel(
    {
      name: "小星黄",
      focus: null,
      stats: [],
      shortcuts: [{ label: "记速记", icon: "pencil-line", command: "crisp-pulse:quick-memo" }],
      hint: "把文字拖给我，记成一条速记",
    },
    true,
  );
  assert.equal(overlay.panelOpen, true);
  const head = root.querySelector(".crisp-pets-panel__head");
  assert.ok(head, "panel must have a header container");
  assert.equal(head.querySelector(".crisp-pets-panel__name")?.text, "小星黄");
  const settingsBtn = head.querySelector("button");
  assert.ok(settingsBtn, "header must contain a settings button");
  assert.equal(settingsBtn.getAttr("aria-label"), "设置");
  assert.equal(settingsBtn.getAttr("data-tooltip-position"), "top");
  assert.equal(settingsBtn.icon, "settings");
  assert.equal(settingsBtn.focused, true, "keyboard open focuses the first button in the panel");

  let stopped = false;
  settingsBtn.click({ stopPropagation: () => (stopped = true) });
  assert.equal(stopped, true);
  assert.equal(overlay.panelOpen, false);
  assert.equal(settingsOpened, 1);
  assert.deepEqual(commands, []);
  assert.equal(removedTooltips, 1, "closing the panel clears any lingering hover tooltip");
});
