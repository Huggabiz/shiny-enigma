// Shared lens-tinting logic for both MatrixProductCard and ProductCard.
// Computes the diagonal-split background gradient when multiple lenses
// are active simultaneously.

import type { Lens } from '../types';
import { hexToRgba } from './color';

/** Compute the inline style for a card's lens tint. Returns undefined
 * if the product isn't in any active lens, or a style object with a
 * diagonal `linear-gradient` background + the first matching lens's
 * border colour. */
export function computeLensTintStyle(
  activeLenses: Lens[],
  productId: string | undefined,
  stageKey?: string,
): { backgroundColor: string; borderColor: string } | undefined {
  if (!productId || activeLenses.length === 0) return undefined;

  // Find which of the active lenses contain this product
  const matchingColours: string[] = [];
  let firstBorderColor = '';
  for (const lens of activeLenses) {
    if (lens.builtInKind) continue;
    let inLens = false;
    if (lens.scope === 'per-stage' && stageKey) {
      inLens = lens.stageProductIds?.[stageKey]?.includes(productId) ?? false;
    } else if (lens.scope !== 'per-stage') {
      inLens = lens.productIds.includes(productId);
    }
    if (inLens) {
      matchingColours.push(lens.color);
      if (!firstBorderColor) firstBorderColor = lens.color;
    }
  }

  if (matchingColours.length === 0) return undefined;

  if (matchingColours.length === 1) {
    return {
      backgroundColor: hexToRgba(matchingColours[0], 0.22),
      borderColor: matchingColours[0],
    };
  }

  // Multiple lenses: diagonal split gradient at 135° (top-left → bottom-right)
  const stops: string[] = [];
  const step = 100 / matchingColours.length;
  for (let i = 0; i < matchingColours.length; i++) {
    const start = Math.round(step * i);
    const end = Math.round(step * (i + 1));
    const rgba = hexToRgba(matchingColours[i], 0.22);
    stops.push(`${rgba} ${start}%`, `${rgba} ${end}%`);
  }

  return {
    backgroundColor: 'transparent',
    borderColor: firstBorderColor,
  };
}

/** Same as computeLensTintStyle but returns the full CSS background
 * property (including gradient) for inline use. Separated so the
 * caller can set `background` instead of `backgroundColor`. */
export function computeLensTintBackground(
  activeLenses: Lens[],
  productId: string | undefined,
  stageKey?: string,
): React.CSSProperties | undefined {
  if (!productId || activeLenses.length === 0) return undefined;

  const matchingColours: string[] = [];
  let firstBorderColor = '';
  for (const lens of activeLenses) {
    if (lens.builtInKind) continue;
    let inLens = false;
    if (lens.scope === 'per-stage' && stageKey) {
      inLens = lens.stageProductIds?.[stageKey]?.includes(productId) ?? false;
    } else if (lens.scope !== 'per-stage') {
      inLens = lens.productIds.includes(productId);
    }
    if (inLens) {
      matchingColours.push(lens.color);
      if (!firstBorderColor) firstBorderColor = lens.color;
    }
  }

  if (matchingColours.length === 0) return undefined;

  if (matchingColours.length === 1) {
    return {
      backgroundColor: hexToRgba(matchingColours[0], 0.22),
      borderColor: matchingColours[0],
    };
  }

  // Three layered backgrounds (top to bottom in CSS stacking):
  //   1. Semi-transparent diagonal tint (padding-box) — the visible fill
  //   2. Solid white (padding-box) — blocks the border gradient from
  //      bleeding through the semi-transparent fill
  //   3. Full-colour diagonal gradient (border-box) — only visible in
  //      the 2px transparent border area
  // border-radius works normally since we're not using border-image.
  const fillStops: string[] = [];
  const borderStops: string[] = [];
  const step = 100 / matchingColours.length;
  for (let i = 0; i < matchingColours.length; i++) {
    const start = Math.round(step * i);
    const end = Math.round(step * (i + 1));
    fillStops.push(`${hexToRgba(matchingColours[i], 0.22)} ${start}%`, `${hexToRgba(matchingColours[i], 0.22)} ${end}%`);
    borderStops.push(`${matchingColours[i]} ${start}%`, `${matchingColours[i]} ${end}%`);
  }

  return {
    background: [
      `linear-gradient(135deg, ${fillStops.join(', ')}) padding-box`,
      `linear-gradient(#fff, #fff) padding-box`,
      `linear-gradient(135deg, ${borderStops.join(', ')}) border-box`,
    ].join(', '),
    border: '2px solid transparent',
  };
}
