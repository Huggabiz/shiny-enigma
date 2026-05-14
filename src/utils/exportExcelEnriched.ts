// Enriched Excel export — single SKU list with all catalogue fields
// plus columns capturing range plan usage, stages, lenses, forecast
// assumptions, and warehouse volume breakdown.

import * as XLSX from 'xlsx';
import type { Project } from '../types';
import { getStages, WAREHOUSE_KEYS, WAREHOUSE_LABELS } from '../types';

export function exportToExcelEnriched(project: Project): void {
  const workbook = XLSX.utils.book_new();
  const catalogue = project.catalogue;

  const rows = catalogue.map((product) => {
    const row: Record<string, unknown> = {};

    // Core catalogue fields
    row['SKU'] = product.sku;
    row['Name'] = product.name;
    row['Category'] = product.category;
    row['Sub-Category'] = product.subCategory;
    row['Product Family'] = product.productFamily;
    row['SAP Collection'] = product.sapCollection ?? '';
    row['Source'] = product.source ?? 'live';
    row['Volume (Total)'] = product.volume;

    // Per-warehouse volumes
    for (const k of WAREHOUSE_KEYS) {
      row[`Volume ${WAREHOUSE_LABELS[k]}`] = product.warehouseVolumes?.[k] ?? '';
    }

    // Pricing
    row['UK RRP'] = product.rrp || '';
    row['US RRP'] = product.usRrp ?? '';
    row['EU RRP'] = product.euRrp ?? '';
    row['AUS RRP'] = product.ausRrp ?? '';
    row['Revenue'] = product.revenue || '';

    // Range plan usage — which plans and at which stages
    const planUsage: string[] = [];
    const stageUsage: string[] = [];
    for (const plan of project.plans) {
      const stages = getStages(plan, project);
      const usedStages: string[] = [];
      for (const stage of stages) {
        if (stage.shelf.items.some((i) => i.productId === product.id)) {
          usedStages.push(stage.name);
        }
      }
      if (usedStages.length > 0) {
        planUsage.push(plan.name);
        stageUsage.push(`${plan.name}: ${usedStages.join(', ')}`);
      }
    }
    row['Used in Plans'] = planUsage.join('; ');
    row['Stage Usage'] = stageUsage.join('; ');

    // Default range plan
    const defaultPlanId = project.defaultPlanBySku?.[product.sku];
    const defaultPlan = defaultPlanId ? project.plans.find((p) => p.id === defaultPlanId) : null;
    row['Default Plan'] = defaultPlan?.name ?? '';

    // Lenses
    const lensNames: string[] = [];
    for (const lens of project.lenses ?? []) {
      if (lens.builtInKind === 'dev') {
        if (product.source === 'dev') lensNames.push('Dev');
        continue;
      }
      if (lens.scope === 'per-stage' && lens.stageProductIds) {
        // List which specific stages this product is in for this lens
        const stageNames: string[] = [];
        for (const [stageKey, ids] of Object.entries(lens.stageProductIds)) {
          if (!ids.includes(product.id)) continue;
          // Resolve the stage key to a human-readable name
          let stageName = stageKey;
          if (stageKey === 'current') {
            stageName = project.currentStageLabel ? `${project.currentStageLabel} (Current)` : 'Current';
          } else if (stageKey === 'future') {
            stageName = project.futureStageLabel || 'Future';
          } else {
            const defId = stageKey.replace('stage-', '');
            const def = (project.stageDefinitions ?? []).find((d) => d.id === defId);
            if (def) stageName = def.name;
          }
          stageNames.push(stageName);
        }
        if (stageNames.length > 0) {
          lensNames.push(`${lens.name} [${stageNames.join(', ')}]`);
        }
      } else {
        if (lens.productIds.includes(product.id)) lensNames.push(lens.name);
      }
    }
    row['Lenses'] = lensNames.join('; ');

    // Forecast pipeline summary
    const pipeline = project.forecastPipelines?.[product.sku];
    if (pipeline && pipeline.references.length > 0) {
      row['Forecast Sources'] = pipeline.references.length;
      row['Forecast Modifiers'] = pipeline.productModifiers.length + pipeline.postModifiers.length;
      // Compute the forecast numbers
      let baseVol = 0;
      for (const ref of pipeline.references) {
        const refProd = catalogue.find((p) => p.id === ref.productId);
        const laneVol = (refProd?.volume ?? 0) * (ref.takePercent / 100);
        const lane = pipeline.lanes.find((l) => l.referenceId === ref.id);
        let adjusted = laneVol;
        if (lane) {
          for (const mod of lane.modifiers) adjusted *= mod.value / 100;
        }
        baseVol += adjusted;
      }
      let cleanVol = baseVol;
      for (const mod of pipeline.productModifiers) cleanVol *= mod.value / 100;
      let year1Vol = cleanVol;
      for (const mod of pipeline.postModifiers) year1Vol *= mod.value / 100;
      row['Forecast (Clean)'] = Math.round(cleanVol);
      row['Forecast (Year 1)'] = Math.round(year1Vol);
    } else {
      row['Forecast Sources'] = '';
      row['Forecast Modifiers'] = '';
      row['Forecast (Clean)'] = '';
      row['Forecast (Year 1)'] = '';
    }

    return row;
  });

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'SKU List');
  XLSX.writeFile(workbook, `${project.name.replace(/\s+/g, '_')}_sku_list.xlsx`);
}
