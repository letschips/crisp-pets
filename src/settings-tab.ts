import { App, PluginSettingTab, Setting } from "obsidian";
import type CrispPetsPlugin from "./main";
import { homedir } from "node:os";
import { PetEntry, defaultPetsFolder, loadSpritesheet, resolvePetsFolder } from "./pets";
import { PetSprite } from "./sprite";

const THUMB_SCALE = 0.5;
const AUTHOR_URL = "https://xhslink.cn/m/3MwtKu4822b";

function tildify(path: string): string {
  const home = homedir();
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

export class PetSettingTab extends PluginSettingTab {
  private previews: { sprite: PetSprite; url: string }[] = [];
  private renderToken = 0;

  constructor(app: App, private readonly plugin: CrispPetsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const token = ++this.renderToken;
    this.clearPreviews();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("crisp-pets-settings");
    void this.plugin.scanPets().then(() => {
      if (token === this.renderToken) this.render(token);
    });
  }

  hide(): void {
    this.renderToken++;
    this.clearPreviews();
  }

  private render(token: number): void {
    const { containerEl } = this;
    const plugin = this.plugin;
    containerEl.empty();

    new Setting(containerEl).setName("显示宠物").addToggle((toggle) =>
      toggle.setValue(plugin.options.visible).onChange(async (value) => {
        plugin.options.visible = value;
        await plugin.saveOptions();
        await plugin.mount();
      }),
    );

    const codexPet = plugin.findPet(plugin.codexSelection);
    new Setting(containerEl)
      .setName("跟随 Codex")
      .setDesc(
        codexPet
          ? `Codex 当前是 ${codexPet.manifest!.displayName}。打开后跟着 Codex 换，切回 Obsidian 时同步。`
          : "Codex 当前没有选本地宠物（可能是内置宠物），先用下面选中的。",
      )
      .addToggle((toggle) =>
        toggle.setValue(plugin.options.followCodex).onChange(async (value) => {
          plugin.options.followCodex = value;
          await this.applyChoice();
        }),
      );

    containerEl.createEl("div", { cls: "setting-item-name crisp-pets-heading", text: "宠物形象" });
    const grid = containerEl.createDiv({ cls: "crisp-pets-grid" });
    const chosen = plugin.chosenPet();
    if (!plugin.pets.length) {
      grid.createDiv({
        cls: "crisp-pets-empty",
        text: `没有在 ${tildify(resolvePetsFolder(plugin.options.petsFolder))} 找到宠物。可以用 Codex 的 hatch-pet 生成，或在下面换个目录。`,
      });
    }
    for (const pet of plugin.pets) this.renderCard(grid, pet, pet === chosen, pet === codexPet, token);

    new Setting(containerEl).setName("大小").addSlider((slider) =>
      slider
        .setLimits(25, 100, 5)
        .setDynamicTooltip()
        .setValue(plugin.options.size)
        .onChange(async (value) => {
          plugin.setSize(value);
          await plugin.saveOptions();
        }),
    );

    new Setting(containerEl)
      .setName("宠物目录")
      .setDesc("留空就用 Codex 的宠物目录。")
      .addText((text) =>
        text
          .setPlaceholder(tildify(defaultPetsFolder()))
          .setValue(plugin.options.petsFolder)
          .onChange(async (value) => {
            plugin.options.petsFolder = value;
            await plugin.saveOptions();
          }),
      )
      .addExtraButton((button) =>
        button
          .setIcon("folder-open")
          .setTooltip("在访达中打开")
          .onClick(() => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { shell } = require("electron") as { shell: { openPath(path: string): Promise<string> } };
            void shell.openPath(resolvePetsFolder(plugin.options.petsFolder));
          }),
      )
      .addButton((button) =>
        button.setButtonText("重新读取").onClick(async () => {
          await plugin.mount();
          this.display();
        }),
      );

    this.renderAbout(containerEl);
  }

  private renderAbout(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "crisp-pets-about" });
    card.createDiv({ cls: "crisp-pets-about__title", text: `关于 Crisp Pets ${this.plugin.manifest.version}` });
    card.createDiv({
      cls: "crisp-pets-about__description",
      text: "把 Codex 的宠物带进 Obsidian，跟着你打字、阅读、专注和完成任务做出反应。",
    });
    const byline = card.createEl("p", { cls: "crisp-pets-about__author" });
    byline.createSpan({ text: "作者：" });
    const link = byline.createEl("a", { cls: "crisp-pets-about__author-link", text: "小红书 letschips", href: AUTHOR_URL });
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  private renderCard(grid: HTMLElement, pet: PetEntry, selected: boolean, isCodex: boolean, token: number): void {
    const card = grid.createEl("button", { cls: "crisp-pets-card" });
    card.toggleClass("is-selected", selected);
    const thumb = card.createDiv({ cls: "crisp-pets-thumb" });
    const info = card.createDiv({ cls: "crisp-pets-info" });
    const title = info.createDiv({ cls: "crisp-pets-name", text: pet.manifest?.displayName ?? pet.name });
    if (isCodex) title.createSpan({ cls: "crisp-pets-tag", text: "Codex" });

    if (!pet.manifest) {
      card.disabled = true;
      info.createDiv({ cls: "crisp-pets-error", text: pet.error ?? "无法读取" });
      return;
    }
    const manifest = pet.manifest;
    if (manifest.description) info.createDiv({ cls: "crisp-pets-desc", text: manifest.description });
    info.createDiv({ cls: "crisp-pets-meta", text: manifest.spriteVersion === 2 ? "v2 · 会看向鼠标" : "v1" });
    card.setAttr("aria-pressed", String(selected));

    card.addEventListener("click", async () => {
      // Picking a different pet than Codex's means the user wants their own choice.
      if (this.plugin.options.followCodex && this.plugin.codexSelection !== pet.name) {
        this.plugin.options.followCodex = false;
      }
      this.plugin.options.petId = pet.name;
      await this.applyChoice();
    });

    void loadSpritesheet(pet.folder, manifest).then(
      (sheet) => {
        if (token !== this.renderToken) {
          URL.revokeObjectURL(sheet.url);
          return;
        }
        // Still on the first idle frame; plays the idle loop while hovered.
        const sprite = new PetSprite(thumb, sheet, () => ({ kind: "animation", state: "idle" }), () => false);
        sprite.setScale(THUMB_SCALE);
        card.addEventListener("mouseenter", () => sprite.start());
        card.addEventListener("mouseleave", () => {
          sprite.stop();
          sprite.reset();
        });
        this.previews.push({ sprite, url: sheet.url });
      },
      (error) => {
        if (token !== this.renderToken) return;
        card.disabled = true;
        info.createDiv({ cls: "crisp-pets-error", text: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  private async applyChoice(): Promise<void> {
    await this.plugin.saveOptions();
    await this.plugin.mount();
    this.display();
  }

  private clearPreviews(): void {
    for (const { sprite, url } of this.previews) {
      sprite.stop();
      URL.revokeObjectURL(url);
    }
    this.previews = [];
  }
}
