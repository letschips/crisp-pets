// The bubble and the panel that sit above the pet. Both are children of the fixed pet container,
// so they move with it; they open toward the middle of the window.
import { setIcon } from "obsidian";
import { bubbleDuration } from "./bubble-gate";
import { FocusCard, PanelAction, PanelModel } from "./panel-model";

export class PetOverlay {
  private bubbleEl: HTMLElement;
  private panelEl: HTMLElement;
  private bubbleTimer: number | null = null;
  private panelKey = "";
  private liveTime: HTMLElement | null = null;
  private liveBar: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly runCommand: (id: string) => void,
  ) {
    this.bubbleEl = root.createDiv({ cls: "crisp-pets-bubble", attr: { role: "status", "aria-live": "polite" } });
    this.panelEl = root.createDiv({ cls: "crisp-pets-panel", attr: { role: "dialog" } });
    this.bubbleEl.hide();
    this.panelEl.hide();
  }

  // Which side the pet sits on decides where the bubble and panel open.
  placeFor(centerX: number, viewportWidth: number): void {
    this.root.toggleClass("is-left", centerX < viewportWidth / 2);
  }

  say(text: string, onClick?: () => void): void {
    if (this.panelOpen) return;
    this.bubbleEl.empty();
    this.bubbleEl.setText(text);
    this.bubbleEl.toggleClass("is-clickable", !!onClick);
    this.bubbleEl.onclick = onClick
      ? (event) => {
          event.stopPropagation();
          this.hideBubble();
          onClick();
        }
      : null;
    this.bubbleEl.show();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hideBubble(), bubbleDuration(text));
  }

  hideBubble(): void {
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = null;
    this.bubbleEl.hide();
  }

  get panelOpen(): boolean {
    return this.panelEl.isShown();
  }

  openPanel(model: PanelModel): void {
    this.hideBubble();
    this.panelKey = "";
    this.renderPanel(model);
    this.panelEl.show();
  }

  // While open: the countdown and progress bar are patched in place; anything else re-renders,
  // so hover and focus on the buttons survive the once-a-second tick.
  refreshPanel(model: PanelModel): void {
    if (!this.panelOpen) return;
    if (structureKey(model) !== this.panelKey) {
      this.renderPanel(model);
      return;
    }
    if (this.liveTime && model.focus?.time) this.liveTime.setText(model.focus.time);
    if (this.liveBar && model.focus?.progress !== undefined) this.liveBar.style.width = `${model.focus.progress * 100}%`;
  }

  closePanel(): void {
    this.panelEl.hide();
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  destroy(): void {
    this.hideBubble();
  }

  private renderPanel(model: PanelModel): void {
    const panel = this.panelEl;
    panel.empty();
    this.panelKey = structureKey(model);
    this.liveTime = null;
    this.liveBar = null;

    panel.createDiv({ cls: "crisp-pets-panel__name", text: model.name });
    if (model.focus) this.renderFocus(panel, model.focus);

    if (model.stats.length) {
      const stats = panel.createDiv({ cls: "crisp-pets-stats" });
      for (const stat of model.stats) {
        const tile = stats.createEl(stat.command ? "button" : "div", { cls: "crisp-pets-stat" });
        tile.toggleClass("is-attention", !!stat.attention);
        tile.createDiv({ cls: "crisp-pets-stat__value", text: stat.value });
        tile.createDiv({ cls: "crisp-pets-stat__label", text: stat.label });
        if (stat.command) this.bindCommand(tile, stat.command);
      }
    }

    if (model.shortcuts.length) {
      const row = panel.createDiv({ cls: "crisp-pets-shortcuts" });
      for (const action of model.shortcuts) {
        const button = row.createEl("button", { cls: "crisp-pets-shortcut" });
        setIcon(button.createSpan({ cls: "crisp-pets-shortcut__icon" }), action.icon);
        button.createSpan({ cls: "crisp-pets-shortcut__label", text: action.label });
        this.bindCommand(button, action.command);
      }
    }

    const hint = panel.createDiv({ cls: "crisp-pets-panel__hint" });
    setIcon(hint.createSpan({ cls: "crisp-pets-panel__hint-icon" }), "hand");
    hint.createSpan({ text: model.hint });
  }

  private renderFocus(panel: HTMLElement, focus: FocusCard): void {
    const card = panel.createDiv({ cls: `crisp-pets-focus is-${focus.tone}` });
    const top = card.createDiv({ cls: "crisp-pets-focus__top" });
    const heading = top.createDiv({ cls: "crisp-pets-focus__heading" });
    heading.createSpan({ cls: "crisp-pets-focus__dot" });
    heading.createSpan({ cls: "crisp-pets-focus__label", text: focus.label });
    if (focus.secondary.length) {
      const controls = top.createDiv({ cls: "crisp-pets-focus__controls" });
      for (const action of focus.secondary) {
        const button = controls.createEl("button", {
          cls: "crisp-pets-icon-button",
          attr: { "aria-label": action.label, "data-tooltip-position": "top" },
        });
        setIcon(button, action.icon);
        this.bindCommand(button, action.command);
      }
    }
    if (focus.time) this.liveTime = card.createDiv({ cls: "crisp-pets-focus__time", text: focus.time });
    if (focus.progress !== undefined) {
      const track = card.createDiv({ cls: "crisp-pets-focus__track" });
      this.liveBar = track.createDiv({ cls: "crisp-pets-focus__bar" });
      this.liveBar.style.width = `${focus.progress * 100}%`;
    }
    if (focus.task) card.createDiv({ cls: "crisp-pets-focus__task", text: focus.task });
    if (focus.caption || focus.primary) {
      const foot = card.createDiv({ cls: "crisp-pets-focus__foot" });
      foot.createSpan({ cls: "crisp-pets-focus__caption", text: focus.caption ?? "" });
      if (focus.primary) this.renderPrimary(foot, focus.primary);
    }
  }

  private renderPrimary(parent: HTMLElement, action: PanelAction): void {
    const button = parent.createEl("button", { cls: "crisp-pets-primary" });
    setIcon(button.createSpan({ cls: "crisp-pets-primary__icon" }), action.icon);
    button.createSpan({ text: action.label });
    this.bindCommand(button, action.command);
  }

  private bindCommand(el: HTMLElement, command: string): void {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closePanel();
      this.runCommand(command);
    });
  }
}

// Everything that changes the panel's layout; the ticking time and progress are left out.
function structureKey(model: PanelModel): string {
  const { focus, ...rest } = model;
  return JSON.stringify({ ...rest, focus: focus && { ...focus, time: !!focus.time, progress: focus.progress !== undefined } });
}
