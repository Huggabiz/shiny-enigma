// Shared layout constants and computation for shelf + sankey alignment

export const BASE_CARD_WIDTH = 100;
export const CARD_GAP = 6;
export const MIN_CARD_WIDTH = 28;
export const RAIL_PADDING = 8;

export interface ShelfLayout {
  cardWidth: number;
  slotWidth: number;
  offsetLeft: number;
  needsShrink: boolean;
  contentWidth: number;
}

export function computeShelfLayout(itemCount: number, railWidth: number): ShelfLayout {
  if (itemCount <= 0) {
    return { cardWidth: BASE_CARD_WIDTH, slotWidth: BASE_CARD_WIDTH + CARD_GAP, offsetLeft: 0, needsShrink: false, contentWidth: 0 };
  }

  const availableWidth = Math.max(0, railWidth - RAIL_PADDING * 2);
  const naturalContentWidth = itemCount * (BASE_CARD_WIDTH + CARD_GAP) - CARD_GAP;
  const needsShrink = naturalContentWidth > availableWidth;

  // Fluid shrink: let cards compress freely so they always fit on screen.
  // MIN_CARD_WIDTH is a soft target; honour it when space permits but don't
  // clamp above it, otherwise a large shelf would overflow horizontally.
  let cardWidth: number;
  if (!needsShrink) {
    cardWidth = BASE_CARD_WIDTH;
  } else {
    const fluid = Math.floor((availableWidth - (itemCount - 1) * CARD_GAP) / itemCount);
    cardWidth = Math.max(12, fluid);
  }

  const slotWidth = cardWidth + CARD_GAP;
  const contentWidth = itemCount * slotWidth - CARD_GAP;
  // Always centre the row of cards horizontally within the rail.
  const offsetLeft = RAIL_PADDING + Math.max(0, (availableWidth - contentWidth) / 2);

  return { cardWidth, slotWidth, offsetLeft, needsShrink, contentWidth };
}
