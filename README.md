# Crisp Pets

Shows a Codex pet in Obsidian (desktop only). Reads the same files Codex uses: `${CODEX_HOME:-~/.codex}/pets/<pet>/pet.json` + spritesheet. Both v1 (9 rows, 1536x1872) and v2 (11 rows with look directions, 1536x2288) atlases are supported.

| Obsidian | Pet state |
| --- | --- |
| No activity | idle |
| Typing in an editor | running |
| Crisp Focus session running (not breaks) | running until pause / stop / skip |
| Crisp Focus session completed | jumping |
| A few seconds after typing | waiting |
| Reading view | review |
| Plugin loads / click the pet | waving |
| Active note gains a completed task | jumping |
| Uncaught error (at most once per 10 s) | failed |
| Dragging left / right | running-left / running-right |
| Pointer moves (v2 only) | 16 look directions |

## Crisp linkage (optional; everything works without other Crisp plugins)

- **Panel**: click the pet. Shows Crisp Focus status (time left, task, today's pomodoros) with pause / stop / start buttons, and shortcuts to Pulse (quick memo, memos, dashboard) and Tempo (tasks, new task). Buttons appear only for commands that exist.
- **Drop text on the pet**: becomes a Crisp Pulse memo through `captureMemoFromSource` (API v1). Source id = `crisp-pets:` + hash(source note, text), so dropping the same passage again reveals the existing memo. Links back to the note when the text is the active editor's selection.
- **Bubbles**: short lines above the pet — focus or pomodoro completed (with task name), break over (click to start the next pomodoro), drop results (click to open the memo). Ambient lines are rate-limited.

Settings: show/hide; follow Codex (shows the pet selected in Codex, resolved from `config.toml` `selected-avatar-id` and, for cloud-migrated pets, `.codex-global-state.json`; re-checked when Obsidian regains focus); a card picker with idle previews (hover to animate); size; pets folder (blank = Codex default). Commands: show or hide pet, reload pets from disk.

Development: `npm run check`, then `node scripts/deploy.mjs <vault>`.
