// Failure modes from the 2026-10-21 audit (Crisp Pets 0.1.0):
// a stale editor selection must never replace text dragged from elsewhere; the panel must stay on screen near the
// top edge; a drag must start from where the pet is shown, not from a saved position outside the window;
// stored settings out of range must not reach the layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-audit-"));
async function load(name) {
  await esbuild.build({
    entryPoints: [path.join(root, `src/${name}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: path.join(outDir, `${name}.mjs`),
    logLevel: "error",
    external: ["obsidian"],
  });
  return import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
}
const { DragSession } = await load("memo-drop");
const { overlayBelow, overlayRoom, displayedOffset } = await load("layout");
const { sanitizeSettings } = await load("settings");

const sel = { text: "这是旧笔记的完整选区，包含测试文字。", path: "Old.md" };

test("a selection only counts for the drag that started from it", () => {
  const s = new DragSession();
  s.press(sel, 0);
  s.dragStart(true, 100);
  assert.deepEqual(s.resolve("测试", 200), { text: sel.text, sourcePath: "Old.md" });
  s.end();
  assert.deepEqual(s.resolve("测试", 300), { text: "测试", sourcePath: null });
});

test("pressing outside the editor, or a drag that starts elsewhere, drops the remembered selection", () => {
  const outside = new DragSession();
  outside.press(sel, 0);
  outside.pressElsewhere();
  outside.dragStart(true, 10);
  assert.deepEqual(outside.resolve("测试", 20), { text: "测试", sourcePath: null });

  const elsewhere = new DragSession();
  elsewhere.press(sel, 0);
  elsewhere.dragStart(false, 10); // e.g. side panel text
  assert.deepEqual(elsewhere.resolve("测试", 20), { text: "测试", sourcePath: null });

  // Text from another app never fires dragstart in this window.
  const external = new DragSession();
  external.press(sel, 0);
  assert.deepEqual(external.resolve("测试", 20), { text: "测试", sourcePath: null });
});

test("a press long before the drag starts does not count", () => {
  const s = new DragSession();
  s.press(sel, 0);
  s.dragStart(true, 10000);
  assert.deepEqual(s.resolve("测试", 10001), { text: "测试", sourcePath: null });
});

test("unrelated text in an editor drag keeps what was dropped", () => {
  const s = new DragSession();
  s.press(sel, 0);
  s.dragStart(true, 10);
  assert.deepEqual(s.resolve("别的字", 20), { text: "别的字", sourcePath: null });
});

test("the panel opens below when there is not enough room above", () => {
  assert.equal(overlayBelow({ top: 5, bottom: 130 }, 280, 1346), true);
  assert.equal(overlayBelow({ top: 800, bottom: 925 }, 280, 1346), false);
  // Neither side fits: use the larger one.
  assert.equal(overlayBelow({ top: 300, bottom: 425 }, 400, 600), false);
  assert.equal(overlayBelow({ top: 100, bottom: 225 }, 400, 600), true);
});

// Round 2: in a short window neither side fits, so the panel must be capped to the side it opens on and scroll.
test("the panel is capped to the room on the side it opens toward", () => {
  // 494 x 414 viewport from the audit: pet 150..275, panel 282 tall.
  const pet = { top: 150, bottom: 275 };
  const below = overlayBelow(pet, 282, 414);
  assert.equal(below, false);
  const room = overlayRoom(pet, below, 414);
  assert.ok(room < 282 && pet.top - 8 - room >= 0, "the capped panel stays inside the top edge");
  assert.ok(overlayRoom(pet, true, 414) <= 414 - pet.bottom - 8);
  assert.equal(overlayRoom({ top: 2, bottom: 410 }, false, 414), 0, "no negative room");
});

test("a drag starts from the shown position, not a saved one outside the window", () => {
  assert.deepEqual(displayedOffset({ left: 0, top: 500, right: 115, bottom: 625 }, 1200, 900), { right: 1085, bottom: 275 });
});

test("stored settings are clamped and typed", () => {
  const clean = sanitizeSettings({ size: 400, offset: { right: "x", bottom: -50 }, visible: "yes", petsFolder: 3 });
  assert.equal(clean.size, 100);
  assert.deepEqual(clean.offset, { right: 24, bottom: 0 });
  assert.equal(clean.visible, true);
  assert.equal(clean.petsFolder, "");
  assert.equal(sanitizeSettings(null).size, 50);
  assert.equal(sanitizeSettings({ size: 10 }).size, 25);
});
