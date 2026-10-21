import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type CrispPetsPlugin from "./main";
import { homedir } from "node:os";
import { PetEntry, defaultPetsFolder, loadSpritesheet, loadThumbnail, resolvePetsFolder } from "./pets";
import { matchesQuery, orderPets, pickerLayout } from "./picker";
import { PetSprite } from "./sprite";

const THUMB_SCALE = 0.5;
const COMPACT_THUMB_PX = 64;
const AUTHOR_URL = "https://xhslink.cn/m/3MwtKu4822b";

function tildify(path: string): string {
  const home = homedir();
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

export class PetSettingTab extends PluginSettingTab {
  private previews: { sprite: PetSprite; url: string }[] = [];
  private observer: IntersectionObserver | null = null;
  private renderToken = 0;
  private licenseDraft = "";
  private checking = false;

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

    this.renderLicense(containerEl);
    new Setting(containerEl).setName("宠物").setHeading();
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

    const layout = pickerLayout(plugin.pets.length);
    const heading = containerEl.createDiv({ cls: "crisp-pets-heading" });
    heading.createSpan({ cls: "setting-item-name", text: "宠物形象" });
    if (plugin.pets.length > 1) heading.createSpan({ cls: "crisp-pets-count", text: `${plugin.pets.length} 只` });
    const search = layout.search
      ? heading.createEl("input", { cls: "crisp-pets-search", attr: { type: "search", placeholder: "搜索宠物", "aria-label": "搜索宠物" } })
      : null;
    const grid = containerEl.createDiv({ cls: "crisp-pets-grid" });
    grid.toggleClass("is-compact", layout.compact);
    const chosen = plugin.chosenPet();
    if (!plugin.pets.length) {
      grid.createDiv({
        cls: "crisp-pets-empty",
        text: `没有在 ${tildify(resolvePetsFolder(plugin.options.petsFolder))} 找到宠物。可以用 Codex 的 hatch-pet 生成，或在下面换个目录。`,
      });
    }
    // Thumbnails load as cards scroll into view; a compact grid scrolls inside itself.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          (entry.target as HTMLElement & { loadThumb?: () => void }).loadThumb?.();
        }
      },
      { root: layout.compact ? grid : null, rootMargin: "120px" },
    );
    const cards: { card: HTMLElement; fields: (string | undefined)[] }[] = [];
    for (const pet of orderPets(plugin.pets, chosen, layout.compact)) {
      const card = this.renderCard(grid, pet, pet === chosen, pet === codexPet, token, layout.compact);
      cards.push({ card, fields: [pet.manifest?.displayName, pet.name] });
    }
    if (search) {
      const none = grid.createDiv({ cls: "crisp-pets-empty", text: "没有匹配的宠物" });
      none.hide();
      search.addEventListener("input", () => {
        let shown = 0;
        for (const { card, fields } of cards) {
          const match = matchesQuery(fields, search.value);
          card.toggle(match);
          if (match) shown++;
        }
        none.toggle(shown === 0);
      });
    }

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

  private renderLicense(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("软件授权与激活").setHeading();
    const plugin = this.plugin;
    const license = plugin.license;
    const status = new Setting(containerEl).setName("激活状态");
    if (plugin.licensed) {
      const payload = license.payload;
      const user = payload?.userName || "Crisp 用户";
      const expiry = payload?.expiresAt ? `到期时间：${String(payload.expiresAt).split("T")[0]}` : "永久授权";
      status.setDesc(`已激活（授权用户：${user} · ${expiry}）`);
      status.addButton((button) =>
        button
          .setButtonText("清除授权")
          .setWarning()
          .onClick(async () => {
            const saved = await plugin.clearLicense();
            this.licenseDraft = "";
            new Notice(
              saved ? "已清除授权信息" : "本次运行已清除授权，但没能写入设置文件：重启后授权会恢复。",
              saved ? undefined : 0,
            );
            this.display();
          }),
      );
      return;
    }
    status.setDesc(
      license.reason
        ? `未激活：${license.reason}`
        : "未激活。宠物显示、选宠物和基础动作可以直接使用；点宠物打开面板、拖文字记速记、Focus 与 Pulse 联动需要激活。",
    );
    new Setting(containerEl)
      .setName("授权码")
      .setDesc("支持 Crisp Suite 全家桶或单款授权码。启动时会自动继承库内其他 Crisp 插件的授权。")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("粘贴 Crisp 授权码…")
          .setValue(this.licenseDraft)
          .onChange((value) => {
            this.licenseDraft = value.trim();
          });
      })
      .addButton((button) =>
        button
          .setButtonText(this.checking ? "验证中…" : "激活")
          .setCta()
          .setDisabled(this.checking)
          .onClick(async () => {
            const code = this.licenseDraft || plugin.options.licenseCode;
            if (!code) {
              new Notice("请先输入授权码");
              return;
            }
            this.checking = true;
            this.display();
            try {
              const { result, applied, saved } = await plugin.activate(code);
              if (!applied) return;
              if (!result.valid) {
                new Notice(`激活未通过：${result.reason || "未知原因"}`);
                return;
              }
              this.licenseDraft = "";
              new Notice(
                saved
                  ? `Crisp Pets 激活成功，欢迎使用，${result.payload?.userName || "Crisp 用户"}`
                  : "授权验证通过，但没能写入设置文件：本次可以使用，重启后需要重新激活。",
                saved ? 4000 : 0,
              );
            } finally {
              this.checking = false;
              this.display();
            }
          }),
      );
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

  private renderCard(
    grid: HTMLElement,
    pet: PetEntry,
    selected: boolean,
    isCodex: boolean,
    token: number,
    compact: boolean,
  ): HTMLElement {
    const card = grid.createEl("button", { cls: "crisp-pets-card" });
    card.toggleClass("is-selected", selected);
    const thumb = card.createDiv({ cls: "crisp-pets-thumb" });
    const info = card.createDiv({ cls: "crisp-pets-info" });
    const title = info.createDiv({ cls: "crisp-pets-name", text: pet.manifest?.displayName ?? pet.name });
    if (isCodex) title.createSpan({ cls: "crisp-pets-tag", text: "Codex" });

    if (!pet.manifest) {
      card.disabled = true;
      card.setAttr("aria-label", `${pet.name}\n${pet.error ?? "无法读取"}`);
      info.createDiv({ cls: "crisp-pets-error", text: pet.error ?? "无法读取" });
      return card;
    }
    const manifest = pet.manifest;
    const meta = manifest.spriteVersion === 2 ? "v2 · 会看向鼠标" : "v1";
    if (compact) {
      // Description and version move into the tooltip.
      card.setAttr("aria-label", [manifest.displayName, manifest.description, meta].filter(Boolean).join("\n"));
    } else {
      if (manifest.description) info.createDiv({ cls: "crisp-pets-desc", text: manifest.description });
      info.createDiv({ cls: "crisp-pets-meta", text: meta });
    }
    card.setAttr("aria-pressed", String(selected));

    card.addEventListener("click", async () => {
      // Picking a different pet than Codex's means the user wants their own choice.
      if (this.plugin.options.followCodex && this.plugin.codexSelection !== pet.name) {
        this.plugin.options.followCodex = false;
      }
      this.plugin.options.petId = pet.name;
      await this.applyChoice();
    });

    const fail = (error: unknown) => {
      if (token !== this.renderToken) return;
      const message = error instanceof Error ? error.message : String(error);
      card.disabled = true;
      card.setAttr("aria-label", `${manifest.displayName}\n${message}`);
      info.createDiv({ cls: "crisp-pets-error", text: message });
    };
    (card as HTMLElement & { loadThumb?: () => void }).loadThumb = compact
      ? () =>
          void loadThumbnail(pet.folder, manifest, COMPACT_THUMB_PX).then((canvas) => {
            if (token === this.renderToken) thumb.appendChild(canvas);
          }, fail)
      : () =>
          void loadSpritesheet(pet.folder, manifest).then((sheet) => {
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
          }, fail);
    this.observer?.observe(card);
    return card;
  }

  private async applyChoice(): Promise<void> {
    await this.plugin.saveOptions();
    await this.plugin.mount();
    this.display();
  }

  private clearPreviews(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const { sprite, url } of this.previews) {
      sprite.stop();
      URL.revokeObjectURL(url);
    }
    this.previews = [];
  }
}
