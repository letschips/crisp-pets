// Crisp Focus session events driving the pet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pet-focus-"));
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
const { focusReaction, focusingFromSnapshot } = await load("focus");
const { PetMood, animationLength } = await load("mood");

const event = (type, kind = "focus") => ({ apiVersion: 2, type, kind, id: "s1" });

test("focus start and resume keep working; pause, stop and skip end it", () => {
  assert.deepEqual(focusReaction(event("start")), { focusing: true, jump: false });
  assert.deepEqual(focusReaction(event("resume")), { focusing: true, jump: false });
  for (const type of ["pause", "stop", "skip"]) {
    assert.deepEqual(focusReaction(event(type)), { focusing: false, jump: false });
  }
});

test("only a completed focus session jumps", () => {
  assert.deepEqual(focusReaction(event("complete")), { focusing: false, jump: true });
  assert.equal(focusReaction(event("complete", "break")), null);
  assert.equal(focusReaction(event("start", "break")), null);
});

test("malformed or unversioned events are ignored", () => {
  assert.equal(focusReaction(null), null);
  assert.equal(focusReaction({ type: "start", kind: "focus" }), null);
  assert.equal(focusReaction({ apiVersion: 2, type: "tick", kind: "focus" }), null);
});

test("snapshot: only a running focus phase counts", () => {
  assert.equal(focusingFromSnapshot({ status: "running", kind: "focus" }), true);
  assert.equal(focusingFromSnapshot({ status: "paused", kind: "focus" }), false);
  assert.equal(focusingFromSnapshot({ status: "running", kind: "break" }), false);
  assert.equal(focusingFromSnapshot(undefined), false);
});

test("pet works through a whole session, then jumps once and settles", () => {
  const mood = new PetMood(true);
  mood.setFocusing(true);
  assert.equal(mood.pose(0).state, "running");
  assert.equal(mood.pose(25 * 60000).state, "running"); // no timeout, unlike typing
  mood.setFocusing(false);
  mood.trigger("jumping", 25 * 60000);
  assert.equal(mood.pose(25 * 60000 + 1).state, "jumping");
  assert.equal(mood.pose(25 * 60000 + animationLength("jumping")).state, "idle");
});

test("focusing outranks reading view and look, but a reaction still plays", () => {
  const mood = new PetMood(true);
  mood.setReading(true);
  mood.pointerAt(100, 0, 0);
  mood.setFocusing(true);
  assert.equal(mood.pose(1).state, "running");
  mood.trigger("waving", 1);
  assert.equal(mood.pose(2).state, "waving");
});
