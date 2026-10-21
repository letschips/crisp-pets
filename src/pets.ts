// Reads Codex pet folders straight from disk (desktop only; the folder lives outside the vault).
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { PetManifest, checkAtlasSize, parseManifest } from "./atlas";

export interface PetEntry {
  folder: string;
  manifest?: PetManifest;
  error?: string;
}

export function defaultPetsFolder(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return join(codexHome || join(homedir(), ".codex"), "pets");
}

export function resolvePetsFolder(configured: string): string {
  const value = configured.trim();
  if (!value) return defaultPetsFolder();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

export async function listPets(root: string): Promise<PetEntry[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const entries: PetEntry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue;
    const folder = join(root, name);
    try {
      if (!(await stat(folder)).isDirectory()) continue;
      const raw = JSON.parse(await readFile(join(folder, "pet.json"), "utf8"));
      entries.push({ folder, manifest: parseManifest(raw, name) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      entries.push({ folder, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return entries;
}

const IMAGE_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
};

export interface LoadedSheet {
  url: string;
  width: number;
  height: number;
}

// Returns an object URL the caller must revoke.
export async function loadSpritesheet(folder: string, manifest: PetManifest): Promise<LoadedSheet> {
  const type = IMAGE_TYPES[extname(manifest.spritesheetPath).toLowerCase()];
  if (!type) throw new Error("spritesheet must be PNG or WebP");
  const bytes = await readFile(join(folder, manifest.spritesheetPath));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    checkAtlasSize(manifest.spriteVersion, image.naturalWidth, image.naturalHeight);
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
