// How the settings page lays out the pet picker. A few pets get full cards; many get a compact,
// scrollable grid with the current pet first, and a search box once there are too many to scan.

export const COMPACT_ABOVE = 6;
export const SEARCH_ABOVE = 12;

export interface PickerLayout {
  compact: boolean;
  search: boolean;
}

export function pickerLayout(count: number): PickerLayout {
  return { compact: count > COMPACT_ABOVE, search: count > SEARCH_ABOVE };
}

export function orderPets<T>(pets: T[], chosen: T | undefined, compact: boolean): T[] {
  if (!compact || !chosen || !pets.includes(chosen)) return pets;
  return [chosen, ...pets.filter((pet) => pet !== chosen)];
}

export function matchesQuery(fields: (string | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => field?.toLowerCase().includes(q));
}
