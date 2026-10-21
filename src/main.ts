import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { FOCUS_EVENT, focusReaction, focusingFromSnapshot } from "./focus";
import { PetMood } from "./mood";
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

export default class CrispPetsPlugin extends Plugin {
  options: PetSettings = { ...DEFAULT_SETTINGS };
  pets: PetEntry[] = [];
  codexSelection: string | null = null;
  shownPet: string | null = null;
  private el: HTMLElement | null = null;
  private sprite: PetSprite | null = null;
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
    this.mood = new PetMood(entry.manifest.spriteVersion === 2);
    this.el = document.body.createDiv({ cls: "crisp-pets", attr: { "aria-label": entry.manifest.displayName } });
    this.sprite = new PetSprite(this.el, sheet, () => this.mood!.pose(Date.now()), () => this.reducedMotion.matches);
    this.sprite.setScale(this.options.size / 100);
    this.applyPosition();
    this.attachDrag(this.el);
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
    this.el?.remove();
    this.el = null;
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
    if (!reaction) return;
    this.nudge((mood, now) => {
      mood.setFocusing(reaction.focusing);
      if (reaction.jump) mood.trigger("jumping", now);
    });
  }

  private focusSnapshot(): unknown {
    // app.plugins is not in the public typings.
    const focus = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.["crisp-focus"] as
      | { getPomodoroSnapshot?: () => unknown }
      | undefined;
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
      el.setPointerCapture(down.pointerId);
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
          void this.saveOptions();
        } else {
          this.nudge((mood, now) => mood.trigger("waving", now));
        }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  }
}
