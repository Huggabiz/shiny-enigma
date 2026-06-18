import { useMemo, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages, isProductInLens } from '../types';
import type { Product, Shelf, ShelfItem, Lens } from '../types';
import { anonDisplay } from '../utils/anonymise';
import './MultiplanListView.css';

interface ListRow {
  product: Product | null;
  item: ShelfItem;
  planLabel: string;
  matrixRow: string;
  matrixCol: string;
  ghosted: boolean;
  planBreak: boolean;
}

interface ListColumnConfig {
  showGroups: boolean;
  showVolume: boolean;
  showRrp: boolean;
  showUsRrp: boolean;
  showEuRrp: boolean;
  showAusRrp: boolean;
  showRevenue: boolean;
  showForecastVolume: boolean;
  showForecastRevenue: boolean;
  showCategory: boolean;
  mergeDuplicates: boolean;
}

const DEFAULT_COL_CONFIG: ListColumnConfig = {
  showGroups: true,
  showVolume: true,
  showRrp: true,
  showUsRrp: false,
  showEuRrp: false,
  showAusRrp: false,
  showRevenue: false,
  showForecastVolume: false,
  showForecastRevenue: false,
  showCategory: false,
  mergeDuplicates: false,
};

export function MultiplanListView() {
  const {
    project,
    showGhosted,
    setShowGhosted,
    exclusiveLensFilter,
    setExclusiveLensFilter,
    setMultiplanListShelfSide,
    setSelectedItem,
    selectedItemId,
  } = useProjectStore();

  const [colConfig, setColConfig] = useState<ListColumnConfig>(DEFAULT_COL_CONFIG);
  const [visibleLensIds, setVisibleLensIds] = useState<Set<string> | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);

  const firstPlan = project ? getActivePlan(project) : undefined;
  const stagesForToggle = useMemo(() => {
    const all = firstPlan && project ? getStages(firstPlan, project) : [];
    const vk = project?.visibleStageKeys;
    if (!vk || vk.length === 0) return all;
    const filtered = all.filter((s) => vk.includes(s.key));
    return filtered.length > 0 ? filtered : all;
  }, [firstPlan, project]);

  const listView = project?.multiplanListView ?? { shelfSide: 'current' as const, entries: [] };
  const shelfSide = listView.shelfSide;
  const entries = listView.entries;

  const customLenses = useMemo(
    () => (project?.lenses ?? []).filter((l) => !l.builtInKind),
    [project?.lenses],
  );

  const shownLenses = useMemo(
    () => visibleLensIds === null ? customLenses : customLenses.filter((l) => visibleLensIds.has(l.id)),
    [customLenses, visibleLensIds],
  );

  const toggleLensCol = (lensId: string) => {
    setVisibleLensIds((prev) => {
      const current = prev ?? new Set(customLenses.map((l) => l.id));
      const next = new Set(current);
      if (next.has(lensId)) next.delete(lensId);
      else next.add(lensId);
      return next;
    });
  };

  const activeLenses = useMemo(() => {
    const ids = project?.activeLensIds ?? [];
    if (ids.length === 0) return [];
    return ids.map((id) => (project?.lenses ?? []).find((l) => l.id === id)).filter((l): l is Lens => !!l);
  }, [project?.activeLensIds, project?.lenses]);

  const catalogue = project?.catalogue ?? [];

  const rawRows = useMemo(() => {
    if (!project) return [];
    const result: ListRow[] = [];
    let lastPlanLabel = '';

    for (const entry of entries) {
      const plan = project.plans.find((p) => p.id === entry.planId);
      if (!plan) continue;
      const variant = entry.variantId
        ? plan.variants.find((v) => v.id === entry.variantId) ?? null
        : null;
      if (entry.variantId && !variant) continue;

      let shelf: Shelf;
      if (shelfSide === 'current') shelf = plan.currentShelf;
      else if (shelfSide === 'future') shelf = plan.futureShelf;
      else {
        const stageId = shelfSide.replace('stage-', '');
        const is = (plan.intermediateShelves ?? []).find((s) => s.stageId === stageId);
        if (!is) continue;
        shelf = is.shelf;
      }

      const includedKey = shelfSide === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
      const includedIds = variant ? new Set(variant[includedKey]) : null;
      const layout = shelf.matrixLayout;
      const planLabel = variant ? `${plan.name} (${variant.name})` : plan.name;
      const planBreak = planLabel !== lastPlanLabel && lastPlanLabel !== '';
      let isFirstInPlan = true;

      for (const item of shelf.items) {
        const isIncluded = !includedIds || includedIds.has(item.id);
        if (!isIncluded && !showGhosted) continue;

        const product = item.isPlaceholder ? null : catalogue.find((p) => p.id === item.productId) ?? null;

        const assignment = layout?.assignments.find((a) => a.itemId === item.id);
        const matrixRow = assignment && layout ? (layout.yLabels[assignment.row] ?? '') : '';
        const matrixCol = assignment && layout ? (layout.xLabels[assignment.col] ?? '') : '';

        if (exclusiveLensFilter && activeLenses.length > 0 && product) {
          const inAny = activeLenses.some((lens) => {
            if (lens.builtInKind) return false;
            return isProductInLens(lens, product, shelfSide);
          });
          if (!inAny) continue;
        }

        result.push({
          product, item, planLabel, matrixRow, matrixCol,
          ghosted: !isIncluded,
          planBreak: planBreak && isFirstInPlan,
        });
        isFirstInPlan = false;
      }
      lastPlanLabel = planLabel;
    }
    return result;
  }, [project, entries, shelfSide, showGhosted, exclusiveLensFilter, activeLenses, catalogue]);

  const rows = useMemo(() => {
    if (!colConfig.mergeDuplicates) return rawRows;
    const merged: ListRow[] = [];
    const seen = new Map<string, ListRow>();
    for (const row of rawRows) {
      const key = row.product?.sku ?? row.item.id;
      const existing = seen.get(key);
      if (existing) {
        if (!existing.planLabel.includes(row.planLabel)) {
          existing.planLabel += `, ${row.planLabel}`;
        }
      } else {
        const clone = { ...row };
        seen.set(key, clone);
        merged.push(clone);
      }
    }
    return merged;
  }, [rawRows, colConfig.mergeDuplicates]);

  if (!project) return null;

  const toggleCol = (key: keyof ListColumnConfig) =>
    setColConfig((c) => ({ ...c, [key]: !c[key] }));

  const dataColCount = [
    colConfig.showGroups, colConfig.showGroups,
    colConfig.showCategory, colConfig.showVolume, colConfig.showRrp,
    colConfig.showUsRrp, colConfig.showEuRrp, colConfig.showAusRrp,
    colConfig.showRevenue, colConfig.showForecastVolume, colConfig.showForecastRevenue,
  ].filter(Boolean).length;
  const totalCols = 4 + dataColCount + shownLenses.length;

  return (
    <div className="mpl-view">
      <div className="mpl-toolbar">
        <h2 className="mpl-title">Multiplan List</h2>
        <div className="multiplan-shelf-toggle" role="tablist">
          {stagesForToggle.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={shelfSide === s.key}
              className={shelfSide === s.key ? 'active' : ''}
              onClick={() => setMultiplanListShelfSide(s.key)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="mpl-toolbar-actions">
          <div className="toolbar-dropdown-wrapper">
            <button className="toolbar-btn" onClick={() => setShowColMenu(!showColMenu)}>
              Columns ▾
            </button>
            {showColMenu && (
              <div className="toolbar-dropdown mpl-col-dropdown" onMouseLeave={() => setShowColMenu(false)}>
                <div className="dropdown-title">Show columns</div>
                {([
                  ['showGroups', 'X/Y Groups'],
                  ['showCategory', 'Category'],
                  ['showVolume', 'Volume'],
                  ['showRrp', 'UK RRP'],
                  ['showUsRrp', 'US RRP'],
                  ['showEuRrp', 'EU RRP'],
                  ['showAusRrp', 'AUS RRP'],
                  ['showRevenue', 'Revenue'],
                  ['showForecastVolume', 'Forecast Volume'],
                  ['showForecastRevenue', 'Forecast Revenue'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="dropdown-checkbox">
                    <input type="checkbox" checked={colConfig[key]} onChange={() => toggleCol(key)} />
                    <span>{label}</span>
                  </label>
                ))}
                {customLenses.length > 0 && (
                  <>
                    <div className="dropdown-title">Lenses</div>
                    {customLenses.map((l) => {
                      const checked = visibleLensIds === null || visibleLensIds.has(l.id);
                      return (
                        <label key={l.id} className="dropdown-checkbox">
                          <input type="checkbox" checked={checked} onChange={() => toggleLensCol(l.id)} />
                          <span className="mpl-dropdown-lens-swatch" style={{ background: l.color }} />
                          <span>{l.name}</span>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
          <label className="multiplan-show-excluded">
            <input type="checkbox" checked={colConfig.mergeDuplicates} onChange={() => toggleCol('mergeDuplicates')} />
            Merge duplicates
          </label>
          {activeLenses.length > 0 && (
            <label className="multiplan-show-excluded">
              <input type="checkbox" checked={exclusiveLensFilter} onChange={(e) => setExclusiveLensFilter(e.target.checked)} />
              Lens only
            </label>
          )}
          <label className="multiplan-show-excluded">
            <input type="checkbox" checked={showGhosted} onChange={(e) => setShowGhosted(e.target.checked)} />
            Show excluded
          </label>
          <span className="multiplan-toolbar-meta">{rows.length} SKU{rows.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="multiplan-empty">
          <h3>No data</h3>
          <p>Select plans from the <strong>Range Plans</strong> sidebar and ensure products are placed on this stage.</p>
        </div>
      ) : (
        <div className="mpl-scroll">
          <table className="mpl-table">
            <thead>
              <tr>
                <th className="mpl-th-plan">Plan</th>
                {colConfig.showGroups && <th className="mpl-th-grp">Group X</th>}
                {colConfig.showGroups && <th className="mpl-th-grp">Group Y</th>}
                <th className="mpl-th-img" />
                <th className="mpl-th-sku">SKU</th>
                <th className="mpl-th-name">Product</th>
                {colConfig.showCategory && <th className="mpl-th-data">Category</th>}
                {colConfig.showVolume && <th className="mpl-th-num">Volume</th>}
                {colConfig.showRrp && <th className="mpl-th-num">UK RRP</th>}
                {colConfig.showUsRrp && <th className="mpl-th-num">US RRP</th>}
                {colConfig.showEuRrp && <th className="mpl-th-num">EU RRP</th>}
                {colConfig.showAusRrp && <th className="mpl-th-num">AUS RRP</th>}
                {colConfig.showRevenue && <th className="mpl-th-num">Revenue</th>}
                {colConfig.showForecastVolume && <th className="mpl-th-num">Fcst Vol</th>}
                {colConfig.showForecastRevenue && <th className="mpl-th-num">Fcst Rev</th>}
                {shownLenses.map((l) => (
                  <th key={l.id} className="mpl-th-lens" title={l.name}>
                    <span className="mpl-lens-header-text">{l.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const anon = row.product ? anonDisplay(row.product, catalogue) : null;
                const name = row.item.isPlaceholder
                  ? (row.item.placeholderData?.name || row.item.placeholderName || 'Placeholder')
                  : (anon?.name ?? '—');
                const sku = row.product?.sku ?? row.item.placeholderData?.sku ?? '';
                const imgUrl = row.item.isPlaceholder ? row.item.placeholderData?.imageUrl : anon?.imageUrl;
                const isSelected = row.item.id === selectedItemId;

                return (
                  <>
                    {row.planBreak && (
                      <tr key={`break-${row.item.id}`} className="mpl-plan-break">
                        <td colSpan={totalCols} />
                      </tr>
                    )}
                    <tr
                      key={row.item.id}
                      className={`mpl-row ${row.ghosted ? 'ghosted' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedItem(row.item.id)}
                    >
                      <td className="mpl-td-plan">{row.planLabel}</td>
                      {colConfig.showGroups && <td className="mpl-td-grp">{row.matrixCol}</td>}
                      {colConfig.showGroups && <td className="mpl-td-grp">{row.matrixRow}</td>}
                      <td className="mpl-td-img">
                        {imgUrl ? (
                          <img src={imgUrl} alt="" className="mpl-img" />
                        ) : (
                          <span className="mpl-img-ph">{name.charAt(0)}</span>
                        )}
                      </td>
                      <td className="mpl-td-sku">{sku}</td>
                      <td className="mpl-td-name">{name}</td>
                      {colConfig.showCategory && <td className="mpl-td-data">{row.product?.category ?? ''}</td>}
                      {colConfig.showVolume && <td className="mpl-td-num">{(row.product?.volume ?? row.item.placeholderData?.volume ?? 0).toLocaleString()}</td>}
                      {colConfig.showRrp && <td className="mpl-td-num">{row.product?.rrp ?? row.item.placeholderData?.rrp ?? '—'}</td>}
                      {colConfig.showUsRrp && <td className="mpl-td-num">{row.product?.usRrp ?? '—'}</td>}
                      {colConfig.showEuRrp && <td className="mpl-td-num">{row.product?.euRrp ?? '—'}</td>}
                      {colConfig.showAusRrp && <td className="mpl-td-num">{row.product?.ausRrp ?? '—'}</td>}
                      {colConfig.showRevenue && <td className="mpl-td-num">{(row.product?.revenue ?? row.item.placeholderData?.revenue ?? 0).toLocaleString()}</td>}
                      {colConfig.showForecastVolume && <td className="mpl-td-num">{(row.product?.forecastVolume ?? row.item.placeholderData?.forecastVolume ?? 0).toLocaleString()}</td>}
                      {colConfig.showForecastRevenue && <td className="mpl-td-num">{(row.product?.forecastRevenue ?? row.item.placeholderData?.forecastRevenue ?? 0).toLocaleString()}</td>}
                      {shownLenses.map((lens) => {
                        const inLens = row.product ? isProductInLens(lens, row.product, shelfSide) : false;
                        return (
                          <td key={lens.id} className="mpl-td-lens">
                            {inLens && (
                              <span
                                className="mpl-lens-chip"
                                style={{
                                  borderColor: lens.color,
                                  background: lens.color + '25',
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
