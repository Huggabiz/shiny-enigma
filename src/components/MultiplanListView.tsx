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
}

interface ListColumnConfig {
  showVolume: boolean;
  showRrp: boolean;
  showUsRrp: boolean;
  showEuRrp: boolean;
  showAusRrp: boolean;
  showRevenue: boolean;
  showForecastVolume: boolean;
  showForecastRevenue: boolean;
  showCategory: boolean;
  showLenses: boolean;
  mergeDuplicates: boolean;
}

const DEFAULT_COL_CONFIG: ListColumnConfig = {
  showVolume: true,
  showRrp: true,
  showUsRrp: false,
  showEuRrp: false,
  showAusRrp: false,
  showRevenue: false,
  showForecastVolume: false,
  showForecastRevenue: false,
  showCategory: false,
  showLenses: true,
  mergeDuplicates: false,
};

export function MultiplanListView() {
  const {
    project,
    showGhosted,
    setShowGhosted,
    exclusiveLensFilter,
    setExclusiveLensFilter,
    setMultiplanShelfSide,
    setSelectedItem,
    selectedItemId,
  } = useProjectStore();

  const [colConfig, setColConfig] = useState<ListColumnConfig>(DEFAULT_COL_CONFIG);
  const [showColMenu, setShowColMenu] = useState(false);

  const firstPlan = project ? getActivePlan(project) : undefined;
  const stagesForToggle = useMemo(() => {
    const all = firstPlan && project ? getStages(firstPlan, project) : [];
    const vk = project?.visibleStageKeys;
    if (!vk || vk.length === 0) return all;
    const filtered = all.filter((s) => vk.includes(s.key));
    return filtered.length > 0 ? filtered : all;
  }, [firstPlan, project]);

  const multiplanView = project?.multiplanView ?? { shelfSide: 'current' as const, entries: [] };
  const shelfSide = multiplanView.shelfSide;
  const entries = multiplanView.entries;

  const customLenses = useMemo(
    () => (project?.lenses ?? []).filter((l) => !l.builtInKind),
    [project?.lenses],
  );

  const activeLenses = useMemo(() => {
    const ids = project?.activeLensIds ?? [];
    if (ids.length === 0) return [];
    return ids.map((id) => (project?.lenses ?? []).find((l) => l.id === id)).filter((l): l is Lens => !!l);
  }, [project?.activeLensIds, project?.lenses]);

  const catalogue = project?.catalogue ?? [];

  const rawRows = useMemo(() => {
    if (!project) return [];
    const result: ListRow[] = [];

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

        result.push({ product, item, planLabel, matrixRow, matrixCol, ghosted: !isIncluded });
      }
    }
    return result;
  }, [project, entries, shelfSide, showGhosted, exclusiveLensFilter, activeLenses, catalogue]);

  // Optionally merge duplicates by SKU
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
        const clone = { ...row, planLabel: row.planLabel };
        seen.set(key, clone);
        merged.push(clone);
      }
    }
    return merged;
  }, [rawRows, colConfig.mergeDuplicates]);

  // Group by matrixRow label
  const grouped = useMemo(() => {
    const map = new Map<string, ListRow[]>();
    for (const row of rows) {
      const key = row.matrixRow || '(Unassigned)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries());
  }, [rows]);

  if (!project) return null;

  const toggleCol = (key: keyof ListColumnConfig) =>
    setColConfig((c) => ({ ...c, [key]: !c[key] }));

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
              onClick={() => setMultiplanShelfSide(s.key)}
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
                  ['showVolume', 'Volume'],
                  ['showRrp', 'UK RRP'],
                  ['showUsRrp', 'US RRP'],
                  ['showEuRrp', 'EU RRP'],
                  ['showAusRrp', 'AUS RRP'],
                  ['showRevenue', 'Revenue'],
                  ['showForecastVolume', 'Forecast Volume'],
                  ['showForecastRevenue', 'Forecast Revenue'],
                  ['showCategory', 'Category'],
                  ['showLenses', 'Lenses'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="dropdown-checkbox">
                    <input type="checkbox" checked={colConfig[key]} onChange={() => toggleCol(key)} />
                    <span>{label}</span>
                  </label>
                ))}
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
                <th className="mpl-th-group">Section</th>
                <th className="mpl-th-col">Column</th>
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
                {colConfig.showLenses && customLenses.map((l) => (
                  <th key={l.id} className="mpl-th-lens" title={l.name}>
                    <span className="mpl-lens-header-text">{l.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map(([groupLabel, groupRows]) => (
                groupRows.map((row, i) => {
                  const anon = row.product ? anonDisplay(row.product, catalogue) : null;
                  const name = row.item.isPlaceholder
                    ? (row.item.placeholderData?.name || row.item.placeholderName || 'Placeholder')
                    : (anon?.name ?? '—');
                  const sku = row.product?.sku ?? row.item.placeholderData?.sku ?? '';
                  const imgUrl = row.item.isPlaceholder ? row.item.placeholderData?.imageUrl : anon?.imageUrl;
                  const isSelected = row.item.id === selectedItemId;

                  return (
                    <tr
                      key={row.item.id}
                      className={`mpl-row ${row.ghosted ? 'ghosted' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedItem(row.item.id)}
                    >
                      <td className="mpl-td-plan">{row.planLabel}</td>
                      {i === 0 ? (
                        <td className="mpl-td-group" rowSpan={groupRows.length}>{groupLabel}</td>
                      ) : null}
                      <td className="mpl-td-col">{row.matrixCol}</td>
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
                      {colConfig.showLenses && customLenses.map((lens) => {
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
                  );
                })
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
