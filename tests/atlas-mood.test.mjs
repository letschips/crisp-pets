// Codex pet contract parsing and the pose state machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-"));
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
const atlas = await load("atlas");
const { PetMood, TYPING_HOLD_MS, WAITING_HOLD_MS, LOOK_HOLD_MS, animationLength } = await load("mood");

test("manifest without spriteVersionNumber is v1, like Codex", () => {
  const manifest = atlas.parseManifest({ id: "tudou", displayName: "Tudou", spritesheetPath: "spritesheet.webp" }, "folder");
  assert.equal(manifest.spriteVersion, 1);
});

test("manifest rejects unknown versions and paths leaving the folder", () => {
  assert.throws(() => atlas.parseManifest({ spriteVersionNumber: 3 }, "x"));
  assert.throws(() => atlas.parseManifest({ spritesheetPath: "../other.webp" }, "x"));
  assert.throws(() => atlas.parseManifest({ spritesheetPath: "/etc/a.png" }, "x"));
});

test("atlas size must match its version", () => {
  atlas.checkAtlasSize(2, 1536, 2288);
  atlas.checkAtlasSize(1, 1536, 1872);
  assert.throws(() => atlas.checkAtlasSize(1, 1536, 2288));
  assert.throws(() => atlas.checkAtlasSize(2, 1536, 1872));
});

test("every animation fits in the 8 columns", () => {
  for (const animation of Object.values(atlas.ANIMATIONS)) {
    assert.ok(animation.durations.length >= 1 && animation.durations.length <= 8);
  }
});

test("look index: 0 is up, clockwise, deadzone is null", () => {
  assert.equal(atlas.lookIndex(0, -100, 40), 0);
  assert.equal(atlas.lookIndex(100, 0, 40), 4);
  assert.equal(atlas.lookIndex(0, 100, 40), 8);
  assert.equal(atlas.lookIndex(-100, 0, 40), 12);
  assert.equal(atlas.lookIndex(-100, -100, 40), 14);
  assert.equal(atlas.lookIndex(-1, -100, 40), 0); // just left of up wraps to 0, not 16
  assert.equal(atlas.lookIndex(10, 10, 40), null);
  assert.deepEqual(atlas.lookCell(0), { row: 9, column: 0 });
  assert.deepEqual(atlas.lookCell(15), { row: 10, column: 7 });
});

test("typing runs, then waits, then returns to idle", () => {
  const mood = new PetMood(true);
  mood.typed(1000);
  assert.equal(mood.pose(1000).state, "running");
  assert.equal(mood.pose(1000 + TYPING_HOLD_MS).state, "waiting");
  assert.equal(mood.pose(1000 + TYPING_HOLD_MS + WAITING_HOLD_MS).state, "idle");
});

test("reading view shows review once typing has settled", () => {
  const mood = new PetMood(true);
  mood.setReading(true);
  assert.equal(mood.pose(0).state, "review");
});

test("one-shot plays its full row, and a failure is not cut off by a wave", () => {
  const mood = new PetMood(true);
  mood.trigger("failed", 0);
  mood.trigger("waving", 10);
  assert.equal(mood.pose(20).state, "failed");
  assert.equal(mood.pose(animationLength("failed")).state, "idle");
});

test("drag overrides everything with the matching direction", () => {
  const mood = new PetMood(true);
  mood.trigger("failed", 0);
  mood.drag("left");
  assert.equal(mood.pose(1).state, "running-left");
  mood.drag(null);
  assert.equal(mood.pose(1).state, "failed");
});

test("look only for v2 pets, only while the pointer is recent and outside the deadzone", () => {
  const v2 = new PetMood(true);
  v2.pointerAt(100, 0, 0);
  assert.deepEqual(v2.pose(10), { kind: "look", index: 4 });
  assert.equal(v2.pose(LOOK_HOLD_MS).state, "idle");
  v2.pointerAt(5, 5, 0);
  assert.equal(v2.pose(10).state, "idle");

  const v1 = new PetMood(false);
  v1.pointerAt(100, 0, 0);
  assert.equal(v1.pose(10).state, "idle");
});
