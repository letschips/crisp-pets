# Crisp Pet

Shows a Codex pet in Obsidian (desktop only). Reads the same files Codex uses: `${CODEX_HOME:-~/.codex}/pets/<pet>/pet.json` + spritesheet. Both v1 (9 rows, 1536x1872) and v2 (11 rows with look directions, 1536x2288) atlases are supported.

| Obsidian | Pet state |
| --- | --- |
| No activity | idle |
| Typing in an editor | running |
| A few seconds after typing | waiting |
| Reading view | review |
| Plugin loads / click the pet | waving |
| Active note gains a completed task | jumping |
| Uncaught error (at most once per 10 s) | failed |
| Dragging left / right | running-left / running-right |
| Pointer moves (v2 only) | 16 look directions |

Settings: show/hide, pets folder (blank = Codex default), pet, size. Commands: show or hide pet, reload pets from disk.

Development: `npm run check`, then `node scripts/deploy.mjs <vault>`.
