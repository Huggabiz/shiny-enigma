import type { CardFormat, RangePlan } from '../types';
import { DEFAULT_CARD_FORMAT } from '../types';

/**
 * Compute the effective CardFormat for the currently active plan + variant.
 * Variant override wins if present; otherwise the plan override; otherwise
 * the global default. Partial overrides are merged on top of the default so
 * a variant only needs to store the keys it wants to change.
 */
export function resolveEffectiveCardFormat(
  plan: RangePlan | undefined,
  activeVariantId: string | null,
  globalDefault: CardFormat = DEFAULT_CARD_FORMAT,
): CardFormat {
  if (!plan) return globalDefault;

  const variant = activeVariantId
    ? plan.variants.find((v) => v.id === activeVariantId)
    : undefined;

  // Merge order: global default < plan override < variant override
  return {
    ...globalDefault,
    ...(plan.cardFormat || {}),
    ...(variant?.cardFormat || {}),
  };
}
