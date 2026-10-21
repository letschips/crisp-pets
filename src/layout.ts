// Geometry for the pet and the bubble/panel above it. Pure, so the edge cases can be tested.

const MARGIN_PX = 8;

// Opens below the pet only when the panel does not fit above and there is more room below.
export function overlayBelow(pet: { top: number; bottom: number }, overlayHeight: number, viewportHeight: number): boolean {
  const above = pet.top - MARGIN_PX;
  const below = viewportHeight - pet.bottom - MARGIN_PX;
  return above < overlayHeight && below > above;
}

// The right/bottom offsets of where the pet actually is on screen.
export function displayedOffset(
  rect: { right: number; bottom: number; left: number; top: number },
  viewportWidth: number,
  viewportHeight: number,
): { right: number; bottom: number } {
  return { right: viewportWidth - rect.right, bottom: viewportHeight - rect.bottom };
}
