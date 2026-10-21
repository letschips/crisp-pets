import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { BubbleGate } from "./bubble-gate";
import { FOCUS_EVENT, focusReaction, focusingFromSnapshot } from "./focus";
import { MAX_DROP_CHARS, PulseMemoApi, canCapture, memoRequest, normalizeDrop } from "./memo-drop";
import { PetMood } from "./mood";
import { PetOverlay } from "./overlay";
import { FocusSnapshot, focusSection, launcherSections } from "./panel-model";
import { PetEntry, listPets, loadSpritesheet, readCodexSelection, resolvePetsFolder } from "./pets";
import { PetSettingTab } from "./settings-tab";
import { PetSprite } from "./sprite";

export interface PetSettings {
  visible: boolean;
  petsFolder: string;
  followCodex: boolean; // show whichever local pet Codex has selected
  petId: string; // pet folder name, used when not following Codex or Codex has no local pet selected
  size: number; // percent of the 192x208 cell
  offset: { right: number; bottom: number };
}

const DEFAULT_SETTINGS: PetSettings = {
  visible: true,
  petsFolder: "",
  followCodex: true,
  petId: "",
  size: 50,
  offset: { right: 24, bottom: 40 },
};

const DRAG_THRESHOLD_PX = 4;
const FAILED_COOLDOWN_MS = 10000;
const PANEL_REFRESH_MS = 15000;
const DROP_HINT = "把文字拖到我身上，记成一条速记。";

export default class CrispPetsPlugin extends Plugin {
  options: PetSettings = { ...DEFAULT_SETTINGS };
  pets: PetEntry[] = [];
  codexSelection: string | null = null;
  shownPet: string | null = null;
  private el: HTMLElement | null = null; // fixed container: sprite + bubble + panel
  private spriteEl: HTMLElement | null = null;
  private sprite: PetSprite | null = null;
  private overlay: PetOverlay | null = null;
  private bubbles = new BubbleGate();
  private petName = "";
  private sheetUrl: string | null = null;
  private mood: PetMood | null = null;
  private doneTasks = new Map<string, number>();
  private lastFailed = -Infinity;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private mountToken = 0;

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<PetSettings> | null;
    this.options = { ...DEFAULT_SETTINGS, ...stored, offset: { ...DEFAULT_SETTINGS.offset, ...stored?.offset } };
    this.addSettingTab(new PetSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-pet",
      name: "Show or hide pet",
      callback: async () => {
        this.options.visible = !this.options.visible;
        await this.saveData(this.options);
        await this.mount();
      },
    });
    this.addCommand({ id: "reload-pets", name: "Reload pets from disk", callback: () => this.mount() });

    // editor-change also fires when a note loads or switches mode, so only count real input in an editor.
    this.registerDomEvent(document, "beforeinput", (event) => {
      if (event.target instanceof Element && event.target.closest(".cm-content")) {
        this.nudge((mood, now) => mood.typed(now));
      }
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncReading()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncReading()));
    this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => this.checkTasks(file, cache.listItems)));
    this.registerEvent(this.app.workspace.on(FOCUS_EVENT as "quit", (event: unknown) => this.onFocusEvent(event)));
    this.registerDomEvent(window, "error", () => this.onFailure());
    this.registerDomEvent(window, "unhandledrejection", () => this.onFailure());
    this.registerDomEvent(document, "pointermove", (event) => this.onPointer(event));
    this.registerDomEvent(window, "resize", () => this.applyPosition());
    // Codex may switch pets while Obsidian is in the background.
    this.registerDomEvent(window, "focus", () => void this.followCodexChange());
    this.registerDomEvent(document, "pointerdown", (event) => {
      if (this.overlay?.panelOpen && !this.overlay.contains(event.target)) this.overlay.closePanel();
    });
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape" && this.overlay?.panelOpen) this.overlay.closePanel();
    });
    this.registerInterval(window.setInterval(() => this.refreshPanel(), PANEL_REFRESH_MS));

    this.app.workspace.onLayoutReady(() => void this.mount());
  }

  onunload(): void {
    this.unmount();
  }

  async saveOptions(): Promise<void> {
    await this.saveData(this.options);
  }

  async mount(): Promise<void> {
    const token = ++this.mountToken;
    this.unmount();
    this.shownPet = null;
    await this.scanPets();
    if (token !== this.mountToken || !this.options.visible) return;
    const entry = this.chosenPet();
    if (!entry?.manifest) return;
    let sheet;
    try {
      sheet = await loadSpritesheet(entry.folder, entry.manifest);
    } catch (error) {
      new Notice(`Crisp Pets: ${entry.manifest.displayName} 无法加载（${error instanceof Error ? error.message : error}）`);
      return;
    }
    if (token !== this.mountToken) {
      URL.revokeObjectURL(sheet.url);
      return;
    }
    this.sheetUrl = sheet.url;
    this.shownPet = entry.name;
    this.petName = entry.manifest.displayName;
    this.mood = new PetMood(entry.manifest.spriteVersion === 2);
    this.el = document.body.createDiv({ cls: "crisp-pets" });
    this.spriteEl = this.el.createDiv({ cls: "crisp-pets-sprite", attr: { "aria-label": this.petName, role: "button" } });
    this.overlay = new PetOverlay(this.el, (id) => this.runCommand(id));
    this.sprite = new PetSprite(this.spriteEl, sheet, () => this.mood!.pose(Date.now()), () => this.reducedMotion.matches);
    this.sprite.setScale(this.options.size / 100);
    this.applyPosition();
    this.attachDrag(this.spriteEl);
    this.attachDrop(this.spriteEl);
    this.syncReading();
    this.mood.setFocusing(focusingFromSnapshot(this.focusSnapshot()));
    this.mood.trigger("waving", Date.now());
    this.sprite.start();
  }

  // Re-reads the pets folder and the Codex selection without touching the pet on screen.
  async scanPets(): Promise<void> {
    this.pets = await listPets(resolvePetsFolder(this.options.petsFolder));
    this.codexSelection = await readCodexSelection();
  }

  findPet(key: string | null): PetEntry | undefined {
    if (!key) return undefined;
    return this.pets.find((pet) => pet.manifest && (pet.name === key || pet.manifest.id === key));
  }

  chosenPet(): PetEntry | undefined {
    return (
      (this.options.followCodex ? this.findPet(this.codexSelection) : undefined) ??
      this.findPet(this.options.petId) ??
      this.pets.find((pet) => pet.manifest)
    );
  }

  private async followCodexChange(): Promise<void> {
    if (!this.options.followCodex || !this.options.visible) return;
    const selection = await readCodexSelection();
    if (selection === this.codexSelection) return;
    this.codexSelection = selection;
    if (this.chosenPet()?.name !== this.shownPet) await this.mount();
  }

  private unmount(): void {
    this.sprite?.stop();
    this.sprite = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.el?.remove();
    this.el = null;
    this.spriteEl = null;
    this.mood = null;
    if (this.sheetUrl) URL.revokeObjectURL(this.sheetUrl);
    this.sheetUrl = null;
  }

  setSize(size: number): void {
    this.options.size = size;
    this.sprite?.setScale(size / 100);
    this.applyPosition();
  }

  private nudge(change: (mood: PetMood, now: number) => void): void {
    if (!this.mood) return;
    change(this.mood, Date.now());
    this.sprite?.refresh();
  }

  private syncReading(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.nudge((mood) => mood.setReading(view?.getMode() === "preview"));
  }

  // Jumps when the active note gains a completed task. The first sighting of a file only sets a baseline,
  // so opening notes or sync updates elsewhere never trigger it.
  private checkTasks(file: TFile, items: { task?: string }[] | undefined): void {
    const done = (items ?? []).filter((item) => item.task !== undefined && item.task !== " ").length;
    const previous = this.doneTasks.get(file.path);
    this.doneTasks.set(file.path, done);
    if (previous !== undefined && done > previous && this.app.workspace.getActiveFile()?.path === file.path) {
      this.nudge((mood, now) => mood.trigger("jumping", now));
    }
  }

  private onFocusEvent(event: unknown): void {
    const reaction = focusReaction(event);
    if (reaction) {
      this.nudge((mood, now) => {
        mood.setFocusing(reaction.focusing);
        if (reaction.jump) mood.trigger("jumping", now);
      });
    }
    this.focusBubble(event);
    // Focus updates its own state after emitting, so read the snapshot a moment later.
    window.setTimeout(() => this.refreshPanel(), 0);
  }

  private focusBubble(event: unknown): void {
    if (typeof event !== "object" || event === null) return;
    const { type, kind, pomodoro, plannedMinutes, task } = event as {
      type?: string;
      kind?: string;
      pomodoro?: boolean;
      plannedMinutes?: number;
      task?: { title?: string } | null;
    };
    if (type !== "complete") return;
    if (kind === "focus") {
      const done = pomodoro ? "完成一个番茄" : `专注 ${plannedMinutes ?? 0} 分钟完成`;
      const title = task?.title?.trim();
      this.say("focus-complete", 0, title ? `${done} · ${title}` : done);
    } else if (kind === "break" && this.hasCommand("crisp-focus:start-pomodoro")) {
      this.say("break-complete", 0, "休息好了，开始下一个？", () => this.runCommand("crisp-focus:start-pomodoro"));
    }
  }

  // Ambient lines go through the gate; replies to something the user just did pass cooldown 0.
  private say(key: string, cooldownMs: number, text: string, onClick?: () => void): void {
    if (!this.overlay) return;
    const now = Date.now();
    if (cooldownMs > 0 && !this.bubbles.allow(key, cooldownMs, now)) return;
    this.bubbles.note(now);
    this.placeOverlay();
    this.overlay.say(text, onClick);
  }

  private hasCommand(id: string): boolean {
    // app.commands is not in the public typings.
    return !!(this.app as unknown as { commands: { findCommand(id: string): unknown } }).commands.findCommand(id);
  }

  private runCommand(id: string): void {
    (this.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(id);
  }

  private panelContent() {
    const has = (id: string) => this.hasCommand(id);
    const focus = focusSection(this.focusSnapshot() as FocusSnapshot | null, has);
    return {
      name: this.petName,
      sections: [...(focus ? [focus] : []), ...launcherSections(has)],
      hint: canCapture(this.pulseApi()) ? DROP_HINT : "装上 Crisp Pulse 后，可以把文字拖给我记成速记。",
    };
  }

  private togglePanel(): void {
    if (!this.overlay) return;
    if (this.overlay.panelOpen) {
      this.overlay.closePanel();
      return;
    }
    this.placeOverlay();
    this.overlay.openPanel(this.panelContent());
  }

  private refreshPanel(): void {
    if (this.overlay?.panelOpen) this.overlay.refreshPanel(this.panelContent());
  }

  private placeOverlay(): void {
    if (!this.el || !this.overlay) return;
    const rect = this.el.getBoundingClientRect();
    this.overlay.placeFor(rect.left + rect.width / 2, window.innerWidth);
  }

  private pulseApi(): PulseMemoApi | undefined {
    return this.pluginInstance("crisp-pulse") as PulseMemoApi | undefined;
  }

  private pluginInstance(id: string): unknown {
    // app.plugins is not in the public typings.
    return (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.[id];
  }

  private attachDrop(el: HTMLElement): void {
    const acceptsText = (event: DragEvent) => !!event.dataTransfer?.types.includes("text/plain");
    el.addEventListener("dragover", (event) => {
      if (!acceptsText(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      if (!el.hasClass("is-drop-target")) {
        el.addClass("is-drop-target");
        this.nudge((mood) => mood.setExpecting(true));
      }
    });
    const leave = () => {
      el.removeClass("is-drop-target");
      this.nudge((mood) => mood.setExpecting(false));
    };
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", (event) => {
      if (!acceptsText(event)) return;
      event.preventDefault();
      leave();
      void this.captureDrop(event.dataTransfer!.getData("text/plain"));
    });
  }

  // Dropped text goes to Pulse as a memo quoting it. When it matches the active editor's selection,
  // the memo also links back to that note.
  private async captureDrop(raw: string): Promise<void> {
    const pulse = this.pulseApi();
    if (!canCapture(pulse)) {
      this.say("drop", 0, "装上 Crisp Pulse 才能记速记");
      return;
    }
    // app.dragManager is not in the public typings; dragging a note from the file explorer also carries text.
    const draggable = (this.app as unknown as { dragManager?: { draggable?: { type?: string } | null } }).dragManager?.draggable;
    if (draggable && draggable.type !== "text") {
      this.say("drop", 0, "现在只收文字，笔记和文件还不行");
      return;
    }
    const text = normalizeDrop(raw);
    if (!text) return;
    if (text.length > MAX_DROP_CHARS) {
      this.say("drop", 0, `太长了，速记一次最多 ${MAX_DROP_CHARS} 字`);
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view?.getMode() === "source" ? normalizeDrop(view.editor.getSelection()) : "";
    const sourcePath = view?.file && selection === text ? view.file.path : null;
    try {
      const result = await pulse.captureMemoFromSource(memoRequest(text, sourcePath));
      const id = result.memo?.id;
      const reveal = id ? () => void pulse.revealMemo({ id }) : undefined;
      if (result.status === "created") {
        this.nudge((mood, now) => mood.trigger("jumping", now));
        this.say("drop", 0, "记下了，点我看看", reveal);
      } else {
        this.say("drop", 0, "这段之前记过了，点我看看", reveal);
      }
    } catch (error) {
      this.nudge((mood, now) => mood.trigger("failed", now));
      this.say("drop", 0, `没记上：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private focusSnapshot(): unknown {
    // app.plugins is not in the public typings.
    const focus = this.pluginInstance("crisp-focus") as { getPomodoroSnapshot?: () => unknown } | undefined;
    try {
      return focus?.getPomodoroSnapshot?.();
    } catch {
      return null;
    }
  }

  private onFailure(): void {
    const now = Date.now();
    if (now - this.lastFailed < FAILED_COOLDOWN_MS) return;
    this.lastFailed = now;
    this.nudge((mood) => mood.trigger("failed", now));
  }

  private onPointer(event: PointerEvent): void {
    if (!this.el) return;
    const rect = this.el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    this.nudge((mood, now) => mood.pointerAt(dx, dy, now));
  }

  private applyPosition(): void {
    if (!this.el) return;
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    const right = Math.min(Math.max(0, this.options.offset.right), Math.max(0, window.innerWidth - width));
    const bottom = Math.min(Math.max(0, this.options.offset.bottom), Math.max(0, window.innerHeight - height));
    this.el.style.right = `${right}px`;
    this.el.style.bottom = `${bottom}px`;
  }

  private attachDrag(el: HTMLElement): void {
    el.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      try {
        el.setPointerCapture(down.pointerId);
      } catch {
        // Synthetic or already released pointers cannot be captured; dragging still works without it.
      }
      const start = { ...this.options.offset };
      let moved = false;
      let lastX = down.clientX;
      const move = (event: PointerEvent) => {
        const dx = event.clientX - down.clientX;
        const dy = event.clientY - down.clientY;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        moved = true;
        el.addClass("is-dragging");
        this.options.offset = { right: start.right - dx, bottom: start.bottom - dy };
        this.applyPosition();
        const step = event.clientX - lastX;
        lastX = event.clientX;
        if (step !== 0) this.nudge((mood) => mood.drag(step > 0 ? "right" : "left"));
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeClass("is-dragging");
        this.nudge((mood) => mood.drag(null));
        if (moved) {
          this.placeOverlay();
          void this.saveOptions();
        } else {
          this.nudge((mood, now) => mood.trigger("waving", now));
          this.togglePanel();
        }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  }
}
