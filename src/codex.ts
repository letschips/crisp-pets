// Which pet Codex currently shows. Codex keeps the choice in config.toml as `selected-avatar-id`:
// "custom:<folder>" for a local pet, or a cloud id "pet_..." once Codex has migrated local pets to the
// cloud. The cloud-to-local mapping lives in .codex-global-state.json under migrated-cloud-pet-ids-v1.
// Both files are Codex internals, so every miss just means "no Codex selection".

export function parseSelectedAvatarId(configToml: string): string | null {
  const match = /^\s*selected-avatar-id\s*=\s*"([^"]+)"/m.exec(configToml);
  return match ? match[1] : null;
}

export function needsGlobalState(selectedId: string): boolean {
  return !selectedId.startsWith("custom:");
}

// Returns the local pet folder name for the selection, or null if it is not a local pet.
export function resolveSelectedPet(selectedId: string, globalState: unknown): string | null {
  if (selectedId.startsWith("custom:")) return selectedId.slice("custom:".length) || null;
  const atoms = (globalState as Record<string, unknown> | null)?.["electron-persisted-atom-state"];
  const migrated = (atoms as Record<string, unknown> | undefined)?.["migrated-cloud-pet-ids-v1"];
  if (typeof migrated !== "object" || migrated === null) return null;
  // Keyed by account; the value maps "custom:<folder>" -> cloud id.
  for (const mapping of Object.values(migrated)) {
    if (typeof mapping !== "object" || mapping === null) continue;
    for (const [local, cloud] of Object.entries(mapping)) {
      if (cloud === selectedId && local.startsWith("custom:")) return local.slice("custom:".length) || null;
    }
  }
  return null;
}
