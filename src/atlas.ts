// Codex pet contract: pet.json + one spritesheet on a fixed 8-column grid of 192x208 cells.
// v1 has 9 animation rows (1536x1872); v2 adds two rows of 16 look directions (1536x2288).

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;

export type PetState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export interface Animation {
  row: number;
  durations: number[];
}

function frames(count: number, each: number, last: number): number[] {
  return [...Array(count - 1).fill(each), last];
}

// Row order and timings from the hatch-pet animation table.
export const ANIMATIONS: Record<PetState, Animation> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, durations: frames(8, 120, 220) },
  "running-left": { row: 2, durations: frames(8, 120, 220) },
  waving: { row: 3, durations: frames(4, 140, 280) },
  jumping: { row: 4, durations: frames(5, 140, 280) },
  failed: { row: 5, durations: frames(8, 140, 240) },
  waiting: { row: 6, durations: frames(6, 150, 260) },
  running: { row: 7, durations: frames(6, 120, 220) },
  review: { row: 8, durations: frames(6, 150, 280) },
};

export interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spriteVersion: 1 | 2;
  spritesheetPath: string;
}

export function parseManifest(raw: unknown, folderName: string): PetManifest {
  if (typeof raw !== "object" || raw === null) throw new Error("pet.json is not an object");
  const data = raw as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const value = data[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  // Codex treats a missing version as v1.
  const version = data.spriteVersionNumber ?? 1;
  if (version !== 1 && version !== 2) throw new Error(`unsupported spriteVersionNumber ${String(version)}`);
  const spritesheetPath = text("spritesheetPath") ?? "spritesheet.webp";
  if (spritesheetPath.includes("..") || spritesheetPath.startsWith("/")) {
    throw new Error("spritesheetPath must stay inside the pet folder");
  }
  const id = text("id") ?? folderName;
  return {
    id,
    displayName: text("displayName") ?? id,
    description: text("description") ?? "",
    spriteVersion: version,
    spritesheetPath,
  };
}

export function expectedSize(version: 1 | 2): { width: number; height: number } {
  return { width: COLUMNS * CELL_WIDTH, height: (version === 2 ? 11 : 9) * CELL_HEIGHT };
}

export function checkAtlasSize(version: 1 | 2, width: number, height: number): void {
  const expected = expectedSize(version);
  if (width !== expected.width || height !== expected.height) {
    throw new Error(
      `v${version} spritesheet must be ${expected.width}x${expected.height}, got ${width}x${height}`,
    );
  }
}

// Look rows: index 0 is up (12 o'clock), then clockwise in 22.5° steps.
// Returns null inside the deadzone, where the pet falls back to idle.
export function lookIndex(dx: number, dy: number, deadzone: number): number | null {
  if (Math.hypot(dx, dy) < deadzone) return null;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(((degrees + 360) % 360) / 22.5) % 16;
}

export function lookCell(index: number): { row: number; column: number } {
  return { row: 9 + Math.floor(index / 8), column: index % 8 };
}
