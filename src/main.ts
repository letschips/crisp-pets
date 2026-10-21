import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { BubbleGate } from "./bubble-gate";
import { FOCUS_EVENT, focusReaction, focusingFromSnapshot } from "./focus";
import { discoverVaultCrispLicenses, verifyLicenseCode } from "./license";
import { ActivationOutcome, LicenseController, LicenseResult } from "./license-controller";
import { DragSession, MAX_DROP_CHARS, PulseMemoApi, canCapture, memoRequest, normalizeDrop } from "./memo-drop";
import { displayedOffset } from "./layout";
import { PetMood } from "./mood";
import { PetOverlay } from "./overlay";
import { PULSE_STATE_EVENT, PulseStateApi, PulseToday, canReadToday, parseToday, pulseReactions } from "./pulse";
import { FocusSnapshot, PanelModel, focusCard, pulseTiles, shortcuts } from "./panel-model";
import { PetEntry, listPets, loadSpritesheet, readCodexSelection, resolvePetsFolder } from "./pets";
import { DEFAULT_SETTINGS, PetSettings, sanitizeSettings } from "./settings";
import { PetSettingTab } from "./settings-tab";
import { PetSprite } from "./sprite";

const DRAG_THRESHOLD_PX = 4;
const FAILED_COOLDOWN_MS = 10000;
const PANEL_REFRESH_MS = 1000; // the countdown ticks; only time and progress are patched
const PULSE_DEBOUNCE_MS = 800;
const PULSE_POLL_MS = 10 * 60000; // catches the evening without any Pulse event
const DAY_LINE_COOLDOWN_MS = 6 * 3600000;
const DROP_HINT = "把文字拖给我，记成一条速记";
const PLUGIN_ID = "crisp-pets";

export default class CrispPetsPlugin extends Plugin {
  options: PetSettings = { ...DEFAULT_SETTINGS };
  pets: PetEntry[] = [];
  codexSelection: string | null = null;
  // The Codex selection last brought to screen; undefined until the first check, so that one rescans.
  private followedSelection: string | null | undefined = undefined;
  shownPet: string | null = null;
  private el: HTMLElement | null = null; // fixed container: sprite + bubble + panel
  private spriteEl: HTMLElement | null = null;
  private sprite: PetSprite | null = null;
  private overlay: PetOverlay | null = null;
  private bubbles = new BubbleGate();
  private petName = "";
  private pulseToday: PulseToday | null = null;
  private pulseTimer: number | null = null;
  private pulseToken = 0;
  private dragSession = new DragSession();
  private disposed = false;
  private sheetUrl: string | null = null;
  private mood: PetMood | null = null;
  private doneTasks = new Map<string, number>();
  private lastFailed = -Infinity;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private mountToken = 0;
  private settingTab: PetSettingTab | null = null;
  // Free: the pet itself (look, typing, reading, dragging, task jumps). Licensed: the panel, dropping text
  // into Pulse memos, Focus and Pulse linkage and their bubbles.
  private readonly licenseController = new LicenseController({
    verify: (code, online) => this.checkLicense(code, online),
    discover: () => discoverVaultCrispLicenses(this.app, PLUGIN_ID),
    getCode: () => this.options.licenseCode,
    persistCode: async (code) => {
      this.options.licenseCode = code;
      return this.saveOptionsChecked();
    },
    onChange: () => this.onLicenseChange(),
  });

  get license(): LicenseResult {
    return this.licenseController.state;
  }

  // Also applies the expiry date at the moment of use.
  get licensed(): boolean {
    return this.licenseController.licensed;
  }

  async onload(): Promise<void> {
    this.options = sanitizeSettings(await this.loadData());
    // Startup stays local: only the embedded-key signature check; the online check runs once the layout is ready.
    await this.licenseController.loadLocal();
    this.registerInterval(window.setInterval(() => this.licenseController.checkExpiry(), 60_000));
    this.settingTab = new PetSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

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
    this.addCommand({ id: "open-panel", name: "Open pet panel", callback: () => this.togglePanel(true) });

    // editor-change also fires when a note loads or switches mode, so only count real input in an editor.
    this.registerDomEvent(document, "beforeinput", (event) => {
      if (event.target instanceof Element && event.target.closest(".cm-content")) {
        this.nudge((mood, now) => mood.typed(now));
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.syncReading();
        this.seedTasks();
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncReading()));
    this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => this.checkTasks(file, cache.listItems)));
    this.registerEvent(this.app.workspace.on(FOCUS_EVENT as "quit", (event: unknown) => this.onFocusEvent(event)));
    this.registerDomEvent(window, "error", () => this.onFailure());
    this.registerDomEvent(window, "unhandledrejection", () => this.onFailure());
    this.registerDomEvent(document, "pointermove", (event) => this.onPointer(event));
    this.registerDomEvent(window, "resize", () => {
      this.applyPosition();
      this.overlay?.reposition();
    });
    // No animation while the window is hidden; the pose is recomputed on return.
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) this.sprite?.stop();
      else this.sprite?.start();
    });
    // Codex may switch pets while Obsidian is in the background.
    this.registerDomEvent(window, "focus", () => void this.followCodexChange());
    this.registerDomEvent(document, "pointerdown", (event) => {
      if (this.overlay?.panelOpen && !this.overlay.contains(event.target)) this.overlay.closePanel();
    });
    // Remember the editor selection a drag starts from; see DragSession.
    this.registerDomEvent(document, "pointerdown", (event) => this.rememberSelection(event), { capture: true });
    this.registerDomEvent(document, "dragstart", (event) => this.dragSession.dragStart(inEditor(event.target), Date.now()), { capture: true });
    this.registerDomEvent(document, "dragend", () => this.dragSession.end());
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key !== "Escape" || !this.overlay?.panelOpen) return;
      const hadFocus = this.overlay.contains(document.activeElement);
      this.overlay.closePanel();
      if (hadFocus) this.spriteEl?.focus();
    });
    this.registerInterval(window.setInterval(() => this.refreshPanel(), PANEL_REFRESH_MS));
    this.registerEvent(this.app.workspace.on(PULSE_STATE_EVENT as "quit", () => this.schedulePulseRefresh()));
    this.registerInterval(window.setInterval(() => void this.refreshPulse(), PULSE_POLL_MS));

    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      this.seedTasks();
      void this.mount();
      void this.licenseController.refreshInBackground().catch((error) => {
        console.debug("Crisp Pets background license check failed", error);
      });
    });
  }

  onunload(): void {
    // Anything still loading (pets folder, spritesheet, Pulse) must not come back after this.
    this.disposed = true;
    this.licenseController.dispose();
    this.mountToken++;
    this.pulseToken++;
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    this.unmount();
  }

  async saveOptions(): Promise<void> {
    if (this.disposed) return;
    await this.saveData(this.options);
  }

  // The licence code must really be on disk: read it back instead of trusting saveData.
  private async saveOptionsChecked(): Promise<boolean> {
    try {
      await this.saveOptions();
      const stored = (await this.loadData()) as { licenseCode?: unknown } | null;
      return stored?.licenseCode === this.options.licenseCode;
    } catch {
      return false;
    }
  }

  activate(code: string): Promise<ActivationOutcome> {
    return this.licenseController.activate(code);
  }

  get licenseUnsaved(): boolean {
    return this.licenseController.unsaved;
  }

  retrySaveLicense(): Promise<boolean> {
    return this.licenseController.retrySave();
  }

  clearLicense(): Promise<boolean> {
    return this.licenseController.clear();
  }

  private async checkLicense(code: string, online: boolean): Promise<LicenseResult> {
    const result = await verifyLicenseCode(code, PLUGIN_ID, online ? undefined : { online: false });
    return { valid: result.valid, payload: result.payload, reason: result.reason };
  }

  private onLicenseChange(): void {
    if (this.disposed) return;
    if (!this.licensed) {
      this.overlay?.closePanel();
      this.pulseToday = null;
    }
    this.nudge((mood) => mood.setFocusing(this.licensed && focusingFromSnapshot(this.focusSnapshot())));
    void this.refreshPulse();
    this.settingTab?.display();
  }

  openSettings(): void {
    // app.setting is not in the public typings.
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(PLUGIN_ID);
  }

  // Unlicensed: the pet still waves, and says once where to activate.
  private lockedHint(text: string): void {
    this.say("locked", 0, text, () => this.openSettings());
  }

  // Loads the chosen pet first and swaps it in only when it is ready, so a broken spritesheet keeps the
  // current pet on screen. A newer mount or unloading the plugin discards a load still in flight.
  async mount(): Promise<void> {
    if (this.disposed) return;
    const token = ++this.mountToken;
    await this.scanPets();
    if (token !== this.mountToken || this.disposed) return;
    const entry = this.options.visible ? this.chosenPet() : undefined;
    if (!entry?.manifest) {
      this.unmount();
      this.shownPet = null;
      return;
    }
    let sheet;
    try {
      sheet = await loadSpritesheet(entry.folder, entry.manifest);
    } catch (error) {
      if (token !== this.mountToken || this.disposed) return;
      const kept = this.el ? "，先保留当前宠物" : "";
      new Notice(`Crisp Pets: ${entry.manifest.displayName} 无法加载${kept}（${error instanceof Error ? error.message : error}）`);
      return;
    }
    if (token !== this.mountToken || this.disposed) {
      URL.revokeObjectURL(sheet.url);
      return;
    }
    this.unmount();
    this.sheetUrl = sheet.url;
    this.shownPet = entry.name;
    this.petName = entry.manifest.displayName;
    this.mood = new PetMood(entry.manifest.spriteVersion === 2);
    this.el = document.body.createDiv({ cls: "crisp-pets" });
    this.spriteEl = this.el.createDiv({
      cls: "crisp-pets-sprite",
      attr: { "aria-label": this.petName, role: "button", tabindex: "0", "aria-haspopup": "dialog" },
    });
    this.overlay = new PetOverlay(this.el, (id) => this.runCommand(id));
    this.sprite = new PetSprite(this.spriteEl, sheet, () => this.mood!.pose(Date.now()), () => this.reducedMotion.matches);
    this.sprite.setScale(this.options.size / 100);
    this.applyPosition();
    this.attachDrag(this.spriteEl);
    this.attachDrop(this.spriteEl);
    this.spriteEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.nudge((mood, now) => mood.trigger("waving", now));
      this.togglePanel(true);
    });
    this.syncReading();
    this.mood.setFocusing(this.licensed && focusingFromSnapshot(this.focusSnapshot()));
    this.mood.trigger("waving", Date.now());
    this.sprite.start();
    void this.refreshPulse();
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
    if (selection === this.followedSelection) return;
    // A pet created in Codex after the last scan is not in the cached list yet, so rescan before choosing.
    await this.scanPets();
    if (this.chosenPet()?.name !== this.shownPet) await this.mount();
    // Only settled once the selection is on screen (or there is none); a pet still downloading is retried next time.
    if (!selection || this.findPet(selection)?.name === this.shownPet) this.followedSelection = selection;
  }

  // A note's existing completed tasks are its baseline, so the first new tick in it already counts.
  private seedTasks(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || this.doneTasks.has(file.path)) return;
    this.doneTasks.set(file.path, countDone(this.app.metadataCache.getFileCache(file)?.listItems));
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
    const done = countDone(items);
    const previous = this.doneTasks.get(file.path);
    this.doneTasks.set(file.path, done);
    if (previous !== undefined && done > previous && this.app.workspace.getActiveFile()?.path === file.path) {
      this.nudge((mood, now) => mood.trigger("jumping", now));
    }
  }

  private onFocusEvent(event: unknown): void {
    if (!this.licensed) return;
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
  // While the panel is open, ambient lines wait; a reply to the user's own action closes the panel to be seen.
  private say(key: string, cooldownMs: number, text: string, onClick?: () => void): boolean {
    if (!this.overlay) return false;
    if (this.overlay.panelOpen) {
      if (cooldownMs > 0) return false;
      this.overlay.closePanel();
    }
    const now = Date.now();
    if (cooldownMs > 0 && !this.bubbles.allow(key, cooldownMs, now)) return false;
    this.bubbles.note(now);
    this.overlay.say(text, onClick);
    return true;
  }

  private schedulePulseRefresh(): void {
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null;
      void this.refreshPulse();
    }, PULSE_DEBOUNCE_MS);
  }

  // Re-reads Pulse's today state, reacts to what changed, and updates the open panel.
  private async refreshPulse(): Promise<void> {
    const token = ++this.pulseToken;
    const pulse = this.pluginInstance("crisp-pulse") as PulseStateApi | undefined;
    let next: PulseToday | null = null;
    if (this.licensed && canReadToday(pulse)) {
      try {
        next = parseToday(await pulse.getTodaySnapshot());
      } catch {
        next = null;
      }
    }
    if (token !== this.pulseToken || this.disposed) return;
    const previous = this.pulseToday;
    this.pulseToday = next;
    this.refreshPanel();
    if (!next || !this.mood) return;
    for (const line of pulseReactions(previous, next, new Date().getHours(), this.options.memoNudgedOn || null)) {
      const onClick = line.openMemos ? () => this.runCommand("crisp-pulse:open-memo-view") : undefined;
      if (!this.say(line.key, DAY_LINE_COOLDOWN_MS, line.text, onClick)) continue;
      this.nudge((mood, now) => mood.trigger(line.celebrate ? "jumping" : "waving", now));
      if (line.openMemos) {
        this.options.memoNudgedOn = next.date;
        void this.saveOptions();
      }
    }
  }

  private hasCommand(id: string): boolean {
    // app.commands is not in the public typings.
    return !!(this.app as unknown as { commands: { findCommand(id: string): unknown } }).commands.findCommand(id);
  }

  private runCommand(id: string): void {
    (this.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(id);
  }

  private panelContent(): PanelModel {
    const has = (id: string) => this.hasCommand(id);
    return {
      name: this.petName,
      focus: focusCard(this.focusSnapshot() as FocusSnapshot | null, has),
      stats: pulseTiles(this.pulseToday, has),
      shortcuts: shortcuts(has),
      hint: canCapture(this.pulseApi()) ? DROP_HINT : "装上 Crisp Pulse，就能把文字拖给我记速记",
    };
  }

  // From the keyboard, focus moves into the panel; Escape brings it back to the pet.
  private togglePanel(fromKeyboard = false): void {
    if (!this.overlay) return;
    if (!this.licensed) {
      this.lockedHint("激活 Crisp 后，点我能打开面板");
      return;
    }
    if (this.overlay.panelOpen) {
      this.overlay.closePanel();
      if (fromKeyboard) this.spriteEl?.focus();
      return;
    }
    this.overlay.openPanel(this.panelContent(), fromKeyboard);
    void this.refreshPulse();
  }

  private refreshPanel(): void {
    if (this.overlay?.panelOpen) this.overlay.refreshPanel(this.panelContent());
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
    if (!this.licensed) {
      this.dragSession.end();
      this.lockedHint("激活 Crisp 后，可以把文字拖给我记速记");
      return;
    }
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
    const drop = this.dragSession.resolve(text, Date.now());
    if (drop.text.length > MAX_DROP_CHARS) {
      this.say("drop", 0, `太长了，速记一次最多 ${MAX_DROP_CHARS} 字`);
      return;
    }
    try {
      const result = await pulse.captureMemoFromSource(memoRequest(drop.text, drop.sourcePath));
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

  private rememberSelection(event: PointerEvent): void {
    this.dragSession.pressElsewhere();
    if (!inEditor(event.target)) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    // Only a press on the selected text itself can start dragging it. editor.cm is CodeMirror's EditorView,
    // not in the public typings.
    const cm = (view.editor as unknown as { cm?: { posAtCoords(p: { x: number; y: number }): number | null } }).cm;
    const pos = cm?.posAtCoords({ x: event.clientX, y: event.clientY });
    const from = view.editor.posToOffset(view.editor.getCursor("from"));
    const to = view.editor.posToOffset(view.editor.getCursor("to"));
    if (pos === null || pos === undefined || pos < from || pos > to || from === to) return;
    const text = normalizeDrop(view.editor.getSelection());
    if (text) this.dragSession.press({ text, path: view.file?.path ?? null }, Date.now());
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
    // v1 pets have no look directions, so there is nothing to measure for them.
    if (!this.el || !this.mood?.canLook) return;
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
      // Start from where the pet is shown: a position saved in a larger window may be clamped on screen.
      const start = displayedOffset(this.el!.getBoundingClientRect(), window.innerWidth, window.innerHeight);
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
          this.options.offset = displayedOffset(this.el!.getBoundingClientRect(), window.innerWidth, window.innerHeight);
          this.overlay?.reposition();
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

function countDone(items: { task?: string }[] | undefined): number {
  return (items ?? []).filter((item) => item.task !== undefined && item.task !== " ").length;
}

// dragstart and pointerdown can target a text node inside the editor.
function inEditor(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return !!element?.closest(".cm-content");
}
