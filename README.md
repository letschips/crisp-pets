# Crisp Pets

Codex 桌面版可以养一只宠物：它站在窗口一角，你写代码时它在忙，任务完成时它跳一下。宠物的文件就放在本机 `~/.codex/pets/` 里，一个 `pet.json` 加一张雪碧图。

Crisp Pets 把这只宠物带进 Obsidian。它直接读 Codex 的宠物文件，不需要转换，也不需要另做形象；在 Codex 里换了宠物，切回 Obsidian 时这边也跟着换。

[![Obsidian](https://img.shields.io/badge/Obsidian-v1.6.0%2B-blue.svg)](https://obsidian.md)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Crisp Suite](https://img.shields.io/badge/Crisp-Suite-orange.svg)](https://github.com/letschips)

## 宠物会做什么

| 你在 Obsidian 里 | 宠物 |
| --- | --- |
| 没有操作 | 待着，偶尔眨眼 |
| 在编辑器里打字 | 忙起来；停笔几秒后转为等待 |
| 切到阅读视图 | 认真看 |
| 当前笔记勾掉一项任务 | 跳一下 |
| 拖着它往左或往右 | 跑起来 |
| 鼠标移动 | 朝鼠标方向看（v2 宠物有 16 个朝向） |

宠物可以拖到窗口任意位置，位置会记住。系统开启「减少动态效果」时只显示静止的第一帧。窗口在后台时动画暂停。

## 和其他 Crisp 插件联动（需要激活）

- **点宠物打开面板**：Crisp Focus 正在专注时显示倒计时、进度和任务名，可以暂停、结束或开始番茄；装了 Crisp Pulse 时显示今日贡献、连续天数和待处理速记，点数字打开看板或速记；下面是记速记、看板、任务、新建任务四个入口。没装的插件，对应部分不显示。
- **把文字拖给宠物，记成一条 Pulse 速记**：在编辑器里选中一段文字，按住选区拖到宠物身上松手。从编辑器拖来的速记会带上原笔记的出处链接；同一段拖两次不会重复记，会打开原来那条。需要 Crisp Pulse 1.26.0 或更高版本。
- **专注联动**：Crisp Focus 专注期间宠物一直在忙，完成一个番茄时跳一下并说一句；休息结束时提醒你开始下一个。
- **今天的状态**（Crisp Pulse 1.26.0+）：当天第一次有产出时打个招呼，连续天数到 3、7、14、21、30、50、100 天等节点时庆祝一下，18 点后还有没去处的速记会提醒一次。

提醒都是宠物头顶的一句短话，几秒后消失；同类提醒有冷却时间，不会刷屏。面板和提醒都可以用键盘操作：Tab 选中宠物，Enter 打开面板，Esc 关闭。

## 宠物从哪里来

- 默认读取 Codex 的宠物目录：`$CODEX_HOME/pets`，没设 `CODEX_HOME` 时是 `~/.codex/pets`。设置页里可以换成别的目录。
- 支持 Codex 的两种宠物格式：v1（9 行动作）和 v2（多两行朝向）。尺寸不符或版本不认识的宠物会在设置页标出原因，不会显示。
- 「跟随 Codex」打开时，显示 Codex 当前选中的那只。Codex 内置的云端宠物在本机没有图片，这时用你在设置页选的那只。
- 读取 Codex 当前选择依赖 Codex 自己的配置文件，Codex 改了格式时只会退回你的选择，不会报错。

插件只读这些文件，不修改 Codex 的任何数据。

## 激活

未激活时，宠物显示、选宠物、跟随 Codex 和上面表格里的基础动作都可以直接使用；面板、拖文字记速记、Focus 与 Pulse 联动需要激活码。

- 支持 Crisp Suite 全家桶授权码或单款授权码，在设置页「软件授权与激活」里输入。
- 库里已经激活过其他 Crisp 插件时，Crisp Pets 启动后会自动继承授权。
- 授权码先在本地用内置的 Ed25519 公钥验签。激活时和每次启动后，会在后台向 `https://license.letschips.xyz/api/verify-device` 核对一次吊销状态与设备数；网络不可用、超时（2.5 秒）或服务暂不可用时，降级为本地验签，不影响使用。
- 除上述授权核对外，插件不发出任何网络请求，不收集使用数据。

## 安装

### 通过 BRAT 安装

1. 安装并启用 Obsidian42 - BRAT 插件。
2. 命令面板执行 `BRAT: Add a beta plugin for testing`。
3. 输入 `letschips/crisp-pets`，添加后在「第三方插件」里启用 Crisp Pets。

### 手动安装

1. 从 [Releases](https://github.com/letschips/crisp-pets/releases) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放进库目录下的 `.obsidian/plugins/crisp-pets/`。
3. 重启 Obsidian 或在设置里重新加载插件，然后启用 Crisp Pets。

仅支持桌面端：宠物文件在库外，只有桌面端能读取。

命令面板里有 `Show or hide pet`、`Open pet panel`、`Reload pets from disk` 三条命令。

## 授权与许可

Crisp Pets 是专有商业软件，版权归作者 letschips 所有。详细条款见 [LICENSE](LICENSE)。宠物形象归各自作者所有，本插件不附带任何宠物文件。Codex 是 OpenAI 的产品，本插件与 OpenAI 无关。

- 作者主页：小红书 [@letschips](https://xhslink.cn/m/3MwtKu4822b)
- 公众号：来吃薯条儿
