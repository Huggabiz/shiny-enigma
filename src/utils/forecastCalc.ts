// Forecast pipeline computation — pure function, no side effects.
// Takes a ForecastPipeline + the product catalogue and returns the
// per-lane intermediate values plus the two headline outputs:
//   - cleanForecast  = steady-state forecast (before post-launch mods)
//   - year1Forecast  = launch-adjusted forecast (after ramp/distribution)

import type { ForecastModifier, ForecastPipeline, Product } from '../types';

export interface PipelineForecastResult {
  /** Per-lane output (after lane modifiers). Keyed by reference id. */
  laneOutputs: Map<string, number>;
  /** Sum of all lane outputs before product-level modifiers. */
  mergedBase: number;
  /** After product-level modifiers (hero factor, etc.). */
  cleanForecast: number;
  /** After post-launch modifiers (ramp, distribution). */
  year1Forecast: number;
}

function applyModifier(value: number, mod: ForecastModifier): number {
  return value * (mod.value / 100);
}

export function computePipelineForecast(
  pipeline: ForecastPipeline,
  catalogue: Product[],
): PipelineForecastResult {
  const laneOutputs = new Map<string, number>();

  for (const ref of pipeline.references) {
    const product = catalogue.find((p) => p.id === ref.productId);
    let value = (product?.volume ?? 0) * (ref.takePercent / 100);

    const lane = pipeline.lanes.find((l) => l.referenceId === ref.id);
    if (lane) {
      for (const mod of lane.modifiers) {
        value = applyModifier(value, mod);
      }
    }
    laneOutputs.set(ref.id, Math.round(value));
  }

  const mergedBase = Array.from(laneOutputs.values()).reduce((s, v) => s + v, 0);

  let cleanValue = mergedBase;
  for (const mod of pipeline.productModifiers) {
    cleanValue = applyModifier(cleanValue, mod);
  }
  const cleanForecast = Math.round(cleanValue);

  let year1Value = cleanValue;
  for (const mod of pipeline.postModifiers) {
    year1Value = applyModifier(year1Value, mod);
  }
  const year1Forecast = Math.round(year1Value);

  return { laneOutputs, mergedBase, cleanForecast, year1Forecast };
}

export const EMPTY_PIPELINE: ForecastPipeline = {
  references: [],
  lanes: [],
  productModifiers: [],
  postModifiers: [],
};
