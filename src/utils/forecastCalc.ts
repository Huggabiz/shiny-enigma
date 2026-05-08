// Forecast pipeline computation — pure function, no side effects.
// Takes a ForecastPipeline + the product catalogue and returns the
// per-lane intermediate values plus two headline outputs (clean +
// year1) with a per-warehouse breakdown.

import type { ForecastModifier, ForecastPipeline, Product } from '../types';

/** Per-warehouse volume state used throughout the pipeline. */
interface WarehouseState {
  uk: number;
  eu: number;
  aus: number;
  us: number;
  cn: number;
}

function emptyWh(): WarehouseState { return { uk: 0, eu: 0, aus: 0, us: 0, cn: 0 }; }
function totalWh(wh: WarehouseState): number { return wh.uk + wh.eu + wh.aus + wh.us + wh.cn; }
function roundWh(wh: WarehouseState): WarehouseState {
  return { uk: Math.round(wh.uk), eu: Math.round(wh.eu), aus: Math.round(wh.aus), us: Math.round(wh.us), cn: Math.round(wh.cn) };
}

function productToWh(product: Product | undefined, takePercent: number): WarehouseState {
  const pct = takePercent / 100;
  const wv = product?.warehouseVolumes;
  if (wv) {
    return {
      uk: (wv.uk ?? 0) * pct,
      eu: (wv.eu ?? 0) * pct,
      aus: (wv.aus ?? 0) * pct,
      us: (wv.us ?? 0) * pct,
      cn: (wv.cn ?? 0) * pct,
    };
  }
  // No warehouse breakdown — put the total volume in UK as fallback
  const vol = (product?.volume ?? 0) * pct;
  return { uk: vol, eu: 0, aus: 0, us: 0, cn: 0 };
}

function applyModifierWh(wh: WarehouseState, mod: ForecastModifier): WarehouseState {
  const scope = mod.warehouseScope ?? 'all';
  const factor = mod.value / 100;
  if (scope === 'all') {
    return { uk: wh.uk * factor, eu: wh.eu * factor, aus: wh.aus * factor, us: wh.us * factor, cn: wh.cn * factor };
  }
  // Scope to a single warehouse
  return { ...wh, [scope]: wh[scope] * factor };
}

function addWh(a: WarehouseState, b: WarehouseState): WarehouseState {
  return { uk: a.uk + b.uk, eu: a.eu + b.eu, aus: a.aus + b.aus, us: a.us + b.us, cn: a.cn + b.cn };
}

export interface PipelineForecastResult {
  laneOutputs: Map<string, number>;
  laneWarehouseOutputs: Map<string, WarehouseState>;
  mergedBase: number;
  mergedBaseWh: WarehouseState;
  cleanForecast: number;
  cleanForecastWh: WarehouseState;
  year1Forecast: number;
  year1ForecastWh: WarehouseState;
}

export function computePipelineForecast(
  pipeline: ForecastPipeline,
  catalogue: Product[],
): PipelineForecastResult {
  const laneOutputs = new Map<string, number>();
  const laneWarehouseOutputs = new Map<string, WarehouseState>();

  for (const ref of pipeline.references) {
    const product = catalogue.find((p) => p.id === ref.productId);
    let wh = productToWh(product, ref.takePercent);

    const lane = pipeline.lanes.find((l) => l.referenceId === ref.id);
    if (lane) {
      for (const mod of lane.modifiers) {
        wh = applyModifierWh(wh, mod);
      }
    }
    const rounded = roundWh(wh);
    laneOutputs.set(ref.id, totalWh(rounded));
    laneWarehouseOutputs.set(ref.id, rounded);
  }

  let mergedWh = emptyWh();
  for (const wh of laneWarehouseOutputs.values()) {
    mergedWh = addWh(mergedWh, wh);
  }
  const mergedBase = Math.round(totalWh(mergedWh));

  let cleanWh = { ...mergedWh };
  for (const mod of pipeline.productModifiers) {
    cleanWh = applyModifierWh(cleanWh, mod);
  }
  const cleanRounded = roundWh(cleanWh);
  const cleanForecast = totalWh(cleanRounded);

  let year1Wh = { ...cleanWh };
  for (const mod of pipeline.postModifiers) {
    year1Wh = applyModifierWh(year1Wh, mod);
  }
  const year1Rounded = roundWh(year1Wh);
  const year1Forecast = totalWh(year1Rounded);

  return {
    laneOutputs,
    laneWarehouseOutputs,
    mergedBase,
    mergedBaseWh: roundWh(mergedWh),
    cleanForecast,
    cleanForecastWh: cleanRounded,
    year1Forecast,
    year1ForecastWh: year1Rounded,
  };
}

export const EMPTY_PIPELINE: ForecastPipeline = {
  references: [],
  lanes: [],
  productModifiers: [],
  postModifiers: [],
};
