export interface PetSettings {
  visible: boolean;
  petsFolder: string;
  followCodex: boolean; // show whichever local pet Codex has selected
  petId: string; // pet folder name, used when not following Codex or Codex has no local pet selected
  size: number; // percent of the 192x208 cell
  offset: { right: number; bottom: number };
  memoNudgedOn: string; // date the evening "memos without a destination" line was last shown
}

export const DEFAULT_SETTINGS: PetSettings = {
  visible: true,
  petsFolder: "",
  followCodex: true,
  petId: "",
  size: 50,
  offset: { right: 24, bottom: 40 },
  memoNudgedOn: "",
};

export const SIZE_MIN = 25;
export const SIZE_MAX = 100;

// data.json is user-editable; anything of the wrong type falls back to the default and numbers are kept in range.
export function sanitizeSettings(raw: unknown): PetSettings {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof PetSettings) => (typeof data[key] === "boolean" ? (data[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean));
  const str = (key: keyof PetSettings) => (typeof data[key] === "string" ? (data[key] as string) : (DEFAULT_SETTINGS[key] as string));
  const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const offset = (typeof data.offset === "object" && data.offset !== null ? data.offset : {}) as Record<string, unknown>;
  return {
    visible: bool("visible"),
    petsFolder: str("petsFolder"),
    followCodex: bool("followCodex"),
    petId: str("petId"),
    size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(num(data.size, DEFAULT_SETTINGS.size)))),
    offset: {
      right: Math.max(0, num(offset.right, DEFAULT_SETTINGS.offset.right)),
      bottom: Math.max(0, num(offset.bottom, DEFAULT_SETTINGS.offset.bottom)),
    },
    memoNudgedOn: str("memoNudgedOn"),
  };
}
