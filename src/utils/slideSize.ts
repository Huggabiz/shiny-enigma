import type { RangePlan, SlideViewSize } from '../types';

/**
 * Compute the auto-tier slide base scale from the busiest shelf count.
 * Tiers step 1x / 1.25x / 1.5x / 1.75x / 2x at 18 / 28 / 40 / 55 items
 * — matches the thresholds we've been shipping since v1.8.0.
 */
export function computeAutoSlideScale(maxItemCount: number): number {
  if (maxItemCount > 55) return 2;
  if (maxItemCount > 40) return 1.75;
  if (maxItemCount > 28) return 1.5;
  if (maxItemCount > 18) return 1.25;
  return 1;
}

/**
 * Resolve the effective slide-size settings for a plan + view:
 *   - Honour the manual override the user saved against the plan if any.
 *   - Otherwise fall back to the auto-tier picked from the busiest
 *     shelf count relevant to that view.
 *   - Returns both the scale and the mode so callers can show the
 *     right state in the UI ("Auto (1.5×)" vs "1.5×").
 */
export function resolvePlanSlideSize(
  plan: RangePlan | undefined,
  view: 'transform' | 'range',
  autoItemCount: number,
): SlideViewSize {
  const stored = plan?.slideSettings?.[view];
  if (stored && stored.mode === 'manual') {
    return { scale: stored.scale, mode: 'manual' };
  }
  return { scale: computeAutoSlideScale(autoItemCount), mode: 'auto' };
}
