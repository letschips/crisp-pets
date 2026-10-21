// Settings pet picker with many pets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), "crisp-pets-picker-"));
await esbuild.build({
  entryPoints: [path.join(root, "src/picker.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(outDir, "picker.mjs"),
  logLevel: "error",
});
const { pickerLayout, orderPets, matchesQuery } = await import(pathToFileURL(path.join(outDir, "picker.mjs")).href);

test("full cards up to six pets, compact beyond, search beyond twelve", () => {
  assert.deepEqual(pickerLayout(3), { compact: false, search: false });
  assert.deepEqual(pickerLayout(6), { compact: false, search: false });
  assert.deepEqual(pickerLayout(7), { compact: true, search: false });
  assert.deepEqual(pickerLayout(12), { compact: true, search: false });
  assert.deepEqual(pickerLayout(13), { compact: true, search: true });
});

test("the current pet leads only in the compact grid", () => {
  const pets = ["a", "b", "c"];
  assert.deepEqual(orderPets(pets, "c", true), ["c", "a", "b"]);
  assert.deepEqual(orderPets(pets, "c", false), ["a", "b", "c"]);
  assert.deepEqual(orderPets(pets, undefined, true), pets);
  assert.deepEqual(orderPets(pets, "z", true), pets);
});

test("search matches name or folder, ignoring case and spaces around", () => {
  assert.equal(matchesQuery(["Aero Pup", "aero-pup"], " aero "), true);
  assert.equal(matchesQuery(["Aero Pup", "aero-pup"], "PUP"), true);
  assert.equal(matchesQuery(["Aero Pup", "aero-pup"], "muse"), false);
  assert.equal(matchesQuery(["Aero Pup", undefined], ""), true);
});
