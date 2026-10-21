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
