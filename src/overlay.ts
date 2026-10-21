// The bubble and the panel that sit above the pet. Both are children of the fixed pet container,
// so they move with it; they open toward the middle of the window.
import { setIcon } from "obsidian";
import { bubbleDuration } from "./bubble-gate";
import { PanelSection } from "./panel-model";

export interface PanelContent {
  name: string;
  sections: PanelSection[];
  hint: string;
}

export class PetOverlay {
  private bubbleEl: HTMLElement;
  private panelEl: HTMLElement;
  private bubbleTimer: number | null = null;

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

  openPanel(content: PanelContent): void {
    this.hideBubble();
    this.renderPanel(content);
    this.panelEl.show();
  }

  // Re-renders in place while open (the focus countdown changes every minute).
  refreshPanel(content: PanelContent): void {
    if (this.panelOpen) this.renderPanel(content);
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

  private renderPanel(content: PanelContent): void {
    const panel = this.panelEl;
    panel.empty();
    panel.createDiv({ cls: "crisp-pets-panel__name", text: content.name });
    for (const section of content.sections) {
      const block = panel.createDiv({ cls: "crisp-pets-panel__section" });
      const head = block.createDiv({ cls: "crisp-pets-panel__head" });
      head.createSpan({ cls: "crisp-pets-panel__title", text: section.title });
      if (section.status) head.createSpan({ cls: "crisp-pets-panel__status", text: section.status });
      if (section.task) block.createDiv({ cls: "crisp-pets-panel__task", text: section.task });
      if (section.note) block.createDiv({ cls: "crisp-pets-panel__note", text: section.note });
      if (!section.actions.length) continue;
      const row = block.createDiv({ cls: "crisp-pets-panel__actions" });
      for (const action of section.actions) {
        const button = row.createEl("button", { cls: "crisp-pets-panel__button" });
        setIcon(button.createSpan({ cls: "crisp-pets-panel__icon" }), action.icon);
        button.createSpan({ text: action.label });
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.closePanel();
          this.runCommand(action.command);
        });
      }
    }
    panel.createDiv({ cls: "crisp-pets-panel__hint", text: content.hint });
  }
}
