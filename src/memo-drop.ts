// Text dropped on the pet becomes a Crisp Pulse memo through Pulse's source-capture API (v1).
// The source id is a hash of the note it came from plus the text, so dropping the same passage
// twice reveals the existing memo instead of adding a copy.
import { createHash } from "node:crypto";

export const MEMO_API_VERSION = 1;
export const MAX_DROP_CHARS = 5000;

export interface MemoCaptureRequest {
  apiVersion: number;
  sourceId: string;
  revision: string;
  quote: string;
  sourcePath: string | null;
}

export function normalizeDrop(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function memoSourceId(sourcePath: string | null, text: string): string {
  const digest = createHash("sha256").update(`${sourcePath ?? ""}\n${text}`).digest("hex");
  return `crisp-pets:${digest.slice(0, 32)}`;
}

export function memoRequest(text: string, sourcePath: string | null): MemoCaptureRequest {
  return {
    apiVersion: MEMO_API_VERSION,
    sourceId: memoSourceId(sourcePath, text),
    revision: "",
    quote: text,
    sourcePath,
  };
}

export interface PulseMemoApi {
  memoCaptureApiVersion?: number;
  captureMemoFromSource?: (request: MemoCaptureRequest) => Promise<{ status: string; memo?: { id?: string } }>;
  revealMemo?: (target: { id: string }) => Promise<void>;
}

export function canCapture(pulse: PulseMemoApi | undefined): pulse is Required<PulseMemoApi> {
  return (
    !!pulse &&
    typeof pulse.captureMemoFromSource === "function" &&
    typeof pulse.revealMemo === "function" &&
    Number(pulse.memoCaptureApiVersion) >= MEMO_API_VERSION
  );
}

// The selection under the mouse when a drag began in an editor.
export interface PressedSelection {
  text: string;
  path: string | null;
  at: number;
}

export const PRESS_TTL_MS = 60000;

// Obsidian's editor collapses the selection to the character under the mouse before the drag starts,
// so only that character arrives. When the dropped text is part of the selection that was pressed on,
// the whole selection is meant, and it came from that note.
export function resolveDrop(
  dropped: string,
  pressed: PressedSelection | null,
  now: number,
): { text: string; sourcePath: string | null } {
  if (pressed && now - pressed.at <= PRESS_TTL_MS && dropped && pressed.text.includes(dropped)) {
    return { text: pressed.text, sourcePath: pressed.path };
  }
  return { text: dropped, sourcePath: null };
}
