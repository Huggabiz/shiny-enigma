import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import html2canvas from 'html2canvas';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import { launchAgeYears } from '../utils/launchSeason';
import type { Lens, MatrixCellAssignment, Product, RangePlan, Shelf, ShelfItem } from '../types';
import './AnalyseView.css';

type Metric = 'rrp' | 'revenue' | 'margin';
type AspMode = 'standard' | 'weighted';
type SheetId = 'icicle' | 'scatter' | 'lifecycle' | 'pareto' | 'sunburst';

const SHEETS: { id: SheetId; label: string }[] = [
  { id: 'icicle', label: 'Icicle' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'pareto', label: 'Revenue Rank' },
  { id: 'sunburst', label: 'Sunburst' },
];

interface HierNode {
  name: string;
  value?: number;
  children?: HierNode[];
  productId?: string;
  skuCount?: number;
  totalRevenue?: number;
  weightedRrpSum?: number;
}

function getProductForItem(item: ShelfItem, catalogue: Product[]): Product | null {
  if (item.isPlaceholder && item.placeholderData) return item.placeholderData as unknown as Product;
  return catalogue.find((p) => p.id === item.productId) ?? null;
}

function getSegmentLabel(shelf: Shelf, item: ShelfItem): string {
  const ml = shelf.matrixLayout;
  if (!ml || !ml.assignments || ml.assignments.length === 0) return 'Unsegmented';
  const assignment = ml.assignments.find((a: MatrixCellAssignment) => a.itemId === item.id);
  if (!assignment) return 'Unsegmented';
  const xLabel = ml.xLabels[assignment.col] ?? '';
  const yLabel = ml.yLabels[assignment.row] ?? '';
  if (xLabel && yLabel) return `${yLabel} / ${xLabel}`;
  return xLabel || yLabel || 'Unsegmented';
}

function resolveShelf(plan: RangePlan, shelfSide: string): Shelf | undefined {
  if (shelfSide === 'current') return plan.currentShelf;
  if (shelfSide === 'future') return plan.futureShelf;
  const stageId = shelfSide.replace('stage-', '');
  const entry = (plan.intermediateShelves ?? []).find((s) => s.stageId === stageId);
  return entry?.shelf;
}

function metricValue(prod: Product, metric: Metric): number {
  if (metric === 'rrp') return prod.rrp ?? 0;
  if (metric === 'margin') return prod.operatingMarginGbp ?? 0;
  return prod.revenue ?? 0;
}

function buildHierarchyData(plans: RangePlan[], catalogue: Product[], metric: Metric, shelfSide: string, showSegments: boolean): HierNode {
  return showSegments ? buildWith(plans, catalogue, metric, shelfSide) : buildWithout(plans, catalogue, metric, shelfSide);
}

function buildWith(plans: RangePlan[], catalogue: Product[], metric: Metric, shelfSide: string): HierNode {
  const catMap = new Map<string, Map<string, Map<string, { name: string; sku: string; value: number; productId: string; revenue: number }[]>>>();
  for (const plan of plans) {
    const shelf = resolveShelf(plan, shelfSide); if (!shelf) continue;
    for (const item of shelf.items) {
      const prod = getProductForItem(item, catalogue); if (!prod) continue;
      const cat = prod.category || 'Uncategorised', seg = getSegmentLabel(shelf, item), val = metricValue(prod, metric);
      if (val <= 0) continue;
      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const pm = catMap.get(cat)!; if (!pm.has(plan.name)) pm.set(plan.name, new Map());
      const sm = pm.get(plan.name)!; if (!sm.has(seg)) sm.set(seg, []);
      sm.get(seg)!.push({ name: prod.name, sku: prod.sku, value: val, productId: prod.id, revenue: prod.revenue ?? 0 });
    }
  }
  const children: HierNode[] = [];
  for (const [cat, pm] of catMap) {
    const pc: HierNode[] = []; let csc = 0, cr = 0, cw = 0;
    for (const [pn, sm] of pm) {
      const sc: HierNode[] = []; let psc = 0, pr = 0, pw = 0;
      for (const [seg, skus] of sm) {
        const sr = skus.reduce((s, x) => s + x.revenue, 0), sw = skus.reduce((s, x) => s + x.value * x.revenue, 0);
        sc.push({ name: seg, children: skus.map((s) => ({ name: `${s.sku} — ${s.name}`, value: s.value, productId: s.productId, skuCount: 1, totalRevenue: s.revenue, weightedRrpSum: s.value * s.revenue })), skuCount: skus.length, totalRevenue: sr, weightedRrpSum: sw });
        psc += skus.length; pr += sr; pw += sw;
      }
      pc.push({ name: pn, children: sc, skuCount: psc, totalRevenue: pr, weightedRrpSum: pw }); csc += psc; cr += pr; cw += pw;
    }
    children.push({ name: cat, children: pc, skuCount: csc, totalRevenue: cr, weightedRrpSum: cw });
  }
  return { name: 'All', children };
}

function buildWithout(plans: RangePlan[], catalogue: Product[], metric: Metric, shelfSide: string): HierNode {
  const catMap = new Map<string, Map<string, { name: string; sku: string; value: number; productId: string; revenue: number }[]>>();
  for (const plan of plans) {
    const shelf = resolveShelf(plan, shelfSide); if (!shelf) continue;
    for (const item of shelf.items) {
      const prod = getProductForItem(item, catalogue); if (!prod) continue;
      const cat = prod.category || 'Uncategorised', val = metricValue(prod, metric);
      if (val <= 0) continue;
      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const pm = catMap.get(cat)!; if (!pm.has(plan.name)) pm.set(plan.name, []);
      pm.get(plan.name)!.push({ name: prod.name, sku: prod.sku, value: val, productId: prod.id, revenue: prod.revenue ?? 0 });
    }
  }
  const children: HierNode[] = [];
  for (const [cat, pm] of catMap) {
    const pc: HierNode[] = []; let csc = 0, cr = 0, cw = 0;
    for (const [pn, skus] of pm) {
      const pr = skus.reduce((s, x) => s + x.revenue, 0), pw = skus.reduce((s, x) => s + x.value * x.revenue, 0);
      pc.push({ name: pn, children: skus.map((s) => ({ name: `${s.sku} — ${s.name}`, value: s.value, productId: s.productId, skuCount: 1, totalRevenue: s.revenue, weightedRrpSum: s.value * s.revenue })), skuCount: skus.length, totalRevenue: pr, weightedRrpSum: pw });
      csc += skus.length; cr += pr; cw += pw;
    }
    children.push({ name: cat, children: pc, skuCount: csc, totalRevenue: cr, weightedRrpSum: cw });
  }
  return { name: 'All', children };
}

const RING_COLORS = [
  ['#1976d2', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9'],  // blue
  ['#388e3c', '#43a047', '#66bb6a', '#81c784', '#a5d6a7'],  // green
  ['#f57c00', '#fb8c00', '#ffa726', '#ffb74d', '#ffcc80'],  // orange
  ['#7b1fa2', '#8e24aa', '#ab47bc', '#ba68c8', '#ce93d8'],  // purple
  ['#c62828', '#d32f2f', '#e53935', '#ef5350', '#ef9a9a'],  // red
  ['#00838f', '#0097a7', '#00acc1', '#26c6da', '#4dd0e1'],  // teal
  ['#e91e63', '#ec407a', '#f06292', '#f48fb1', '#f8bbd0'],  // pink
  ['#827717', '#9e9d24', '#c0ca33', '#d4e157', '#e6ee9c'],  // lime
  ['#4527a0', '#512da8', '#7e57c2', '#9575cd', '#b39ddb'],  // deep purple
  ['#bf360c', '#d84315', '#f4511e', '#ff7043', '#ff8a65'],  // deep orange
];

const PALETTE_BASES = RING_COLORS.map((p) => p[0]);

function paletteIndexForBase(base: string): number {
  const idx = PALETTE_BASES.indexOf(base);
  return idx >= 0 ? idx : 0;
}

function getCategoryColorFromMap(node: d3.HierarchyNode<HierNode>, catColors: Map<string, string>): string {
  let a = node; while (a.depth > 1 && a.parent) a = a.parent;
  const base = catColors.get(a.data.name) ?? PALETTE_BASES[0];
  const pi = paletteIndexForBase(base);
  const p = RING_COLORS[pi];
  return p[Math.min(node.depth - 1, p.length - 1)];
}

function assignCategoryColors(
  categories: string[],
  stored: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  const usedIndices = new Set<number>();
  for (const cat of categories) {
    if (stored[cat]) {
      map.set(cat, stored[cat]);
      const idx = PALETTE_BASES.indexOf(stored[cat]);
      if (idx >= 0) usedIndices.add(idx);
    }
  }
  let nextIdx = 0;
  for (const cat of categories) {
    if (map.has(cat)) continue;
    while (usedIndices.has(nextIdx) && nextIdx < PALETTE_BASES.length) nextIdx++;
    const idx = nextIdx < PALETTE_BASES.length ? nextIdx : (nextIdx % PALETTE_BASES.length);
    map.set(cat, PALETTE_BASES[idx]);
    usedIndices.add(idx);
    nextIdx++;
  }
  return map;
}

function fmtVal(v: number, metric: Metric): string {
  if (metric === 'rrp') return `£${v.toFixed(2)}`;
  if (v >= 1e6) return `£${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `£${(v / 1e3).toFixed(0)}K`;
  return `£${v.toFixed(0)}`;
}

function fmtMetric(value: number, metric: Metric, isLeaf: boolean, sc: number, asp: AspMode, rev: number, wrr: number): string {
  if (metric === 'revenue' || metric === 'margin') return fmtVal(value, 'revenue');
  if (isLeaf) return `£${value.toFixed(2)}`;
  if (sc > 0) {
    if (asp === 'weighted' && rev > 0) return `wASP £${(wrr / rev).toFixed(2)}`;
    return `ASP £${(value / sc).toFixed(2)}`;
  }
  return fmtVal(value, 'rrp');
}

interface ChartProps { plans: RangePlan[]; catalogue: Product[]; metric: Metric; shelfSide: string; activeLens?: Lens | null; aspMode: AspMode; showSegments: boolean; catColors: Map<string, string>; }

// Per-sheet config state that persists across tab switches
interface IcicleConfig { metric: Metric; aspMode: AspMode; showSegments: boolean; }
interface ScatterConfig { logX: boolean; logY: boolean; maxX: string; maxY: string; dotSize: number; contours: boolean; xAxis: 'margin' | 'revenue'; ageShade: boolean; }

const DEFAULT_ICICLE: IcicleConfig = { metric: 'revenue', aspMode: 'standard', showSegments: true };
const DEFAULT_SCATTER: ScatterConfig = { logX: false, logY: false, maxX: '', maxY: '', dotSize: 5, contours: false, xAxis: 'margin', ageShade: true };

export function AnalyseView() {
  const { project, clearAnalyseEntries, setAnalyseConfig } = useProjectStore();

  const av = project?.analyseView;
  const [shelfSide, setShelfSide] = useState('current');
  const [activeSheet, setActiveSheet] = useState<SheetId>((av?.activeSheet as SheetId) || 'icicle');

  const [icicleConfig, setIcicleConfig] = useState<IcicleConfig>(() => ({
    ...DEFAULT_ICICLE,
    ...(av?.icicleConfig?.metric && { metric: av.icicleConfig.metric as Metric }),
    ...(av?.icicleConfig?.aspMode && { aspMode: av.icicleConfig.aspMode as AspMode }),
    ...(av?.icicleConfig?.showSegments != null && { showSegments: av.icicleConfig.showSegments }),
  }));
  const [scatterConfig, setScatterConfig] = useState<ScatterConfig>(() => ({
    ...DEFAULT_SCATTER,
    ...av?.scatterConfig,
  }));
  // Sunburst reuses icicle config for metric

  const analyseView = project?.analyseView ?? { entries: [] };
  const entries = analyseView.entries;

  const selectedPlans = useMemo(() => {
    if (!project) return [];
    return entries.map((e) => project.plans.find((p) => p.id === e.planId)).filter((p): p is RangePlan => p != null);
  }, [entries, project]);

  const activeLens = useMemo(() => {
    const ids = project?.activeLensIds ?? [];
    if (ids.length === 0) return null;
    return (project?.lenses ?? []).find((l) => l.id === ids[0]) ?? null;
  }, [project?.activeLensIds, project?.lenses]);

  const firstPlan = project ? getActivePlan(project) : undefined;
  const stagesForToggle = useMemo(() => {
    const all = firstPlan && project ? getStages(firstPlan, project) : [];
    const vk = project?.visibleStageKeys;
    if (!vk || vk.length === 0) return all;
    const f = all.filter((s) => vk.includes(s.key));
    return f.length > 0 ? f : all;
  }, [firstPlan, project]);

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const plan of selectedPlans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, project?.catalogue ?? []);
        if (prod) cats.add(prod.category || 'Uncategorised');
      }
    }
    return Array.from(cats).sort();
  }, [selectedPlans, shelfSide, project?.catalogue]);

  const storedColors = av?.categoryColors ?? {};
  const catColors = useMemo(() => assignCategoryColors(allCategories, storedColors), [allCategories, storedColors]);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [growthPct, setGrowthPct] = useState(5);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [snipStatus, setSnipStatus] = useState<string | null>(null);

  const handleSnip = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setSnipStatus('Capturing...');
      const canvas = await html2canvas(canvasRef.current, { backgroundColor: '#ffffff', scale: 2 });
      canvas.toBlob(async (blob) => {
        if (!blob) { setSnipStatus('Failed'); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setSnipStatus('Copied!');
        } catch { setSnipStatus('Failed'); }
        setTimeout(() => setSnipStatus(null), 1500);
      }, 'image/png');
    } catch { setSnipStatus('Failed'); setTimeout(() => setSnipStatus(null), 1500); }
  }, []);

  const scatterVisiblePoints = useMemo(() => {
    if (activeSheet !== 'scatter') return [];
    const seen = new Set<string>();
    const pts: { rrp: number; margin: number; revenue: number; category: string }[] = [];
    const xField = scatterConfig.xAxis ?? 'margin';
    for (const plan of selectedPlans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, project?.catalogue ?? []);
        if (!prod || seen.has(prod.id)) continue;
        seen.add(prod.id);
        const cat = prod.category || 'Uncategorised';
        if (hiddenCats.has(cat)) continue;
        const rrp = prod.rrp ?? 0, margin = prod.operatingMarginGbp ?? 0, revenue = prod.revenue ?? 0;
        const xVal = xField === 'revenue' ? revenue : margin;
        if (rrp <= 0 && xVal === 0) continue;
        if (scatterConfig.logX && xVal <= 0) continue;
        if (scatterConfig.logY && rrp <= 0) continue;
        pts.push({ rrp, margin, revenue, category: cat });
      }
    }
    return pts;
  }, [activeSheet, selectedPlans, shelfSide, project?.catalogue, hiddenCats, scatterConfig.logX, scatterConfig.logY]);

  const setCatColor = useCallback((cat: string, color: string) => {
    const updated = { ...storedColors, [cat]: color };
    setAnalyseConfig({ categoryColors: updated });
  }, [storedColors, setAnalyseConfig]);

  if (!project) return null;

  const chartProps: ChartProps = {
    plans: selectedPlans, catalogue: project.catalogue,
    metric: icicleConfig.metric, shelfSide, activeLens,
    aspMode: icicleConfig.aspMode, showSegments: icicleConfig.showSegments,
    catColors,
  };

  const updateIcicle = (patch: Partial<IcicleConfig>) => {
    setIcicleConfig((c) => {
      const next = { ...c, ...patch };
      setAnalyseConfig({ icicleConfig: next });
      return next;
    });
  };
  const updateScatter = (patch: Partial<ScatterConfig>) => {
    setScatterConfig((c) => {
      const next = { ...c, ...patch };
      setAnalyseConfig({ scatterConfig: next });
      return next;
    });
  };

  return (
    <div className="analyse-view">
      <div className="analyse-toolbar">
        <h2 className="analyse-title">Analyse</h2>
        <div className="analyse-metric-toggle" role="tablist">
          {stagesForToggle.map((s) => (
            <button key={s.key} role="tab" aria-selected={shelfSide === s.key} className={shelfSide === s.key ? 'active' : ''} onClick={() => setShelfSide(s.key)}>{s.name}</button>
          ))}
        </div>
        <div className="analyse-toolbar-actions">
          {activeLens && (
            <span className="analyse-toolbar-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: activeLens.color, display: 'inline-block' }} />
              {activeLens.name}
            </span>
          )}
          {allCategories.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button className="analyse-clear" style={{ color: '#1976d2', borderColor: '#bbdefb' }} onClick={() => setShowColorPicker((v) => !v)}>Colors</button>
              {showColorPicker && (
                <div className="analyse-color-picker">
                  {allCategories.map((cat) => {
                    const current = catColors.get(cat) ?? PALETTE_BASES[0];
                    return (
                      <div key={cat} className="analyse-color-row">
                        <span className="analyse-color-swatch" style={{ background: current }} />
                        <span className="analyse-color-cat">{cat}</span>
                        <div className="analyse-color-options">
                          {PALETTE_BASES.map((base, i) => (
                            <button key={i} className={`analyse-color-option ${base === current ? 'selected' : ''}`} style={{ background: base }} onClick={() => setCatColor(cat, base)} title={`Palette ${i + 1}`} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <span className="analyse-toolbar-meta">{selectedPlans.length} plan{selectedPlans.length === 1 ? '' : 's'}</span>
          {entries.length > 0 && (
            <button className="analyse-clear" onClick={() => { if (confirm('Clear all selected plans from analyse view?')) clearAnalyseEntries(); }}>Clear</button>
          )}
        </div>
      </div>

      {selectedPlans.length === 0 ? (
        <div className="analyse-empty">
          <h3>No plans selected</h3>
          <p>Tick the checkboxes in the <strong>Range Plans</strong> sidebar on the left to add plans to the analysis.</p>
        </div>
      ) : (
        <div className="analyse-body">
          <div className="analyse-canvas-wrapper">
            <div className="analyse-canvas-area">
              <div className="analyse-canvas" ref={canvasRef}>
                {activeSheet === 'icicle' ? <Icicle {...chartProps} /> : activeSheet === 'scatter' ? <ScatterPlot plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} config={scatterConfig} catColors={catColors} hiddenCats={hiddenCats} onToggleCat={(cat) => setHiddenCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} /> : activeSheet === 'lifecycle' ? <LifecycleChart plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} hiddenCats={hiddenCats} onToggleCat={(cat) => setHiddenCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} /> : activeSheet === 'pareto' ? <ParetoChart plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} hiddenCats={hiddenCats} onToggleCat={(cat) => setHiddenCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} /> : <Sunburst {...chartProps} />}
              </div>
              {activeSheet === 'scatter' && <ScatterStats points={scatterVisiblePoints} growthPct={growthPct} onGrowthChange={setGrowthPct} catColors={catColors} />}
            </div>
          </div>

          {/* Per-chart config bar */}
          {(activeSheet === 'icicle' || activeSheet === 'sunburst') && (
            <div className="analyse-chart-config">
              <div className="analyse-metric-toggle" role="tablist">
                <button role="tab" className={icicleConfig.metric === 'revenue' ? 'active' : ''} onClick={() => updateIcicle({ metric: 'revenue' })}>Revenue</button>
                <button role="tab" className={icicleConfig.metric === 'rrp' ? 'active' : ''} onClick={() => updateIcicle({ metric: 'rrp' })}>RRP</button>
                <button role="tab" className={icicleConfig.metric === 'margin' ? 'active' : ''} onClick={() => updateIcicle({ metric: 'margin' })}>OM £</button>
              </div>
              {icicleConfig.metric === 'rrp' && (
                <div className="analyse-metric-toggle" role="tablist">
                  <button role="tab" className={icicleConfig.aspMode === 'standard' ? 'active' : ''} onClick={() => updateIcicle({ aspMode: 'standard' })}>ASP</button>
                  <button role="tab" className={icicleConfig.aspMode === 'weighted' ? 'active' : ''} onClick={() => updateIcicle({ aspMode: 'weighted' })}>Weighted ASP</button>
                </div>
              )}
              {activeSheet === 'icicle' && (
                <label className="analyse-config-item" title="Show matrix segment column">
                  <input type="checkbox" checked={icicleConfig.showSegments} onChange={(e) => updateIcicle({ showSegments: e.target.checked })} />
                  Segments
                </label>
              )}
              <span style={{ flex: 1 }} />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}
          {activeSheet === 'scatter' && (
            <div className="analyse-chart-config">
              <div className="analyse-metric-toggle" role="tablist">
                <button role="tab" className={(scatterConfig.xAxis ?? 'margin') === 'margin' ? 'active' : ''} onClick={() => updateScatter({ xAxis: 'margin' })}>OM £</button>
                <button role="tab" className={(scatterConfig.xAxis ?? 'margin') === 'revenue' ? 'active' : ''} onClick={() => updateScatter({ xAxis: 'revenue' })}>Revenue</button>
              </div>
              <div className="analyse-config-separator" />
              <label className="analyse-config-item"><input type="checkbox" checked={scatterConfig.logX} onChange={(e) => updateScatter({ logX: e.target.checked })} /> Log X</label>
              <label className="analyse-config-item"><input type="checkbox" checked={scatterConfig.logY} onChange={(e) => updateScatter({ logY: e.target.checked })} /> Log Y</label>
              <div className="analyse-config-separator" />
              <label className="analyse-config-item">X max <input type="number" className="analyse-config-input" value={scatterConfig.maxX} onChange={(e) => updateScatter({ maxX: e.target.value })} placeholder="auto" /></label>
              <label className="analyse-config-item">Y max <input type="number" className="analyse-config-input" value={scatterConfig.maxY} onChange={(e) => updateScatter({ maxY: e.target.value })} placeholder="auto" /></label>
              <div className="analyse-config-separator" />
              <label className="analyse-config-item">Dot size
                <input type="range" min="2" max="12" step="1" value={scatterConfig.dotSize} onChange={(e) => updateScatter({ dotSize: Number(e.target.value) })} style={{ width: 60, height: 12 }} />
                <span>{scatterConfig.dotSize}</span>
              </label>
              <div className="analyse-config-separator" />
              <label className="analyse-config-item"><input type="checkbox" checked={scatterConfig.contours} onChange={(e) => updateScatter({ contours: e.target.checked })} /> Contours</label>
              <label className="analyse-config-item" title="Colour dots by launch age: new = light, richest at ~3 years, washing out beyond"><input type="checkbox" checked={scatterConfig.ageShade ?? true} onChange={(e) => updateScatter({ ageShade: e.target.checked })} /> Age shading</label>
              <span style={{ flex: 1 }} />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}
          {activeSheet === 'lifecycle' && (
            <div className="analyse-chart-config">
              <span className="analyse-config-item" style={{ cursor: 'default' }}>Avg OM (£) per SKU by launch-age bucket — click legend entries to isolate categories; hover points for SKU counts</span>
              <span style={{ flex: 1 }} />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}
          {activeSheet === 'pareto' && (
            <div className="analyse-chart-config">
              <span className="analyse-config-item" style={{ cursor: 'default' }}>SKUs ranked by revenue — dashed line is cumulative share; click legend entries to isolate categories</span>
              <span style={{ flex: 1 }} />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}

          <div className="analyse-sheet-tabs">
            {SHEETS.map((s) => (
              <button key={s.id} className={`analyse-sheet-tab ${activeSheet === s.id ? 'active' : ''}`} onClick={() => { setActiveSheet(s.id); setAnalyseConfig({ activeSheet: s.id }); }}>{s.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- shared ----------

function useMeasure() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 450 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect(); observerRef.current = null;
    if (!el) return;
    (wrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    const u = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setDims({ width: r.width, height: r.height }); };
    u(); const obs = new ResizeObserver(u); obs.observe(el); observerRef.current = obs;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return { wrapperRef, dims, measureRef };
}

interface TooltipState { x: number; y: number; label: string; value: string; depth: string }

function ChartTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  return (
    <div className={`analyse-tooltip ${tooltip ? 'visible' : ''}`} style={tooltip ? { left: tooltip.x, top: tooltip.y } : undefined}>
      {tooltip && (<>{tooltip.depth && <div className="analyse-tooltip-value">{tooltip.depth}</div>}<div className="analyse-tooltip-label">{tooltip.label}</div><div className="analyse-tooltip-value">{tooltip.value}</div></>)}
    </div>
  );
}

// ---------- Sunburst ----------

function Sunburst({ plans, catalogue, metric, shelfSide, showSegments, catColors }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide, showSegments), [plans, catalogue, metric, shelfSide, showSegments]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const { width, height } = dims;
    const radius = Math.min(width, height) / 2 * 0.85;
    const root = d3.hierarchy<HierNode>(data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if (!root.children || root.children.length === 0) return;
    const part = d3.partition<HierNode>().size([2 * Math.PI, radius])(root) as d3.HierarchyRectangularNode<HierNode>;
    const arc = d3.arc<d3.HierarchyRectangularNode<HierNode>>().startAngle((d) => d.x0).endAngle((d) => d.x1).padAngle(0.002).padRadius(radius / 2).innerRadius((d) => d.y0).outerRadius((d) => d.y1 - 1);
    const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    type RN = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (part.descendants() as RN[]).filter((d) => d.depth > 0);
    const dn = showSegments ? ['', 'Category', 'Plan', 'Segment', 'SKU'] : ['', 'Category', 'Plan', 'SKU'];
    g.selectAll('path').data(nodes).join('path').attr('d', arc as any).attr('fill', (d) => getCategoryColorFromMap(d, catColors)).attr('fill-opacity', (d) => 1 - d.depth * 0.08).attr('stroke', '#fff').attr('stroke-width', 0.5).style('cursor', 'pointer')
      .on('mouseenter', function (ev, d) { d3.select(this).attr('fill-opacity', 1); const r = wrapperRef.current?.getBoundingClientRect(); if (r) setTooltip({ x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8, label: d.data.name, value: fmtVal(d.value ?? 0, metric), depth: dn[d.depth] ?? '' }); })
      .on('mousemove', function (ev) { const r = wrapperRef.current?.getBoundingClientRect(); if (r) setTooltip((p) => p ? { ...p, x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8 } : null); })
      .on('mouseleave', function (_, d) { d3.select(this).attr('fill-opacity', 1 - d.depth * 0.08); setTooltip(null); });
    g.selectAll('text.cat-label').data(nodes.filter((d) => d.depth === 1 && (d.x1 - d.x0) > 0.15)).join('text').attr('class', 'cat-label')
      .attr('transform', (d) => { const a = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90, r = (d.y0 + d.y1) / 2; return `rotate(${a}) translate(${r},0) rotate(${a > 90 ? 180 : 0})`; })
      .attr('text-anchor', 'middle').attr('dy', '0.35em').attr('font-size', '10px').attr('font-weight', '700').attr('fill', '#fff')
      .text((d) => { const m = Math.floor(((d.x1 - d.x0) * (d.y0 + d.y1) / 2) / 6); return d.data.name.length > m ? d.data.name.slice(0, m - 1) + '…' : d.data.name; });
    g.selectAll('text.plan-label').data(nodes.filter((d) => d.depth === 2 && (d.x1 - d.x0) > 0.2)).join('text').attr('class', 'plan-label')
      .attr('transform', (d) => { const a = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90, r = (d.y0 + d.y1) / 2; return `rotate(${a}) translate(${r},0) rotate(${a > 90 ? 180 : 0})`; })
      .attr('text-anchor', 'middle').attr('dy', '0.35em').attr('font-size', '9px').attr('font-weight', '600').attr('fill', '#fff')
      .text((d) => { const m = Math.floor(((d.x1 - d.x0) * (d.y0 + d.y1) / 2) / 5.5); return d.data.name.length > m ? d.data.name.slice(0, m - 1) + '…' : d.data.name; });
  }, [data, dims, metric, wrapperRef, showSegments, catColors]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
}

// ---------- Icicle ----------

const ICICLE_COLS_SEG = [0.10, 0.10, 0.20, 0.20];
const ICICLE_COLS_NO  = [0.12, 0.12, 0.20];

function getSkuCount(n: d3.HierarchyNode<HierNode>): number { return n.data.skuCount ?? n.leaves().length; }

function isInLens(n: d3.HierarchyNode<HierNode>, lens: Lens, sk: string): boolean {
  if (!n.data.productId || lens.builtInKind) return false;
  if (lens.scope === 'per-stage') return lens.stageProductIds?.[sk]?.includes(n.data.productId) ?? false;
  return lens.productIds.includes(n.data.productId);
}

function Icicle({ plans, catalogue, metric, shelfSide, activeLens, aspMode, showSegments, catColors }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide, showSegments), [plans, catalogue, metric, shelfSide, showSegments]);
  const cw = showSegments ? ICICLE_COLS_SEG : ICICLE_COLS_NO;
  const md = cw.length;
  const dl = showSegments ? ['', 'Category', 'Plan', 'Segment', 'SKU'] : ['', 'Category', 'Plan', 'SKU'];

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const { width, height } = dims;
    const margin = { top: 8, right: 4, bottom: 4, left: 4 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    const root = d3.hierarchy<HierNode>(data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if (!root.children || root.children.length === 0) return;
    const part = d3.partition<HierNode>().size([iH, iW]).padding(1)(root);
    const cs = [0]; for (let i = 0; i < cw.length; i++) cs.push(cs[i] + cw[i] * iW);
    type RN = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (part.descendants() as RN[]).filter((d) => d.depth > 0 && d.depth <= md);
    for (const n of nodes) { const di = n.depth - 1; if (di < cw.length) { n.y0 = cs[di]; n.y1 = cs[di + 1]; } }
    const leaf = md;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    g.selectAll('rect').data(nodes).join('rect')
      .attr('x', (d) => d.y0).attr('y', (d) => d.x0).attr('width', (d) => Math.max(0, d.y1 - d.y0 - 1)).attr('height', (d) => Math.max(0, d.x1 - d.x0))
      .attr('fill', (d) => (d.depth === leaf && activeLens && isInLens(d, activeLens, shelfSide)) ? activeLens.color : getCategoryColorFromMap(d, catColors))
      .attr('fill-opacity', (d) => (d.depth === leaf && activeLens && isInLens(d, activeLens, shelfSide)) ? 0.85 : 1 - d.depth * 0.06)
      .attr('rx', 2).style('cursor', 'pointer')
      .on('mouseenter', function (ev, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#333').attr('stroke-width', 1);
        const r = wrapperRef.current?.getBoundingClientRect(); if (!r) return;
        const sc = getSkuCount(d), ms = fmtMetric(d.value ?? 0, metric, d.depth === leaf, sc, aspMode, d.data.totalRevenue ?? 0, d.data.weightedRrpSum ?? 0);
        setTooltip({ x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8, label: d.data.name, value: ms + (sc > 1 ? ` (${sc} SKUs)` : ''), depth: dl[d.depth] ?? '' });
      })
      .on('mousemove', function (ev) { const r = wrapperRef.current?.getBoundingClientRect(); if (r) setTooltip((p) => p ? { ...p, x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8 } : null); })
      .on('mouseleave', function (_, d) { d3.select(this).attr('fill-opacity', (d.depth === leaf && activeLens && isInLens(d, activeLens, shelfSide)) ? 0.85 : 1 - d.depth * 0.06).attr('stroke', 'none'); setTooltip(null); });

    const lg = g.selectAll<SVGGElement, RN>('g.il').data(nodes.filter((d) => (d.x1 - d.x0) > 13)).join('g').attr('class', 'il').attr('transform', (d) => `translate(${d.y0 + 4},${d.x0 + 2})`);
    lg.each(function (d) {
      const gr = d3.select(this), cW = d.y1 - d.y0 - 8, cH = d.x1 - d.x0 - 4;
      if (cW < 10 || cH < 10) return;
      const fs = d.depth <= 2 ? 9 : 8, chW = fs * 0.55, lH = fs + 2, mxC = Math.max(2, Math.floor(cW / chW));
      const words = d.data.name.split(/\s+/), lines: string[] = []; let cur = '';
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (t.length <= mxC) cur = t; else { if (cur) lines.push(cur); cur = w.length > mxC ? w.slice(0, mxC - 1) + '…' : w; } }
      if (cur) lines.push(cur);
      const sc = getSkuCount(d), mt = fmtMetric(d.value ?? 0, metric, d.depth === leaf, sc, aspMode, d.data.totalRevenue ?? 0, d.data.weightedRrpSum ?? 0);
      const fits = (lines.length + 1) * lH <= cH, mxL = Math.max(1, Math.floor((cH - lH) / lH));
      const vis = fits ? lines : lines.slice(0, mxL);
      if (!fits && vis.length > 0) vis[vis.length - 1] = vis[vis.length - 1].slice(0, Math.max(1, vis[vis.length - 1].length - 1)) + '…';
      const dk = d.depth <= 2;
      vis.forEach((l, i) => { gr.append('text').attr('x', 0).attr('y', i * lH + lH * 0.75).attr('font-size', `${fs}px`).attr('font-weight', d.depth === 1 ? '700' : '600').attr('fill', dk ? '#fff' : '#333').text(l); });
      const my = vis.length * lH + lH * 0.75;
      if (my + 2 < cH) gr.append('text').attr('x', 0).attr('y', my).attr('font-size', `${Math.max(7, fs - 1)}px`).attr('font-weight', '400').attr('fill', dk ? 'rgba(255,255,255,0.8)' : '#555').text(mt.length > mxC ? mt.slice(0, mxC - 1) + '…' : mt);
    });
  }, [data, dims, metric, wrapperRef, activeLens, shelfSide, aspMode, cw, md, dl, catColors]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
}

// ---------- Scatter ----------

// ---------- Scatter ----------

interface ScatterPoint { sku: string; name: string; category: string; subCategory: string; rrp: number; margin: number; revenue: number; launchSeason?: string; launchAge: number | null; }

/** Lifecycle colour ramp for launch age:
 *  - new products: the category colour, intense but LIGHT (interpolated
 *    towards white), darkening as they mature
 *  - richest, fully-saturated colour at ~3 years
 *  - beyond 3 years: progressively desaturating towards grey over the
 *    following 5 years (legacy products wash out)
 *  - unparseable/missing launch season: the plain category colour. */
function ageShadedColor(base: string, age: number | null): string {
  if (age == null) return base;
  const a = Math.max(0, age);
  // Endpoints chosen for a WIDE luminance span so the differential is
  // obvious at dot size: brand new = strong pastel tint of the
  // category colour; 3 years = the richest, slightly deepened base.
  const rich = d3.interpolateLab(base, '#000000')(0.18);
  if (a <= 3) {
    const light = d3.interpolateLab(base, '#ffffff')(0.72);
    return d3.interpolateLab(light, rich)(a / 3);
  }
  // Legacy: wash out to grey quickly — fully washed by ~6 years.
  const over = Math.min((a - 3) / 3, 1);
  const c = d3.hsl(rich);
  c.s = c.s * (1 - 0.85 * over);
  c.l = c.l + (0.62 - c.l) * 0.8 * over;
  return c.formatHex();
}

function ScatterPlot({ plans, catalogue, shelfSide, config, catColors, hiddenCats, onToggleCat }: { plans: RangePlan[]; catalogue: Product[]; shelfSide: string; config: ScatterConfig; catColors: Map<string, string>; hiddenCats: Set<string>; onToggleCat: (cat: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const points = useMemo(() => {
    const seen = new Set<string>(), pts: ScatterPoint[] = [];
    for (const plan of plans) { const shelf = resolveShelf(plan, shelfSide); if (!shelf) continue;
      for (const item of shelf.items) { const prod = getProductForItem(item, catalogue); if (!prod || seen.has(prod.id)) continue; seen.add(prod.id);
        const rrp = prod.rrp ?? 0, margin = prod.operatingMarginGbp ?? 0, revenue = prod.revenue ?? 0;
        if (rrp <= 0 && margin === 0 && revenue === 0) continue;
        pts.push({
          sku: prod.sku, name: prod.name, category: prod.category || 'Uncategorised', subCategory: prod.subCategory || '',
          rrp, margin, revenue,
          launchSeason: prod.launchSeason, launchAge: launchAgeYears(prod.launchSeason),
        });
      }
    } return pts;
  }, [plans, catalogue, shelfSide]);

  const categories = useMemo(() => { const m = new Map<string, Set<string>>(); for (const p of points) { if (!m.has(p.category)) m.set(p.category, new Set()); if (p.subCategory) m.get(p.category)!.add(p.subCategory); } return m; }, [points]);

  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [cat, subs] of categories) {
      const b = catColors.get(cat) ?? PALETTE_BASES[0]; m.set(cat, b);
      Array.from(subs).forEach((sub, si, arr) => { m.set(`${cat}::${sub}`, d3.interpolateLab(b, '#fff')(0.15 + (si / Math.max(1, arr.length)) * 0.35)); });
    } return m;
  }, [categories, catColors]);

  const { logX, logY, dotSize, contours, xAxis: xField, ageShade } = config;
  const xAccessor = (d: ScatterPoint) => xField === 'revenue' ? d.revenue : d.margin;
  const xLabel = xField === 'revenue' ? 'Revenue (£)' : 'Operating Margin (£)';
  const maxXN = config.maxX ? Number(config.maxX) : undefined;
  const maxYN = config.maxY ? Number(config.maxY) : undefined;

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const { width, height } = dims;
    const margin = { top: 12, right: 12, bottom: 52, left: 60 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20 || points.length === 0) return;

    const xE = d3.extent(points, xAccessor) as [number, number];
    const yE = d3.extent(points, (p) => p.rrp) as [number, number];
    const xMax = (maxXN != null && maxXN > 0) ? maxXN : xE[1];
    const yMax = (maxYN != null && maxYN > 0) ? maxYN : yE[1];

    let xScale: d3.ScaleLogarithmic<number, number> | d3.ScaleLinear<number, number>;
    let yScale: d3.ScaleLogarithmic<number, number> | d3.ScaleLinear<number, number>;
    if (logX) { const lo = Math.max(1, Math.min(...points.map(xAccessor).filter((v) => v > 0))); xScale = d3.scaleLog().domain([lo * 0.8, xMax * 1.05]).range([0, iW]).clamp(true); }
    else { const p = (xMax - xE[0]) * 0.05 || 1; xScale = d3.scaleLinear().domain([xE[0] - p, xMax + p]).range([0, iW]); }
    if (logY) { const lo = Math.max(0.01, Math.min(...points.map((p) => p.rrp).filter((v) => v > 0))); yScale = d3.scaleLog().domain([lo * 0.8, yMax * 1.05]).range([iH, 0]).clamp(true); }
    else { const p = (yMax - yE[0]) * 0.05 || 1; yScale = d3.scaleLinear().domain([yE[0] - p, yMax + p]).range([iH, 0]); }

    const fmtK = (d: d3.NumberValue) => { const v = +d; if (Math.abs(v) >= 1e6) return `£${(v / 1e6).toFixed(1)}M`; if (Math.abs(v) >= 1e3) return `£${(v / 1e3).toFixed(0)}K`; return `£${v.toFixed(0)}`; };
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const xAxisG = g.append('g').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(Math.floor(iW / 100)).tickFormat(fmtK));
    xAxisG.selectAll('text').attr('font-size', '8px').attr('text-anchor', 'end').attr('transform', 'rotate(-45)').attr('dx', '-4px').attr('dy', '4px');
    g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => `£${d3.format(',.2f')(d as number)}`)).selectAll('text').attr('font-size', '8px');
    g.append('text').attr('x', iW / 2).attr('y', iH + 36).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666').text(`${xLabel}${logX ? ' — log' : ''}`);
    g.append('text').attr('x', -iH / 2).attr('y', -44).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)').attr('font-size', '9px').attr('fill', '#666').text(`RRP (£)${logY ? ' — log' : ''}`);
    g.append('g').attr('class', 'gx').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(Math.floor(iW / 100)).tickSize(-iH).tickFormat(() => '')).selectAll('line').attr('stroke', '#eee');
    g.append('g').attr('class', 'gy').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => '')).selectAll('line').attr('stroke', '#eee');
    g.selectAll('.gx .domain, .gy .domain').remove();

    const vis = points.filter((p) => { if (hiddenCats.has(p.category)) return false; if (logX && xAccessor(p) <= 0) return false; if (logY && p.rrp <= 0) return false; return true; });

    // Per-category density contours
    if (contours && vis.length >= 3) {
      const contourG = g.append('g').attr('class', 'contour-layer');
      const catGroups = new Map<string, ScatterPoint[]>();
      for (const p of vis) { if (!catGroups.has(p.category)) catGroups.set(p.category, []); catGroups.get(p.category)!.push(p); }

      for (const [cat, catPts] of catGroups) {
        if (catPts.length < 2) continue;
        const catColor = colorMap.get(cat) ?? '#999';
        const bandwidth = Math.max(iW, iH) * 0.06;
        const density = d3.contourDensity<ScatterPoint>()
          .x((d) => xScale(xAccessor(d)))
          .y((d) => yScale(d.rrp))
          .size([iW, iH])
          .bandwidth(bandwidth)
          .thresholds(6)(catPts);

        const maxDensity = d3.max(density, (d) => d.value) ?? 1;

        contourG.selectAll(`path.contour-${cat.replace(/\W/g, '_')}`)
          .data(density)
          .join('path')
          .attr('d', d3.geoPath())
          .attr('fill', catColor)
          .attr('fill-opacity', (d) => 0.03 + (d.value / maxDensity) * 0.22)
          .attr('stroke', 'none');
      }
    }

    // Fill: with age shading on, the dot's colour is the category base
    // run through the lifecycle ramp (sub-category shades are skipped so
    // lightness only encodes age); otherwise the sub-category shade map.
    const dotFill = (d: ScatterPoint): string => {
      const base = colorMap.get(d.category) ?? '#999';
      if (ageShade) return ageShadedColor(base, d.launchAge);
      const k = d.subCategory ? `${d.category}::${d.subCategory}` : d.category;
      return colorMap.get(k) ?? base;
    };

    g.selectAll('circle').data(vis).join('circle')
      .attr('cx', (d) => xScale(xAccessor(d))).attr('cy', (d) => yScale(d.rrp)).attr('r', dotSize)
      .attr('fill', dotFill)
      // Higher opacity in age-shading mode: the ramp's pastel end would
      // otherwise be double-faded by translucency over white.
      .attr('fill-opacity', ageShade ? 0.92 : 0.75)
      .attr('stroke', (d) => colorMap.get(d.category) ?? '#999').attr('stroke-width', 1).style('cursor', 'pointer')
      .on('mouseenter', function (ev, d) {
        d3.select(this).attr('r', dotSize + 2).attr('fill-opacity', 1).attr('stroke-width', 2);
        const r = wrapperRef.current?.getBoundingClientRect();
        if (r) {
          const launchBit = d.launchSeason
            ? ` | Launch: ${d.launchSeason}${d.launchAge != null ? ` (${d.launchAge < 0 ? 'future' : `${d.launchAge.toFixed(1)}y`})` : ''}`
            : '';
          setTooltip({
            x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8,
            label: `${d.sku} — ${d.name}`,
            value: `RRP: £${d.rrp.toFixed(2)} | ${xField === 'revenue' ? 'Rev' : 'OM'}: ${fmtGbp(xAccessor(d))}${launchBit}`,
            depth: d.subCategory ? `${d.category} / ${d.subCategory}` : d.category,
          });
        }
      })
      .on('mousemove', function (ev) { const r = wrapperRef.current?.getBoundingClientRect(); if (r) setTooltip((p) => p ? { ...p, x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8 } : null); })
      .on('mouseleave', function () { d3.select(this).attr('r', dotSize).attr('fill-opacity', ageShade ? 0.92 : 0.75).attr('stroke-width', 1); setTooltip(null); });

    // Legend — inside plot, top-left, clickable to toggle category visibility
    const lG = g.append('g').attr('transform', 'translate(8, 4)');
    let ly = 0;
    for (const [cat] of categories) {
      const c = colorMap.get(cat) ?? '#999';
      const hidden = hiddenCats.has(cat);
      const row = lG.append('g').attr('transform', `translate(0, ${ly})`).style('cursor', 'pointer');
      row.append('rect').attr('x', -4).attr('y', -3).attr('width', cat.length * 5.5 + 22).attr('height', 15).attr('fill', '#fff').attr('fill-opacity', 0.88).attr('rx', 2);
      row.append('circle').attr('cx', 4).attr('cy', 5).attr('r', 4).attr('fill', hidden ? '#ccc' : c).attr('stroke', hidden ? '#999' : 'none').attr('stroke-width', hidden ? 1 : 0);
      row.append('text').attr('x', 12).attr('y', 8).attr('font-size', '8px').attr('fill', hidden ? '#bbb' : '#555').text(cat);
      if (hidden) row.append('line').attr('x1', 0).attr('y1', 5).attr('x2', cat.length * 5.5 + 14).attr('y2', 5).attr('stroke', '#bbb').attr('stroke-width', 0.5);
      row.on('click', () => onToggleCat(cat));
      ly += 16;
    }
  }, [points, dims, wrapperRef, colorMap, categories, logX, logY, maxXN, maxYN, dotSize, contours, hiddenCats, onToggleCat, xField, xAccessor, xLabel, ageShade]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
}

// ---------- Scatter Stats Panel ----------

function fmtGbp(v: number): string {
  if (Math.abs(v) >= 1e6) return `£${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `£${(v / 1e3).toFixed(1)}K`;
  return `£${v.toFixed(0)}`;
}

function ScatterStats({ points, growthPct, onGrowthChange, catColors }: {
  points: { rrp: number; margin: number; revenue: number; category: string }[];
  growthPct: number;
  onGrowthChange: (v: number) => void;
  catColors: Map<string, string>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    if (!panelRef.current) return;
    try {
      setCopyStatus('...');
      const canvas = await html2canvas(panelRef.current, { backgroundColor: '#fafafa', scale: 2 });
      canvas.toBlob(async (blob) => {
        if (!blob) { setCopyStatus('Failed'); return; }
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setCopyStatus('Copied!'); }
        catch { setCopyStatus('Failed'); }
        setTimeout(() => setCopyStatus(null), 1500);
      }, 'image/png');
    } catch { setCopyStatus('Failed'); setTimeout(() => setCopyStatus(null), 1500); }
  }, []);

  if (points.length === 0) return null;
  const n = points.length;
  const avgRrp = points.reduce((s, p) => s + p.rrp, 0) / n;
  const avgOm = points.reduce((s, p) => s + p.margin, 0) / n;
  const totalOm = points.reduce((s, p) => s + p.margin, 0);
  const avgRev = points.reduce((s, p) => s + p.revenue, 0) / n;
  const totalRev = points.reduce((s, p) => s + p.revenue, 0);

  const catMap = new Map<string, { total: number; count: number }>();
  for (const p of points) {
    const e = catMap.get(p.category) ?? { total: 0, count: 0 };
    e.total += p.margin; e.count++; catMap.set(p.category, e);
  }

  return (
    <div className="analyse-stats-panel" ref={panelRef}>
      <p className="analyse-stats-title">Key Stats</p>
      <div className="analyse-stat-row"><span className="analyse-stat-label">SKUs shown</span><span className="analyse-stat-value">{n}</span></div>
      <div className="analyse-stat-row"><span className="analyse-stat-label">Avg RRP</span><span className="analyse-stat-value">£{avgRrp.toFixed(2)}</span></div>
      <div className="analyse-stat-row"><span className="analyse-stat-label">Avg Revenue / SKU</span><span className="analyse-stat-value">{fmtGbp(avgRev)}</span></div>
      <div className="analyse-stat-row"><span className="analyse-stat-label">Total Revenue</span><span className="analyse-stat-value">{fmtGbp(totalRev)}</span></div>
      <div className="analyse-stat-row"><span className="analyse-stat-label">Avg OM (£) / SKU</span><span className="analyse-stat-value">{fmtGbp(avgOm)}</span></div>
      <div className="analyse-stat-row"><span className="analyse-stat-label">Total OM (£)</span><span className="analyse-stat-value">{fmtGbp(totalOm)}</span></div>

      <div style={{ borderTop: '1px solid #eee', paddingTop: 8, marginTop: 4 }}>
        <p className="analyse-stats-title">Growth Target</p>
        <div className="analyse-stat-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min="1" max="100" step="1"
            className="analyse-config-input" style={{ width: 40 }}
            value={growthPct} onChange={(e) => onGrowthChange(Math.max(1, Number(e.target.value) || 5))}
          />
          <span className="analyse-stat-label">% growth</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Array.from(catMap).map(([cat, { total, count }]) => {
            const avgCatOm = total / count;
            const target = total * (growthPct / 100);
            const skusNeeded = avgCatOm > 0 ? Math.ceil(target / avgCatOm) : 0;
            const color = catColors.get(cat) ?? '#999';
            return (
              <div key={cat} style={{ fontSize: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: '#333' }}>{cat}</span>
                </div>
                <div style={{ paddingLeft: 10, color: '#666' }}>
                  +{skusNeeded} SKU{skusNeeded !== 1 ? 's' : ''} @ avg {fmtGbp(avgCatOm)}/SKU = {fmtGbp(target)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <button className="analyse-snip-btn" style={{ marginTop: 'auto', alignSelf: 'stretch' }} onClick={handleCopy}>{copyStatus ?? 'Copy stats'}</button>
    </div>
  );
}

// ---------- Lifecycle (avg OM per SKU by launch-age bucket) ----------

const AGE_BUCKETS = [
  { key: '<1y', min: 0, max: 1 },
  { key: '1–2y', min: 1, max: 2 },
  { key: '2–3y', min: 2, max: 3 },
  { key: '3y+', min: 3, max: Infinity },
] as const;

interface LifecyclePoint { category: string; margin: number; age: number; }

function LifecycleChart({ plans, catalogue, shelfSide, catColors, hiddenCats, onToggleCat }: {
  plans: RangePlan[]; catalogue: Product[]; shelfSide: string;
  catColors: Map<string, string>; hiddenCats: Set<string>; onToggleCat: (cat: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // One entry per distinct product with a margin AND a parseable,
  // non-future launch season. Products missing either are excluded —
  // they can't be bucketed.
  const { points, excluded } = useMemo(() => {
    const seen = new Set<string>();
    const pts: LifecyclePoint[] = [];
    let skipped = 0;
    for (const plan of plans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, catalogue);
        if (!prod || seen.has(prod.id)) continue;
        seen.add(prod.id);
        const margin = prod.operatingMarginGbp;
        const age = launchAgeYears(prod.launchSeason);
        if (margin == null || age == null || age < 0) { skipped++; continue; }
        pts.push({ category: prod.category || 'Uncategorised', margin, age });
      }
    }
    return { points: pts, excluded: skipped };
  }, [plans, catalogue, shelfSide]);

  const categories = useMemo(() => Array.from(new Set(points.map((p) => p.category))).sort(), [points]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const { width, height } = dims;
    const margin = { top: 16, right: 24, bottom: 40, left: 64 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20 || points.length === 0) return;

    const vis = points.filter((p) => !hiddenCats.has(p.category));

    // Per-category per-bucket {avg, n}, plus the all-category series.
    type BucketStat = { avg: number; n: number } | null;
    const series: { name: string; color: string; dashed: boolean; stats: BucketStat[] }[] = [];
    const bucketStats = (pts: LifecyclePoint[]): BucketStat[] =>
      AGE_BUCKETS.map((b) => {
        const inB = pts.filter((p) => p.age >= b.min && p.age < b.max);
        if (inB.length === 0) return null;
        return { avg: inB.reduce((s, p) => s + p.margin, 0) / inB.length, n: inB.length };
      });
    for (const cat of categories) {
      if (hiddenCats.has(cat)) continue;
      series.push({ name: cat, color: catColors.get(cat) ?? '#999', dashed: false, stats: bucketStats(vis.filter((p) => p.category === cat)) });
    }
    if (series.length > 1) {
      series.push({ name: 'All categories', color: '#333', dashed: true, stats: bucketStats(vis) });
    }

    const maxAvg = d3.max(series.flatMap((s) => s.stats.filter((x): x is { avg: number; n: number } => !!x).map((x) => x.avg))) ?? 0;
    if (maxAvg <= 0) return;

    const xScale = d3.scalePoint<string>().domain(AGE_BUCKETS.map((b) => b.key)).range([0, iW]).padding(0.5);
    const yScale = d3.scaleLinear().domain([0, maxAvg * 1.12]).range([iH, 0]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    g.append('g').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xScale)).selectAll('text').attr('font-size', '10px');
    g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => fmtGbp(+d))).selectAll('text').attr('font-size', '8px');
    g.append('text').attr('x', iW / 2).attr('y', iH + 32).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666').text('Time on market since launch');
    g.append('text').attr('x', -iH / 2).attr('y', -48).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)').attr('font-size', '9px').attr('fill', '#666').text('Avg OM (£) per SKU');
    g.append('g').attr('class', 'gy').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => '')).selectAll('line').attr('stroke', '#eee');
    g.selectAll('.gy .domain').remove();

    const lineGen = d3.line<{ x: string; y: number }>().x((d) => xScale(d.x)!).y((d) => yScale(d.y));

    for (const s of series) {
      const pts = AGE_BUCKETS.map((b, i) => s.stats[i] ? { x: b.key as string, y: s.stats[i]!.avg } : null)
        .filter((p): p is { x: string; y: number } => !!p);
      if (pts.length === 0) continue;
      if (pts.length > 1) {
        g.append('path').attr('d', lineGen(pts)!).attr('fill', 'none')
          .attr('stroke', s.color).attr('stroke-width', s.dashed ? 1.5 : 2)
          .attr('stroke-dasharray', s.dashed ? '5,4' : null)
          .attr('opacity', s.dashed ? 0.7 : 0.85);
      }
      AGE_BUCKETS.forEach((b, i) => {
        const st = s.stats[i];
        if (!st) return;
        g.append('circle')
          .attr('cx', xScale(b.key)!).attr('cy', yScale(st.avg)).attr('r', s.dashed ? 3 : 4.5)
          .attr('fill', s.color).attr('stroke', '#fff').attr('stroke-width', 1)
          .style('cursor', 'pointer')
          .on('mouseenter', function (ev: MouseEvent) {
            d3.select(this).attr('r', s.dashed ? 4.5 : 6);
            const r = wrapperRef.current?.getBoundingClientRect();
            if (r) setTooltip({
              x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8,
              label: `${s.name} — ${b.key}`,
              value: `Avg OM: ${fmtGbp(st.avg)} · ${st.n} SKU${st.n !== 1 ? 's' : ''}`,
              depth: 'Launch-age bucket',
            });
          })
          .on('mousemove', function (ev: MouseEvent) {
            const r = wrapperRef.current?.getBoundingClientRect();
            if (r) setTooltip((p) => p ? { ...p, x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8 } : null);
          })
          .on('mouseleave', function () {
            d3.select(this).attr('r', s.dashed ? 3 : 4.5);
            setTooltip(null);
          });
      });
    }

    // Clickable category legend — same interaction as the scatter.
    const lG = g.append('g').attr('transform', 'translate(8, 0)');
    let ly = 0;
    for (const cat of categories) {
      const c = catColors.get(cat) ?? '#999';
      const hidden = hiddenCats.has(cat);
      const row = lG.append('g').attr('transform', `translate(0, ${ly})`).style('cursor', 'pointer');
      row.append('rect').attr('x', -4).attr('y', -3).attr('width', cat.length * 5.5 + 22).attr('height', 15).attr('fill', '#fff').attr('fill-opacity', 0.88).attr('rx', 2);
      row.append('circle').attr('cx', 4).attr('cy', 5).attr('r', 4).attr('fill', hidden ? '#ccc' : c);
      row.append('text').attr('x', 12).attr('y', 8).attr('font-size', '8px').attr('fill', hidden ? '#bbb' : '#555').text(cat);
      if (hidden) row.append('line').attr('x1', 0).attr('y1', 5).attr('x2', cat.length * 5.5 + 14).attr('y2', 5).attr('stroke', '#bbb').attr('stroke-width', 0.5);
      row.on('click', () => onToggleCat(cat));
      ly += 16;
    }

    // Excluded-SKU note so a thin dataset is visible, not misleading.
    if (excluded > 0) {
      g.append('text').attr('x', iW).attr('y', -4).attr('text-anchor', 'end')
        .attr('font-size', '8px').attr('fill', '#aaa')
        .text(`${excluded} SKU${excluded !== 1 ? 's' : ''} excluded (no margin or launch season)`);
    }
  }, [points, excluded, dims, wrapperRef, catColors, categories, hiddenCats, onToggleCat]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Revenue Rank (Pareto) ----------

interface ParetoPoint { sku: string; name: string; category: string; revenue: number; }

function ParetoChart({ plans, catalogue, shelfSide, catColors, hiddenCats, onToggleCat }: {
  plans: RangePlan[]; catalogue: Product[]; shelfSide: string;
  catColors: Map<string, string>; hiddenCats: Set<string>; onToggleCat: (cat: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const points = useMemo(() => {
    const seen = new Set<string>();
    const pts: ParetoPoint[] = [];
    for (const plan of plans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, catalogue);
        if (!prod || seen.has(prod.id)) continue;
        seen.add(prod.id);
        const revenue = prod.revenue ?? 0;
        if (revenue <= 0) continue;
        pts.push({ sku: prod.sku, name: prod.name, category: prod.category || 'Uncategorised', revenue });
      }
    }
    return pts;
  }, [plans, catalogue, shelfSide]);

  const categories = useMemo(() => Array.from(new Set(points.map((p) => p.category))).sort(), [points]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const { width, height } = dims;
    // Extra headroom for the top %-of-SKUs axis and its intercept label.
    const margin = { top: 34, right: 44, bottom: 36, left: 64 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20 || points.length === 0) return;

    // Visible SKUs ranked by revenue, descending.
    const ranked = points.filter((p) => !hiddenCats.has(p.category)).sort((a, b) => b.revenue - a.revenue);
    if (ranked.length === 0) return;
    const total = ranked.reduce((s, p) => s + p.revenue, 0);

    const xScale = d3.scaleLinear().domain([0, ranked.length]).range([0, iW]);
    const yScale = d3.scaleLinear().domain([0, (ranked[0].revenue) * 1.05]).range([iH, 0]);
    const pctScale = d3.scaleLinear().domain([0, 100]).range([iH, 0]);
    const barW = Math.max(iW / ranked.length - 0.5, 0.5);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Axes: left = revenue, right = cumulative %, bottom = rank.
    g.append('g').attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(xScale).ticks(Math.min(10, ranked.length)).tickFormat((d) => `${d}`))
      .selectAll('text').attr('font-size', '8px');
    g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => fmtGbp(+d))).selectAll('text').attr('font-size', '8px');
    g.append('g').attr('transform', `translate(${iW},0)`)
      .call(d3.axisRight(pctScale).ticks(5).tickFormat((d) => `${d}%`))
      .selectAll('text').attr('font-size', '8px').attr('fill', '#666');
    g.append('text').attr('x', iW / 2).attr('y', iH + 28).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666')
      .text(`SKUs ranked by revenue (${ranked.length})`);
    g.append('text').attr('x', -iH / 2).attr('y', -48).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)')
      .attr('font-size', '9px').attr('fill', '#666').text('Revenue (£)');
    g.append('text').attr('x', iH / 2).attr('y', -iW - 34).attr('text-anchor', 'middle').attr('transform', 'rotate(90)')
      .attr('font-size', '9px').attr('fill', '#666').text('Cumulative share');
    g.append('g').attr('class', 'gy')
      .call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => ''))
      .selectAll('line').attr('stroke', '#eee');
    g.selectAll('.gy .domain').remove();

    // Bars — one per SKU, coloured by category.
    g.selectAll('rect.pareto-bar').data(ranked).join('rect')
      .attr('class', 'pareto-bar')
      .attr('x', (_, i) => xScale(i))
      .attr('y', (d) => yScale(d.revenue))
      .attr('width', barW)
      .attr('height', (d) => iH - yScale(d.revenue))
      .attr('fill', (d) => catColors.get(d.category) ?? '#999')
      .attr('fill-opacity', 0.85)
      .style('cursor', 'pointer')
      .on('mouseenter', function (ev: MouseEvent, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#333').attr('stroke-width', 0.5);
        const i = ranked.indexOf(d);
        const cum = ranked.slice(0, i + 1).reduce((s, p) => s + p.revenue, 0);
        const r = wrapperRef.current?.getBoundingClientRect();
        if (r) setTooltip({
          x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8,
          label: `#${i + 1} · ${d.sku} — ${d.name}`,
          value: `Revenue: ${fmtGbp(d.revenue)} · top ${i + 1} = ${(cum / total * 100).toFixed(1)}% of total`,
          depth: d.category,
        });
      })
      .on('mousemove', function (ev: MouseEvent) {
        const r = wrapperRef.current?.getBoundingClientRect();
        if (r) setTooltip((p) => p ? { ...p, x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8 } : null);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('fill-opacity', 0.85).attr('stroke', 'none');
        setTooltip(null);
      });

    // Cumulative share line (dashed).
    let running = 0;
    const cumPts = ranked.map((p, i) => { running += p.revenue; return { x: xScale(i) + barW / 2, y: pctScale(running / total * 100) }; });
    g.append('path')
      .attr('d', d3.line<{ x: number; y: number }>().x((d) => d.x).y((d) => d.y)(cumPts)!)
      .attr('fill', 'none').attr('stroke', '#333').attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,4').attr('opacity', 0.7);

    // Top secondary axis: % of SKUs.
    const skuPctScale = d3.scaleLinear().domain([0, 100]).range([0, iW]);
    g.append('g').call(d3.axisTop(skuPctScale).ticks(10).tickFormat((d) => `${d}%`))
      .selectAll('text').attr('font-size', '7px').attr('fill', '#888');
    g.append('text').attr('x', iW / 2).attr('y', -22).attr('text-anchor', 'middle')
      .attr('font-size', '8px').attr('fill', '#888').text('% of SKUs');

    // 80% guide line — the classic Pareto reference.
    g.append('line').attr('x1', 0).attr('x2', iW).attr('y1', pctScale(80)).attr('y2', pctScale(80))
      .attr('stroke', '#c62828').attr('stroke-width', 0.5).attr('stroke-dasharray', '2,3').attr('opacity', 0.5);
    g.append('text').attr('x', iW - 4).attr('y', pctScale(80) - 3).attr('text-anchor', 'end')
      .attr('font-size', '7px').attr('fill', '#c62828').attr('opacity', 0.7).text('80%');

    // Intercept: first rank whose cumulative share reaches 80%. Dotted
    // drop-line UP from the intercept to the top axis, annotated with
    // the % of SKUs that produce 80% of the revenue.
    {
      let cum = 0;
      let k = -1;
      for (let i = 0; i < ranked.length; i++) { cum += ranked[i].revenue; if (cum / total >= 0.8) { k = i; break; } }
      if (k >= 0) {
        const xi = xScale(k) + barW / 2;
        const skuPct = ((k + 1) / ranked.length) * 100;
        g.append('line').attr('x1', xi).attr('x2', xi).attr('y1', pctScale(80)).attr('y2', 0)
          .attr('stroke', '#c62828').attr('stroke-width', 1).attr('stroke-dasharray', '3,3').attr('opacity', 0.7);
        g.append('circle').attr('cx', xi).attr('cy', pctScale(80)).attr('r', 3)
          .attr('fill', '#c62828').attr('opacity', 0.8);
        g.append('text').attr('x', xi + 4).attr('y', 10).attr('text-anchor', 'start')
          .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#c62828')
          .text(`${skuPct.toFixed(0)}% of SKUs = 80% of revenue`);
      }
    }

    // Clickable category legend — fixed-width rows so the colour dots
    // share one column regardless of label length.
    const maxLabelW = Math.max(...categories.map((c) => c.length * 5.5 + 22));
    const lG = g.append('g').attr('transform', `translate(${iW - 8 - maxLabelW}, 26)`);
    let ly = 0;
    for (const cat of categories) {
      const c = catColors.get(cat) ?? '#999';
      const hidden = hiddenCats.has(cat);
      const row = lG.append('g').attr('transform', `translate(0, ${ly})`).style('cursor', 'pointer');
      row.append('rect').attr('x', -4).attr('y', -3).attr('width', maxLabelW + 4).attr('height', 15).attr('fill', '#fff').attr('fill-opacity', 0.88).attr('rx', 2);
      row.append('circle').attr('cx', 4).attr('cy', 5).attr('r', 4).attr('fill', hidden ? '#ccc' : c);
      row.append('text').attr('x', 12).attr('y', 8).attr('font-size', '8px').attr('fill', hidden ? '#bbb' : '#555').text(cat);
      if (hidden) row.append('line').attr('x1', 0).attr('y1', 5).attr('x2', cat.length * 5.5 + 14).attr('y2', 5).attr('stroke', '#bbb').attr('stroke-width', 0.5);
      row.on('click', () => onToggleCat(cat));
      ly += 16;
    }
  }, [points, dims, wrapperRef, catColors, categories, hiddenCats, onToggleCat]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}
