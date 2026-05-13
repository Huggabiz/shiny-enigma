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

  // Diagonal split: 135° gradient with hard stops for both the
  // background fill (at 22% alpha) and the border (at full colour).
  // border-image applies the gradient to the border itself so the
  // split matches the fill. Note: border-image disables border-radius
  // in CSS — multi-lens cards have sharp corners.
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
    background: `linear-gradient(135deg, ${fillStops.join(', ')})`,
    borderImage: `linear-gradient(135deg, ${borderStops.join(', ')}) 1`,
    borderStyle: 'solid' as const,
    borderWidth: '2px',
  };
}
