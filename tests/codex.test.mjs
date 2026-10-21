// Following the pet Codex currently shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-codex-"));
await esbuild.build({
  entryPoints: [path.join(root, "src/codex.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(outDir, "codex.mjs"),
  logLevel: "error",
});
const { parseSelectedAvatarId, needsGlobalState, resolveSelectedPet } = await import(
  pathToFileURL(path.join(outDir, "codex.mjs")).href
);

const state = {
  "electron-persisted-atom-state": {
    "migrated-cloud-pet-ids-v1": {
      '["account","user"]': { "custom:aero-pup": "pet_aaa", "custom:pink-muse": "pet_bbb" },
    },
  },
};

test("reads selected-avatar-id from config.toml, wherever it sits", () => {
  const toml = 'model = "x"\n\n[desktop]\nsansFontSize = 14\nselected-avatar-id = "pet_aaa"\n';
  assert.equal(parseSelectedAvatarId(toml), "pet_aaa");
  assert.equal(parseSelectedAvatarId("# selected-avatar-id = \"pet_aaa\"\n"), null);
  assert.equal(parseSelectedAvatarId("model = \"x\"\n"), null);
});

test("custom ids name the folder directly", () => {
  assert.equal(needsGlobalState("custom:aero-pup"), false);
  assert.equal(resolveSelectedPet("custom:aero-pup", null), "aero-pup");
});

test("cloud ids map back to the migrated local pet", () => {
  assert.equal(needsGlobalState("pet_bbb"), true);
  assert.equal(resolveSelectedPet("pet_bbb", state), "pink-muse");
});

test("cloud-only pets and unexpected state shapes give no selection", () => {
  assert.equal(resolveSelectedPet("pet_builtin", state), null);
  assert.equal(resolveSelectedPet("pet_aaa", null), null);
  assert.equal(resolveSelectedPet("pet_aaa", { "electron-persisted-atom-state": { "migrated-cloud-pet-ids-v1": 3 } }), null);
});
