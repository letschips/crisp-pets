// Geometry for the pet and the bubble/panel above it. Pure, so the edge cases can be tested.

const MARGIN_PX = 8;

// Opens below the pet only when the panel does not fit above and there is more room below.
export function overlayBelow(pet: { top: number; bottom: number }, overlayHeight: number, viewportHeight: number): boolean {
  const above = pet.top - MARGIN_PX;
  const below = viewportHeight - pet.bottom - MARGIN_PX;
  return above < overlayHeight && below > above;
}

// Height the overlay may take on the side it opens toward, keeping the gap to the pet and to the window edge.
// When neither side fits, the panel is capped to this and scrolls inside.
export function overlayRoom(pet: { top: number; bottom: number }, below: boolean, viewportHeight: number): number {
  const room = below ? viewportHeight - pet.bottom : pet.top;
  return Math.max(0, room - MARGIN_PX * 2);
}

// The right/bottom offsets of where the pet actually is on screen.
export function displayedOffset(
  rect: { right: number; bottom: number; left: number; top: number },
  viewportWidth: number,
  viewportHeight: number,
): { right: number; bottom: number } {
  return { right: viewportWidth - rect.right, bottom: viewportHeight - rect.bottom };
}
