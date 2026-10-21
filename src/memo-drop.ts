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

// Obsidian's editor collapses the selection to the character under the mouse before the drag starts, so only
// that character arrives. The session remembers the selection pressed on and lends it to exactly one drag that
// starts from the editor right after; any other press, a drag from elsewhere, or the drag ending clears it.
export const PRESS_TO_DRAG_MS = 5000;

export interface PressedSelection {
  text: string;
  path: string | null;
}

export class DragSession {
  private pressed: (PressedSelection & { at: number }) | null = null;
  private active: PressedSelection | null = null;

  press(selection: PressedSelection, now: number): void {
    this.pressed = { ...selection, at: now };
  }

  pressElsewhere(): void {
    this.pressed = null;
  }

  dragStart(fromEditor: boolean, now: number): void {
    const pressed = this.pressed;
    this.active = fromEditor && pressed && now - pressed.at <= PRESS_TO_DRAG_MS ? { text: pressed.text, path: pressed.path } : null;
    this.pressed = null;
  }

  end(): void {
    this.active = null;
  }

  resolve(dropped: string, _now: number): { text: string; sourcePath: string | null } {
    const active = this.active;
    this.active = null;
    if (active && dropped && active.text.includes(dropped)) return { text: active.text, sourcePath: active.path };
    return { text: dropped, sourcePath: null };
  }
}
