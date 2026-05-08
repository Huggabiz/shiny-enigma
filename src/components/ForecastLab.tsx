import { useCallback, useMemo, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import type { Product, ShelfItem, ForecastPipeline, ForecastReference, ForecastModifier } from '../types';
import { MODIFIER_TYPE_DEFS } from '../types';
import { computePipelineForecast, EMPTY_PIPELINE } from '../utils/forecastCalc';
import { CloseIcon } from './Icons';
import './ForecastLab.css';

let _idCounter = 0;
function freshId(prefix: string) {
  _idCounter++;
  return `${prefix}-${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ForecastLab() {
  const { project, setForecastPipeline } = useProjectStore();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [devOnly, setDevOnly] = useState(false);
  const [addRefOpen, setAddRefOpen] = useState(false);

  const activePlan = project ? getActivePlan(project) : undefined;
  const catalogue = project?.catalogue ?? [];
  const futureItems = activePlan?.futureShelf.items ?? [];
  const currentItems = activePlan?.currentShelf.items ?? [];

  const filteredItems = useMemo(() =>
    devOnly
      ? futureItems.filter((i) => {
          const p = catalogue.find((c) => c.id === i.productId);
          return p?.source === 'dev' || i.isPlaceholder;
        })
      : futureItems,
    [futureItems, catalogue, devOnly],
  );

  const selectedItem = futureItems.find((i) => i.id === selectedItemId) ?? null;
  const selectedProduct = selectedItem
    ? catalogue.find((p) => p.id === selectedItem.productId)
    : undefined;
  const selectedSku = selectedProduct?.sku ?? '';
  // Forecast pipelines are now stored per-SKU at the project level.
  const pipeline: ForecastPipeline = (selectedSku ? project?.forecastPipelines?.[selectedSku] : undefined) ?? EMPTY_PIPELINE;

  const forecast = useMemo(
    () => computePipelineForecast(pipeline, catalogue),
    [pipeline, catalogue],
  );

  // Launch stage: first stage where this SKU appears in its default range plan.
  const launchStageName = useMemo(() => {
    if (!selectedSku || !project) return null;
    const defaultPlanId = project.defaultPlanBySku?.[selectedSku];
    if (!defaultPlanId) return null;
    const plan = project.plans.find((p) => p.id === defaultPlanId);
    if (!plan) return null;
    const stages = getStages(plan, project);
    // Find the first non-current stage that has this product
    for (const stage of stages) {
      if (stage.position === 'current') continue;
      if (stage.shelf.items.some((i) => {
        const p = catalogue.find((c) => c.id === i.productId);
        return p?.sku === selectedSku;
      })) {
        return stage.name;
      }
    }
    return null;
  }, [selectedSku, project, catalogue]);

  const savePipeline = useCallback(
    (next: ForecastPipeline) => {
      if (!selectedSku) return;
      setForecastPipeline(selectedSku, next);
    },
    [selectedSku, setForecastPipeline],
  );

  // ---- Reference management ----
  const addReference = (productId: string, type: 'cannibalization' | 'analog') => {
    if (pipeline.references.some((r) => r.productId === productId)) return;
    const refId = freshId('ref');
    const next: ForecastPipeline = {
      ...pipeline,
      references: [...pipeline.references, { id: refId, productId, type, takePercent: 100 }],
      lanes: [...pipeline.lanes, { referenceId: refId, modifiers: [] }],
    };
    savePipeline(next);
    setAddRefOpen(false);
  };

  const removeReference = (refId: string) => {
    savePipeline({
      ...pipeline,
      references: pipeline.references.filter((r) => r.id !== refId),
      lanes: pipeline.lanes.filter((l) => l.referenceId !== refId),
    });
  };

  const updateReference = (refId: string, patch: Partial<ForecastReference>) => {
    savePipeline({
      ...pipeline,
      references: pipeline.references.map((r) => r.id === refId ? { ...r, ...patch } : r),
    });
  };

  // ---- Lane modifier management ----
  const addLaneMod = (refId: string, mod: ForecastModifier) => {
    savePipeline({
      ...pipeline,
      lanes: pipeline.lanes.map((l) =>
        l.referenceId === refId ? { ...l, modifiers: [...l.modifiers, mod] } : l,
      ),
    });
  };

  const removeLaneMod = (refId: string, modId: string) => {
    savePipeline({
      ...pipeline,
      lanes: pipeline.lanes.map((l) =>
        l.referenceId === refId
          ? { ...l, modifiers: l.modifiers.filter((m) => m.id !== modId) }
          : l,
      ),
    });
  };

  const updateLaneMod = (refId: string, modId: string, patch: Partial<ForecastModifier>) => {
    savePipeline({
      ...pipeline,
      lanes: pipeline.lanes.map((l) =>
        l.referenceId === refId
          ? { ...l, modifiers: l.modifiers.map((m) => m.id === modId ? { ...m, ...patch } : m) }
          : l,
      ),
    });
  };

  // ---- Product / post modifier management ----
  const addProductMod = (mod: ForecastModifier) =>
    savePipeline({ ...pipeline, productModifiers: [...pipeline.productModifiers, mod] });
  const removeProductMod = (modId: string) =>
    savePipeline({ ...pipeline, productModifiers: pipeline.productModifiers.filter((m) => m.id !== modId) });
  const updateProductMod = (modId: string, patch: Partial<ForecastModifier>) =>
    savePipeline({ ...pipeline, productModifiers: pipeline.productModifiers.map((m) => m.id === modId ? { ...m, ...patch } : m) });

  const addPostMod = (mod: ForecastModifier) =>
    savePipeline({ ...pipeline, postModifiers: [...pipeline.postModifiers, mod] });
  const removePostMod = (modId: string) =>
    savePipeline({ ...pipeline, postModifiers: pipeline.postModifiers.filter((m) => m.id !== modId) });
  const updatePostMod = (modId: string, patch: Partial<ForecastModifier>) =>
    savePipeline({ ...pipeline, postModifiers: pipeline.postModifiers.map((m) => m.id === modId ? { ...m, ...patch } : m) });

  if (!project || !activePlan) return <div className="forecast-lab"><div className="forecast-lab-empty">No active plan</div></div>;

  return (
    <div className="forecast-lab">
      {/* Left: SKU list */}
      <div className="flab-sku-list">
        <div className="flab-sku-list-header">
          <h3>Future SKUs</h3>
          <label className="flab-dev-toggle">
            <input type="checkbox" checked={devOnly} onChange={(e) => setDevOnly(e.target.checked)} />
            Dev only
          </label>
        </div>
        <div className="flab-sku-list-body">
          {filteredItems.map((item) => {
            const p = catalogue.find((c) => c.id === item.productId);
            const isActive = item.id === selectedItemId;
            const hasPipeline = !!item.forecastPipeline?.references.length;
            return (
              <div
                key={item.id}
                className={`flab-sku-row ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedItemId(item.id)}
              >
                <div className="flab-sku-name">{item.isPlaceholder ? (item.placeholderName || 'New SKU') : (p?.name || 'Unknown')}</div>
                <div className="flab-sku-meta">
                  {p?.sku || ''}
                  {hasPipeline && <span className="flab-sku-badge">▸</span>}
                </div>
              </div>
            );
          })}
          {filteredItems.length === 0 && <div className="flab-sku-empty">No future SKUs in this plan</div>}
        </div>
      </div>

      {/* Right: Pipeline canvas */}
      {!selectedItem ? (
        <div className="flab-canvas flab-canvas-empty">
          <h3>Select a future SKU</h3>
          <p>Pick a product from the list on the left to build or review its forecast pipeline.</p>
        </div>
      ) : (
        <div className="flab-canvas">
          <div className="flab-canvas-header">
            <h2>{selectedProduct?.name || selectedItem.placeholderName || 'Unknown'}</h2>
            <span className="flab-canvas-sku">{selectedProduct?.sku || ''}</span>
            {launchStageName && (
              <span className="flab-launch-badge" title="Launch stage (from default range plan)">
                🧪 Launch: {launchStageName}
              </span>
            )}
          </div>

          <div className="flab-pipeline">
            {/* REFERENCES + LANES */}
            <div className="flab-section">
              <div className="flab-section-title">References</div>
              {pipeline.references.map((ref) => {
                const refProduct = catalogue.find((p) => p.id === ref.productId);
                const lane = pipeline.lanes.find((l) => l.referenceId === ref.id);
                const laneOutput = forecast.laneOutputs.get(ref.id) ?? 0;
                const laneMods = MODIFIER_TYPE_DEFS.filter((d) => d.placement.includes('lane'));
                return (
                  <div key={ref.id} className="flab-lane">
                    <div className="flab-ref-card">
                      <div className="flab-ref-type">{ref.type === 'cannibalization' ? 'Cannibalise' : 'Analog'}</div>
                      <div className="flab-ref-name">{refProduct?.name || 'Unknown'}</div>
                      <div className="flab-ref-vol">Vol: {(refProduct?.volume ?? 0).toLocaleString()}</div>
                      <div className="flab-ref-take">
                        <label>
                          Take
                          <input
                            type="number"
                            className="flab-num-input"
                            min={0} max={100}
                            value={ref.takePercent}
                            onChange={(e) => updateReference(ref.id, { takePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                          />%
                        </label>
                        <span className="flab-ref-take-vol">{Math.round((refProduct?.volume ?? 0) * ref.takePercent / 100).toLocaleString()}</span>
                      </div>
                      <button className="flab-ref-type-toggle" onClick={() => updateReference(ref.id, { type: ref.type === 'cannibalization' ? 'analog' : 'cannibalization' })} title="Toggle reference type">
                        ↔
                      </button>
                      <button className="flab-ref-remove" onClick={() => removeReference(ref.id)} title="Remove reference"><CloseIcon size={7} color="currentColor" /></button>
                    </div>

                    {/* Lane modifiers */}
                    <div className="flab-lane-arrow">→</div>
                    {lane?.modifiers.map((mod) => (
                      <ModifierBlock key={mod.id} mod={mod}
                        onUpdate={(patch) => updateLaneMod(ref.id, mod.id, patch)}
                        onRemove={() => removeLaneMod(ref.id, mod.id)} />
                    ))}
                    <AddModifierButton defs={laneMods}
                      onAdd={(type, label, defVal) => addLaneMod(ref.id, { id: freshId('mod'), type, label, value: defVal })} />
                    <div className="flab-lane-arrow">→</div>
                    <div className="flab-lane-output">{laneOutput.toLocaleString()}</div>
                  </div>
                );
              })}
              <button className="flab-add-ref" onClick={() => setAddRefOpen(!addRefOpen)}>
                + Add reference
              </button>
              {addRefOpen && (
                <RefPicker
                  currentItems={currentItems}
                  catalogue={catalogue}
                  existingRefIds={new Set(pipeline.references.map((r) => r.productId))}
                  onPick={addReference}
                  onClose={() => setAddRefOpen(false)}
                />
              )}
            </div>

            {/* MERGE → TARGET */}
            <div className="flab-section flab-target-section">
              <div className="flab-merge-line">
                <div className="flab-merge-label">Merged base: <strong>{forecast.mergedBase.toLocaleString()}</strong></div>
              </div>
              <div className="flab-section-title">Product modifiers</div>
              {pipeline.productModifiers.map((mod) => (
                <ModifierBlock key={mod.id} mod={mod}
                  onUpdate={(patch) => updateProductMod(mod.id, patch)}
                  onRemove={() => removeProductMod(mod.id)} />
              ))}
              <AddModifierButton defs={MODIFIER_TYPE_DEFS.filter((d) => d.placement.includes('product'))}
                onAdd={(type, label, defVal) => addProductMod({ id: freshId('mod'), type, label, value: defVal })} />
              <div className="flab-forecast-badge clean">
                Clean forecast: <strong>{forecast.cleanForecast.toLocaleString()}</strong>
                <WarehouseBreakdown wh={forecast.cleanForecastWh} />
              </div>
            </div>

            {/* POST-LAUNCH */}
            <div className="flab-section flab-post-section">
              <div className="flab-section-title">Post-launch</div>
              {pipeline.postModifiers.map((mod) => (
                <ModifierBlock key={mod.id} mod={mod}
                  onUpdate={(patch) => updatePostMod(mod.id, patch)}
                  onRemove={() => removePostMod(mod.id)} />
              ))}
              <AddModifierButton defs={MODIFIER_TYPE_DEFS.filter((d) => d.placement.includes('post'))}
                onAdd={(type, label, defVal) => addPostMod({ id: freshId('mod'), type, label, value: defVal })} />
              <div className="flab-forecast-badge year1">
                Year 1 forecast: <strong>{forecast.year1Forecast.toLocaleString()}</strong>
                <WarehouseBreakdown wh={forecast.year1ForecastWh} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function WarehouseBreakdown({ wh }: { wh: { uk: number; eu: number; aus: number; us: number; cn: number } }) {
  const hasData = wh.uk || wh.eu || wh.aus || wh.us || wh.cn;
  if (!hasData) return null;
  return (
    <div className="flab-wh-breakdown">
      {wh.uk > 0 && <span>UK: {wh.uk.toLocaleString()}</span>}
      {wh.eu > 0 && <span>EU: {wh.eu.toLocaleString()}</span>}
      {wh.aus > 0 && <span>AUS: {wh.aus.toLocaleString()}</span>}
      {wh.us > 0 && <span>US: {wh.us.toLocaleString()}</span>}
      {wh.cn > 0 && <span>CN: {wh.cn.toLocaleString()}</span>}
    </div>
  );
}

function ModifierBlock({ mod, onUpdate, onRemove }: {
  mod: ForecastModifier;
  onUpdate: (patch: Partial<ForecastModifier>) => void;
  onRemove: () => void;
}) {
  const scope = mod.warehouseScope ?? 'all';
  return (
    <div className="flab-mod-block">
      <div className="flab-mod-header">
        <span className="flab-mod-label">{mod.label}</span>
        <select
          className="flab-mod-scope"
          value={scope}
          onChange={(e) => onUpdate({ warehouseScope: e.target.value as ForecastModifier['warehouseScope'] })}
          title="Warehouse scope"
        >
          <option value="all">All</option>
          <option value="uk">UK</option>
          <option value="eu">EU</option>
          <option value="aus">AUS</option>
          <option value="us">US</option>
          <option value="cn">CN</option>
        </select>
      </div>
      <div className="flab-mod-controls">
        <input
          type="number"
          className="flab-num-input"
          value={mod.value}
          onChange={(e) => onUpdate({ value: Number(e.target.value) || 0 })}
        />
        <span className="flab-mod-pct">%</span>
        <button className="flab-mod-remove" onClick={onRemove} title="Remove modifier">
          <CloseIcon size={6} color="currentColor" />
        </button>
      </div>
    </div>
  );
}

function AddModifierButton({ defs, onAdd }: {
  defs: typeof MODIFIER_TYPE_DEFS;
  onAdd: (type: ForecastModifier['type'], label: string, defaultValue: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (defs.length === 0) return null;
  return (
    <div className="flab-add-mod-wrapper">
      <button className="flab-add-mod" onClick={() => setOpen(!open)}>+</button>
      {open && (
        <div className="flab-add-mod-dropdown">
          {defs.map((d) => (
            <button key={d.type} onClick={() => { onAdd(d.type, d.label, d.defaultValue); setOpen(false); }}
              title={d.description}>
              {d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RefPicker({ currentItems, catalogue, existingRefIds, onPick, onClose }: {
  currentItems: ShelfItem[];
  catalogue: Product[];
  existingRefIds: Set<string>;
  onPick: (productId: string, type: 'cannibalization' | 'analog') => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const products = useMemo(() => {
    const q = search.toLowerCase();
    return catalogue.filter((p) =>
      !existingRefIds.has(p.id) &&
      (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)),
    ).slice(0, 20);
  }, [catalogue, existingRefIds, search]);

  const currentProductIds = new Set(currentItems.map((i) => i.productId));

  return (
    <div className="flab-ref-picker">
      <div className="flab-ref-picker-header">
        <input className="flab-ref-picker-search" placeholder="Search SKU or name…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <button className="flab-ref-picker-close" onClick={onClose}><CloseIcon size={8} color="#999" /></button>
      </div>
      <div className="flab-ref-picker-list">
        {products.map((p) => {
          const inCurrent = currentProductIds.has(p.id);
          return (
            <div key={p.id} className="flab-ref-picker-row">
              <div className="flab-ref-picker-info">
                <span className="flab-ref-picker-name">{p.name}</span>
                <span className="flab-ref-picker-sku">{p.sku}</span>
                <span className="flab-ref-picker-vol">Vol: {p.volume?.toLocaleString()}</span>
              </div>
              <button className="flab-ref-picker-btn" onClick={() => onPick(p.id, inCurrent ? 'cannibalization' : 'analog')}>
                {inCurrent ? 'Cannibalise' : 'Analog'}
              </button>
            </div>
          );
        })}
        {products.length === 0 && <div className="flab-ref-picker-empty">No matching products</div>}
      </div>
    </div>
  );
}
