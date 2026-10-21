// Decides what the pet shows from Obsidian activity. Pure and clock-driven so it can be tested.
import { ANIMATIONS, PetState, lookIndex } from "./atlas";

export const TYPING_HOLD_MS = 1500;
export const WAITING_HOLD_MS = 8000;
export const LOOK_HOLD_MS = 3000;
export const LOOK_DEADZONE_PX = 40;

export type Pose = { kind: "animation"; state: PetState } | { kind: "look"; index: number };

type OneShot = "waving" | "jumping" | "failed";
const ONE_SHOT_PRIORITY: Record<OneShot, number> = { waving: 1, jumping: 2, failed: 3 };

export function animationLength(state: PetState): number {
  return ANIMATIONS[state].durations.reduce((sum, ms) => sum + ms, 0);
}

export class PetMood {
  private lastTyped = -Infinity;
  private reading = false;
  private oneShot: { state: OneShot; until: number } | null = null;
  private dragDirection: "left" | "right" | null = null;
  private pointer: { dx: number; dy: number; at: number } | null = null;

  constructor(private readonly canLook: boolean) {}

  typed(now: number): void {
    this.lastTyped = now;
  }

  setReading(reading: boolean): void {
    this.reading = reading;
  }

  // Plays a whole row once. A lower-priority reaction never cuts off a higher one still playing.
  trigger(state: OneShot, now: number): void {
    const current = this.oneShot;
    if (current && current.until > now && ONE_SHOT_PRIORITY[current.state] > ONE_SHOT_PRIORITY[state]) return;
    this.oneShot = { state, until: now + animationLength(state) };
  }

  drag(direction: "left" | "right" | null): void {
    this.dragDirection = direction;
  }

  pointerAt(dx: number, dy: number, now: number): void {
    this.pointer = { dx, dy, at: now };
  }

  pose(now: number): Pose {
    if (this.dragDirection) return { kind: "animation", state: `running-${this.dragDirection}` };
    if (this.oneShot && this.oneShot.until > now) return { kind: "animation", state: this.oneShot.state };
    this.oneShot = null;
    if (now - this.lastTyped < TYPING_HOLD_MS) return { kind: "animation", state: "running" };
    if (now - this.lastTyped < TYPING_HOLD_MS + WAITING_HOLD_MS) return { kind: "animation", state: "waiting" };
    if (this.reading) return { kind: "animation", state: "review" };
    if (this.canLook && this.pointer && now - this.pointer.at < LOOK_HOLD_MS) {
      const index = lookIndex(this.pointer.dx, this.pointer.dy, LOOK_DEADZONE_PX);
      if (index !== null) return { kind: "look", index };
    }
    return { kind: "animation", state: "idle" };
  }
}
