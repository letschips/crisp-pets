// Keeps the pet from chattering: each kind of line has its own cooldown, and any two lines are spaced out.
// Lines the user asked for (a drop result) skip the gate.

export const MIN_GAP_MS = 4000;

export class BubbleGate {
  private lastByKey = new Map<string, number>();
  private lastAny = -Infinity;

  allow(key: string, cooldownMs: number, now: number): boolean {
    if (now - this.lastAny < MIN_GAP_MS) return false;
    if (now - (this.lastByKey.get(key) ?? -Infinity) < cooldownMs) return false;
    this.lastByKey.set(key, now);
    this.lastAny = now;
    return true;
  }

  // Records a line shown outside the gate so ambient lines don't pile on right after it.
  note(now: number): void {
    this.lastAny = now;
  }
}

// Long enough to read: 2.5 s plus ~60 ms per character, capped.
export function bubbleDuration(text: string): number {
  return Math.min(8000, 2500 + [...text].length * 60);
}
