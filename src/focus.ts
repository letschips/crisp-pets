// Crisp Focus integration. Focus emits workspace event "crisp-focus:session" with
// { apiVersion, type: start|pause|resume|stop|skip|complete, kind: focus|break, ... }.
// Only focus sessions move the pet; breaks leave it alone.

export const FOCUS_EVENT = "crisp-focus:session";

export interface FocusReaction {
  focusing: boolean;
  jump: boolean;
}

export function focusReaction(event: unknown): FocusReaction | null {
  if (typeof event !== "object" || event === null) return null;
  const { apiVersion, type, kind } = event as Record<string, unknown>;
  if (typeof apiVersion !== "number" || apiVersion < 1 || kind !== "focus") return null;
  switch (type) {
    case "start":
    case "resume":
      return { focusing: true, jump: false };
    case "pause":
    case "stop":
    case "skip":
      return { focusing: false, jump: false };
    case "complete":
      return { focusing: false, jump: true };
    default:
      return null;
  }
}

// Picks up a focus session already running when the pet mounts.
export function focusingFromSnapshot(snapshot: unknown): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const { status, kind } = snapshot as Record<string, unknown>;
  return status === "running" && kind === "focus";
}
