// Shared layout constants and computation for shelf + sankey alignment

export const BASE_CARD_WIDTH = 100;
export const CARD_GAP = 10;
export const MIN_CARD_WIDTH = 54;
export const RAIL_PADDING = 8;

export interface ShelfLayout {
  cardWidth: number;
  slotWidth: number;
  offsetLeft: number;
  needsShrink: boolean;
  contentWidth: number;
}

export function computeShelfLayout(itemCount: number, railWidth: number): ShelfLayout {
  const availableWidth = railWidth - RAIL_PADDING * 2;
  const naturalContentWidth = itemCount * (BASE_CARD_WIDTH + CARD_GAP) - (itemCount > 0 ? CARD_GAP : 0);
  const needsShrink = itemCount > 0 && naturalContentWidth > availableWidth;

  const cardWidth = needsShrink
    ? Math.max(MIN_CARD_WIDTH, Math.floor((availableWidth - (itemCount - 1) * CARD_GAP) / itemCount))
    : BASE_CARD_WIDTH;
  const slotWidth = cardWidth + CARD_GAP;
  const contentWidth = itemCount * slotWidth - (itemCount > 0 ? CARD_GAP : 0);
  const offsetLeft = needsShrink ? RAIL_PADDING : Math.max(0, (railWidth - contentWidth) / 2);

  return { cardWidth, slotWidth, offsetLeft, needsShrink, contentWidth };
}
