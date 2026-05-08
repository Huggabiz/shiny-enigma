import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import type {} from '../types';
import { WAREHOUSE_KEYS, WAREHOUSE_LABELS } from '../types';
import { CloseIcon } from './Icons';
import './SkuDetailsPane.css';

/**
 * SkuDetailsPane — a collapsible panel at the bottom of the workspace
 * that shows details for the currently selected SKU. Appears when a
 * card is selected in range/transform/multiplan view (normal click,
 * not in forecast or link mode). Shows:
 *   - Catalogue attributes (name, SKU, category, volume, warehouse breakdown, prices)
 *   - Which range plans the SKU is used in + which stage it first appears
 *   - Default range indicator with ability to change
 *   - Forecast summary + entry point to forecast lab
 */
export function SkuDetailsPane() {
  const {
    project,
    selectedItemId,
    setSelectedItem,
    setDefaultPlan,
    setActiveView,
  } = useProjectStore();

  const activePlan = project ? getActivePlan(project) : undefined;

  // Find the selected item across all stages of the active plan
  const selectedItem = useMemo(() => {
    if (!selectedItemId || !activePlan || !project) return null;
    const stages = getStages(activePlan, project);
    for (const stage of stages) {
      const item = stage.shelf.items.find((i) => i.id === selectedItemId);
      if (item) return item;
    }
    return null;
  }, [selectedItemId, activePlan, project]);

  const product = useMemo(() => {
    if (!selectedItem || !project) return null;
    return project.catalogue.find((p) => p.id === selectedItem.productId) ?? null;
  }, [selectedItem, project]);

  if (!product || !project || !selectedItem) return null;

  const sku = product.sku;
  const defaultPlanId = project.defaultPlanBySku?.[sku];
  const wv = product.warehouseVolumes;

  // Find all plans this SKU is used in + its first stage in each
  const usedInPlans = project.plans.map((plan) => {
    const stages = getStages(plan, project);
    let firstStage: string | null = null;
    for (const stage of stages) {
      if (stage.shelf.items.some((i) => {
        const p = project.catalogue.find((c) => c.id === i.productId);
        return p?.sku === sku;
      })) {
        firstStage = stage.name;
        break;
      }
    }
    if (!firstStage) return null;
    return { planId: plan.id, planName: plan.name, firstStage, isDefault: plan.id === defaultPlanId };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // Forecast pipeline summary
  const pipeline = project.forecastPipelines?.[sku];
  const hasForecast = !!pipeline?.references.length;

  return (
    <div className="sku-details-pane">
      <div className="sku-details-header">
        <div className="sku-details-title">
          <span className="sku-details-name">{product.name}</span>
          <span className="sku-details-sku">{sku}</span>
          {product.source === 'dev' && <span className="sku-details-dev">DEV</span>}
        </div>
        <button className="sku-details-close" onClick={() => setSelectedItem(null)} title="Close">
          <CloseIcon size={10} color="#999" />
        </button>
      </div>

      <div className="sku-details-body">
        {/* Attributes */}
        <div className="sku-details-section">
          <div className="sku-details-grid">
            <div className="sku-attr"><span className="sku-attr-label">Category</span><span>{product.category || '—'}</span></div>
            <div className="sku-attr"><span className="sku-attr-label">Sub-Category</span><span>{product.subCategory || '—'}</span></div>
            <div className="sku-attr"><span className="sku-attr-label">Family</span><span>{product.productFamily || '—'}</span></div>
            <div className="sku-attr"><span className="sku-attr-label">Volume</span><span>{product.volume?.toLocaleString() ?? '—'}</span></div>
            {product.rrp > 0 && <div className="sku-attr"><span className="sku-attr-label">UK RRP</span><span>£{product.rrp}</span></div>}
            {product.usRrp !== undefined && <div className="sku-attr"><span className="sku-attr-label">US RRP</span><span>${product.usRrp}</span></div>}
            {product.euRrp !== undefined && <div className="sku-attr"><span className="sku-attr-label">EU RRP</span><span>€{product.euRrp}</span></div>}
            {product.ausRrp !== undefined && <div className="sku-attr"><span className="sku-attr-label">AUS RRP</span><span>A${product.ausRrp}</span></div>}
          </div>
          {wv && (
            <div className="sku-warehouse-row">
              {WAREHOUSE_KEYS.map((k) => wv[k] ? (
                <span key={k} className="sku-wh-chip">{WAREHOUSE_LABELS[k]}: {wv[k]!.toLocaleString()}</span>
              ) : null)}
            </div>
          )}
        </div>

        {/* Range plans */}
        <div className="sku-details-section">
          <div className="sku-section-title">Used in plans</div>
          {usedInPlans.length === 0 ? (
            <div className="sku-details-empty">Not used in any plan</div>
          ) : (
            <div className="sku-plans-list">
              {usedInPlans.map((p) => (
                <div key={p.planId} className={`sku-plan-row ${p.isDefault ? 'default' : ''}`}>
                  <span className="sku-plan-name">{p.planName}</span>
                  <span className="sku-plan-stage">from {p.firstStage}</span>
                  {p.isDefault ? (
                    <span className="sku-plan-default-badge">Default</span>
                  ) : (
                    <button className="sku-plan-set-default" onClick={() => setDefaultPlan(sku, p.planId)}>
                      Set default
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Forecast summary + entry */}
        <div className="sku-details-section">
          <div className="sku-section-title">Forecast</div>
          {hasForecast ? (
            <div className="sku-forecast-summary">
              {pipeline!.references.length} source{pipeline!.references.length === 1 ? '' : 's'}
              {' · '}
              {pipeline!.productModifiers.length + pipeline!.postModifiers.length} modifier{pipeline!.productModifiers.length + pipeline!.postModifiers.length === 1 ? '' : 's'}
            </div>
          ) : (
            <div className="sku-details-empty">No forecast pipeline set up</div>
          )}
          <button className="sku-forecast-enter" onClick={() => setActiveView('forecast-lab')}>
            🧪 Open in Forecast Lab
          </button>
        </div>
      </div>
    </div>
  );
}
