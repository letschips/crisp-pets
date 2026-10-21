// Crisp Pulse today state (pulseStateApiVersion 1): getTodaySnapshot() and the "crisp-pulse:state" event.
// The pet only reads it; Pulse stays the one source of scores, streaks and memos.

export const PULSE_STATE_EVENT = "crisp-pulse:state";
export const PULSE_STATE_API_VERSION = 1;
export const EVENING_HOUR = 18;

export interface PulseToday {
  date: string;
  score: number;
  streak: number;
  active: boolean;
  memos: { today: number; pending: number } | null;
}

export interface PulseStateApi {
  pulseStateApiVersion?: number;
  getTodaySnapshot?: () => Promise<unknown>;
}

export function canReadToday(pulse: PulseStateApi | undefined): pulse is Required<PulseStateApi> {
  return !!pulse && typeof pulse.getTodaySnapshot === "function" && Number(pulse.pulseStateApiVersion) >= PULSE_STATE_API_VERSION;
}

export function parseToday(raw: unknown): PulseToday | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.date !== "string") return null;
  const memos = data.memos as Record<string, unknown> | null | undefined;
  return {
    date: data.date,
    score: Number(data.score) || 0,
    streak: Number(data.streak) || 0,
    active: data.active === true,
    memos:
      memos && typeof memos === "object"
        ? { today: Number(memos.today) || 0, pending: Number(memos.pending) || 0 }
        : null,
  };
}

const MILESTONES = [3, 7, 14, 21, 30, 50, 100, 150, 200, 365];

export function isStreakMilestone(streak: number): boolean {
  return MILESTONES.includes(streak) || (streak > 365 && streak % 100 === 0);
}

export interface PulseReaction {
  key: string;
  text: string;
  celebrate: boolean; // jump, not just wave
  openMemos?: boolean; // clicking the bubble opens the memo panel
}

// What the pet says when Pulse's today state changes. The first snapshot after loading is only a
// baseline, so opening Obsidian on an already-active day stays quiet.
export function pulseReactions(
  previous: PulseToday | null,
  next: PulseToday,
  hour: number,
  memoNudgedOn: string | null,
): PulseReaction[] {
  const out: PulseReaction[] = [];
  if (previous && previous.date === next.date && !previous.active && next.active) {
    if (isStreakMilestone(next.streak)) {
      out.push({ key: "pulse-streak", text: `连续 ${next.streak} 天了`, celebrate: true });
    } else {
      out.push({
        key: "pulse-first",
        text: next.streak > 1 ? `今天开张了 · 连续 ${next.streak} 天` : "今天开张了",
        celebrate: false,
      });
    }
  }
  if (hour >= EVENING_HOUR && memoNudgedOn !== next.date && (next.memos?.pending ?? 0) > 0) {
    out.push({
      key: "pulse-memos",
      text: `今天还有 ${next.memos!.pending} 条速记没去处`,
      celebrate: false,
      openMemos: true,
    });
  }
  return out;
}

export function pulseStatus(today: PulseToday): string {
  const score = Math.round(today.score);
  return today.streak > 0 ? `今天 ${score} 分 · 连续 ${today.streak} 天` : `今天 ${score} 分`;
}

export function memoLine(today: PulseToday): string | undefined {
  if (!today.memos || today.memos.today === 0) return undefined;
  const { today: count, pending } = today.memos;
  return pending > 0 ? `今天 ${count} 条速记，${pending} 条还没去处` : `今天 ${count} 条速记，都有去处了`;
}
