// What the pet's panel shows, from the Crisp Focus snapshot, Pulse's today state and the commands that
// exist right now. Pure, so the wording and the button choice can be tested without Obsidian.
import { PulseToday } from "./pulse";

export interface FocusSnapshot {
  status?: string; // idle | running | paused
  remainingMs?: number;
  plannedMs?: number;
  kind?: string | null; // focus | break
  active?: boolean; // a pomodoro cycle is in progress
  waiting?: boolean; // between pomodoro rounds
  round?: number;
  todayCount?: number;
  goal?: number;
  entitled?: boolean;
  task?: { source?: string; id?: string; title?: string } | null;
}

export interface PanelAction {
  label: string;
  icon: string;
  command: string;
}

export interface FocusCard {
  tone: "focus" | "break" | "paused" | "idle";
  label: string;
  time?: string; // mm:ss left, only while a session exists
  progress?: number; // 0..1 elapsed
  task?: string;
  caption?: string;
  primary?: PanelAction; // the one obvious next step
  secondary: PanelAction[]; // icon-only
}

export interface StatTile {
  value: string;
  label: string;
  command?: string;
  attention?: boolean; // e.g. memos still waiting
}

export interface PanelModel {
  name: string;
  focus: FocusCard | null;
  stats: StatTile[];
  shortcuts: PanelAction[];
  hint: string;
}

export function clock(ms: number | undefined): string {
  const total = Math.max(0, Math.ceil((ms ?? 0) / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function progress(snapshot: FocusSnapshot): number | undefined {
  if (!snapshot.plannedMs || snapshot.remainingMs === undefined) return undefined;
  return Math.min(1, Math.max(0, 1 - snapshot.remainingMs / snapshot.plannedMs));
}

export function focusCard(snapshot: FocusSnapshot | null, has: (command: string) => boolean): FocusCard | null {
  if (!snapshot) return null;
  const action = (label: string, icon: string, command: string): PanelAction | undefined =>
    has(command) ? { label, icon, command } : undefined;
  const list = (...actions: (PanelAction | undefined)[]) => actions.filter((a): a is PanelAction => !!a);
  const task = snapshot.task?.title?.trim() || undefined;
  const today = `今天 ${snapshot.todayCount ?? 0}${snapshot.goal ? ` / ${snapshot.goal}` : ""} 个番茄`;
  const isBreak = snapshot.kind === "break";

  if (snapshot.status === "running" || snapshot.status === "paused") {
    const paused = snapshot.status === "paused";
    return {
      tone: paused ? "paused" : isBreak ? "break" : "focus",
      label: paused ? "已暂停" : isBreak ? "休息中" : "专注中",
      time: clock(snapshot.remainingMs),
      progress: progress(snapshot),
      task: isBreak ? undefined : task,
      caption: isBreak ? today : undefined,
      primary: isBreak && !paused ? action("跳过休息", "skip-forward", "crisp-focus:skip-pomodoro-break") : undefined,
      secondary:
        isBreak && !paused
          ? []
          : list(
              paused
                ? action("继续", "play", "crisp-focus:pause-resume-focus-session")
                : action("暂停", "pause", "crisp-focus:pause-resume-focus-session"),
              action("结束", "square", "crisp-focus:stop-focus-session"),
            ),
    };
  }
  if (snapshot.waiting) {
    return {
      tone: "idle",
      label: `第 ${snapshot.round ?? 1} 个番茄`,
      caption: today,
      primary: action("开始下一个", "play", "crisp-focus:start-pomodoro"),
      secondary: [],
    };
  }
  return {
    tone: "idle",
    label: "专注",
    caption: today,
    // Pomodoro needs a Focus licence; a single 25-minute session is free.
    primary: snapshot.entitled
      ? action("开始番茄", "play", "crisp-focus:start-pomodoro")
      : action("专注 25 分钟", "play", "crisp-focus:start-focus-session-25"),
    secondary: [],
  };
}

export function pulseTiles(today: PulseToday | null, has: (command: string) => boolean): StatTile[] {
  if (!today) return [];
  const open = (command: string) => (has(command) ? command : undefined);
  const pending = today.memos?.pending;
  return [
    { value: String(Math.round(today.score)), label: "今日贡献", command: open("crisp-pulse:open-crisp-pulse-view") },
    { value: String(today.streak), label: "连续天数", command: open("crisp-pulse:open-crisp-pulse-view") },
    {
      value: pending === undefined ? "—" : String(pending),
      label: "待处理速记",
      command: open("crisp-pulse:open-memo-view"),
      attention: (pending ?? 0) > 0,
    },
  ];
}

export function shortcuts(has: (command: string) => boolean): PanelAction[] {
  return [
    { label: "记速记", icon: "pencil-line", command: "crisp-pulse:quick-memo" },
    { label: "看板", icon: "activity", command: "crisp-pulse:open-crisp-pulse-view" },
    { label: "任务", icon: "list-checks", command: "crisp-tempo:open-tempo-view" },
    { label: "新建任务", icon: "plus", command: "crisp-tempo:quick-add-task" },
  ].filter((action) => has(action.command));
}
