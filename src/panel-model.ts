// What the pet's panel shows, from the Crisp Focus snapshot and the commands that exist right now.
// Pure, so the wording and the button choice can be tested without Obsidian.

export interface FocusSnapshot {
  status?: string; // idle | running | paused
  remainingMs?: number;
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

export interface PanelSection {
  title: string;
  status?: string;
  task?: string;
  actions: PanelAction[];
}

function minutesLeft(ms: number | undefined): string {
  return `还剩 ${Math.max(1, Math.ceil((ms ?? 0) / 60000))} 分钟`;
}

export function focusSection(snapshot: FocusSnapshot | null, has: (command: string) => boolean): PanelSection | null {
  if (!snapshot) return null;
  const actions: PanelAction[] = [];
  const add = (label: string, icon: string, command: string) => {
    if (has(command)) actions.push({ label, icon, command });
  };
  let status: string;
  const isBreak = snapshot.kind === "break";
  if (snapshot.status === "running") {
    status = `${isBreak ? "休息中" : "专注中"} · ${minutesLeft(snapshot.remainingMs)}`;
    if (isBreak) {
      add("跳过休息", "skip-forward", "crisp-focus:skip-pomodoro-break");
    } else {
      add("暂停", "pause", "crisp-focus:pause-resume-focus-session");
      add("结束", "square", "crisp-focus:stop-focus-session");
    }
  } else if (snapshot.status === "paused") {
    status = `已暂停 · ${minutesLeft(snapshot.remainingMs)}`;
    add("继续", "play", "crisp-focus:pause-resume-focus-session");
    add("结束", "square", "crisp-focus:stop-focus-session");
  } else if (snapshot.waiting) {
    status = `第 ${snapshot.round ?? 1} 个番茄待开始`;
    add("开始下一个", "play", "crisp-focus:start-pomodoro");
  } else {
    const goal = snapshot.goal ? ` · 目标 ${snapshot.goal}` : "";
    status = `今天 ${snapshot.todayCount ?? 0} 个番茄${goal}`;
    // Pomodoro needs a Focus licence; a single 25-minute session is free.
    if (snapshot.entitled) add("开始番茄", "timer", "crisp-focus:start-pomodoro");
    else add("专注 25 分钟", "timer", "crisp-focus:start-focus-session-25");
  }
  const title = snapshot.task?.title?.trim();
  return { title: "专注", status, task: title || undefined, actions };
}

export function launcherSections(has: (command: string) => boolean): PanelSection[] {
  const sections: PanelSection[] = [];
  const pick = (title: string, candidates: PanelAction[]) => {
    const actions = candidates.filter((action) => has(action.command));
    if (actions.length) sections.push({ title, actions });
  };
  pick("Pulse", [
    { label: "记速记", icon: "pencil-line", command: "crisp-pulse:quick-memo" },
    { label: "看速记", icon: "notebook-pen", command: "crisp-pulse:open-memo-view" },
    { label: "看板", icon: "activity", command: "crisp-pulse:open-crisp-pulse-view" },
  ]);
  pick("Tempo", [
    { label: "任务", icon: "list-checks", command: "crisp-tempo:open-tempo-view" },
    { label: "新建任务", icon: "plus", command: "crisp-tempo:quick-add-task" },
  ]);
  return sections;
}
