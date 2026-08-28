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
type SheetId = 'icicle' | 'scatter' | 'lifecycle' | 'pareto' | 'growth' | 'growth-plans' | 'growth-groups' | 'sunburst';

const SHEETS: { id: SheetId; label: string }[] = [
  { id: 'icicle', label: 'Icicle' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'pareto', label: 'Revenue Rank' },
  { id: 'growth', label: 'Growth' },
  { id: 'growth-plans', label: 'Growth by Plan' },
  { id: 'growth-groups', label: 'Growth by Group' },
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

interface ChartProps { plans: RangePlan[]; catalogue: Product[]; metric: Metric; shelfSide: string; activeLens?: Lens | null; aspMode: AspMode; showSegments: boolean; catColors: Map<string, string>; textScale: number; }

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
  // Growth settings — initialised from the saved project and persisted
  // on every change so they survive save/reload. Default 10%.
  const [growthPct, setGrowthPctState] = useState(() => av?.growthConfig?.pct ?? 10);
  const [growthMetric, setGrowthMetricState] = useState<'margin' | 'revenue'>(
    () => (av?.growthConfig?.metric === 'revenue' ? 'revenue' : 'margin'));
  const [showCombinedNewness, setShowCombinedNewnessState] = useState(() => av?.growthConfig?.combined ?? true);
  const [showGrowthUplift, setShowGrowthUpliftState] = useState(() => av?.growthConfig?.uplift ?? true);
  const [growthVertical, setGrowthVerticalState] = useState(() => av?.growthConfig?.vertical ?? false);
  // Summary overlay (Growth by Group): cumulative totals card in the
  // chart's top-right corner.
  const [showGroupSummary, setShowGroupSummaryState] = useState(() => av?.growthConfig?.summary ?? false);
  // Growth-sheet-specific category hiding — independent of the legend
  // hidden-set the other sheets share, and persisted with the project.
  const [growthHiddenCats, setGrowthHiddenCats] = useState<Set<string>>(
    () => new Set(av?.growthConfig?.hiddenCats ?? []));
  const [showCatFilter, setShowCatFilter] = useState(false);

  // Named plan groups (e.g. Core / Duo) for the Growth by Group sheet.
  // Read straight from the store (not local state) because the sidebar's
  // per-plan group chips edit the same list.
  const planGroups = useMemo(() => av?.planGroups ?? [], [av?.planGroups]);
  const planGroupsTitle = av?.planGroupsTitle ?? 'Groups';
  const compoundGroupsTitle = av?.compoundGroupsTitle ?? 'Compound groups';
  const [showGroupsDialog, setShowGroupsDialog] = useState(false);
  const setPlanGroups = (groups: { id: string; name: string; planIds: string[] }[]) => {
    setAnalyseConfig({ planGroups: groups });
  };

  // Compound groups: named buckets of Item Ranking values that split
  // each Growth by Group bar into stacked segments. Any SKU whose
  // ranking is unallocated (or missing) lands in the catch-all
  // segment, whose display name is also user-defined.
  const compoundGroups = useMemo(() => av?.compoundGroups ?? [], [av?.compoundGroups]);
  const compoundRestName = av?.compoundRestName ?? 'Other';
  // Stacking position of the catch-all segment = number of compound
  // groups before it (defaults to last; clamped after deletions).
  const compoundRestIndex = Math.min(av?.compoundRestIndex ?? compoundGroups.length, compoundGroups.length);
  const [showCompoundDialog, setShowCompoundDialog] = useState(false);
  const availableRankings = useMemo(() => {
    const set = new Set<string>();
    for (const p of project?.catalogue ?? []) {
      const r = (p.itemRanking ?? '').trim();
      if (r) set.add(r);
    }
    return Array.from(set).sort();
  }, [project?.catalogue]);

  // Per-sheet text-size multiplier for presentation exports.
  const [textScales, setTextScales] = useState<Record<string, number>>(() => av?.textScales ?? {});
  const activeTextScale = textScales[activeSheet] ?? 1;
  const setTextScale = (v: number) => {
    setTextScales((prev) => {
      const next = { ...prev, [activeSheet]: v };
      setAnalyseConfig({ textScales: next });
      return next;
    });
  };

  // Cross-plan duplication: how many distinct SKUs appear in more
  // than one selected plan (on the active stage). Surfaced in the
  // growth config bar — the dedupe counts them once, but the user
  // should see the overlap exists.
  const sharedSkuCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plan of selectedPlans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      const seenInPlan = new Set<string>();
      for (const item of shelf.items) {
        if (!item.productId || seenInPlan.has(item.productId)) continue;
        seenInPlan.add(item.productId);
        counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
      }
    }
    let n = 0;
    for (const c of counts.values()) if (c > 1) n++;
    return n;
  }, [selectedPlans, shelfSide]);

  const persistGrowth = useCallback((patch: { pct?: number; metric?: 'margin' | 'revenue'; combined?: boolean; uplift?: boolean; vertical?: boolean; hiddenCats?: string[]; summary?: boolean }) => {
    const current = {
      pct: growthPct, metric: growthMetric, combined: showCombinedNewness,
      uplift: showGrowthUplift, vertical: growthVertical,
      hiddenCats: Array.from(growthHiddenCats),
      summary: showGroupSummary,
      ...patch,
    };
    setAnalyseConfig({ growthConfig: current });
  }, [growthPct, growthMetric, showCombinedNewness, showGrowthUplift, growthVertical, growthHiddenCats, showGroupSummary, setAnalyseConfig]);

  const setGrowthPct = (v: number) => { setGrowthPctState(v); persistGrowth({ pct: v }); };
  const setGrowthMetric = (m: 'margin' | 'revenue') => { setGrowthMetricState(m); persistGrowth({ metric: m }); };
  const setShowCombinedNewness = (v: boolean) => { setShowCombinedNewnessState(v); persistGrowth({ combined: v }); };
  const setShowGrowthUplift = (v: boolean) => { setShowGrowthUpliftState(v); persistGrowth({ uplift: v }); };
  const setGrowthVertical = (v: boolean) => { setGrowthVerticalState(v); persistGrowth({ vertical: v }); };
  const setShowGroupSummary = (v: boolean) => { setShowGroupSummaryState(v); persistGrowth({ summary: v }); };
  const toggleGrowthCat = (cat: string) => {
    setGrowthHiddenCats((prev) => {
      const n = new Set(prev);
      if (n.has(cat)) n.delete(cat); else n.add(cat);
      persistGrowth({ hiddenCats: Array.from(n) });
      return n;
    });
  };
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
    textScale: activeTextScale,
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

      {showGroupsDialog && (
        <PlanGroupsDialog
          groups={planGroups}
          title={planGroupsTitle}
          onTitleChange={(t) => setAnalyseConfig({ planGroupsTitle: t })}
          onChange={setPlanGroups}
          onClose={() => setShowGroupsDialog(false)}
        />
      )}
      {showCompoundDialog && (
        <CompoundGroupsDialog
          groups={compoundGroups}
          restName={compoundRestName}
          restIndex={compoundRestIndex}
          title={compoundGroupsTitle}
          onTitleChange={(t) => setAnalyseConfig({ compoundGroupsTitle: t })}
          availableRankings={availableRankings}
          onChange={(groups) => setAnalyseConfig({ compoundGroups: groups })}
          onReorder={(groups, restIdx) => setAnalyseConfig({ compoundGroups: groups, compoundRestIndex: restIdx })}
          onRestNameChange={(name) => setAnalyseConfig({ compoundRestName: name })}
          onClose={() => setShowCompoundDialog(false)}
        />
      )}
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
                {activeSheet === 'icicle' ? <Icicle {...chartProps} /> : activeSheet === 'scatter' ? <ScatterPlot plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} config={scatterConfig} catColors={catColors} textScale={activeTextScale} hiddenCats={hiddenCats} onToggleCat={(cat) => setHiddenCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} /> : activeSheet === 'lifecycle' ? <LifecycleChart plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} textScale={activeTextScale} hiddenCats={hiddenCats} onToggleCat={(cat) => setHiddenCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} /> : activeSheet === 'pareto' ? <ParetoChart plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} textScale={activeTextScale} hiddenCats={hiddenCats} onToggleCat={(cat) => setHiddenCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} /> : activeSheet === 'growth' ? <GrowthChart plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} textScale={activeTextScale} hiddenCats={growthHiddenCats} growthPct={growthPct} growthMetric={growthMetric} showCombined={showCombinedNewness} showGrowth={showGrowthUplift} vertical={growthVertical} /> : activeSheet === 'growth-plans' ? <GrowthPlanChart plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} textScale={activeTextScale} hiddenCats={growthHiddenCats} growthPct={growthPct} growthMetric={growthMetric} showCombined={showCombinedNewness} showGrowth={showGrowthUplift} vertical={growthVertical} /> : activeSheet === 'growth-groups' ? <GrowthGroupChart groups={planGroups} compounds={compoundGroups} restName={compoundRestName} restIndex={compoundRestIndex} groupsTitle={planGroupsTitle} compoundsTitle={compoundGroupsTitle} plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} catColors={catColors} textScale={activeTextScale} hiddenCats={growthHiddenCats} growthPct={growthPct} growthMetric={growthMetric} showGrowth={showGrowthUplift} vertical={growthVertical} showSummary={showGroupSummary} /> : <Sunburst {...chartProps} />}
              </div>
              {activeSheet === 'scatter' && <ScatterStats points={scatterVisiblePoints} growthPct={growthPct} onGrowthChange={setGrowthPct} growthMetric={growthMetric} onGrowthMetricChange={setGrowthMetric} catColors={catColors} />}
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
              <label className="analyse-config-item" title="Scale all text in this chart — per sheet, saved with the project. Use when the chart will be shrunk in a presentation.">Text
                <input type="range" min="1" max="2.2" step="0.05" value={activeTextScale} onChange={(e) => setTextScale(Number(e.target.value))} style={{ width: 70, height: 12 }} />
                <span>{activeTextScale.toFixed(2)}×</span>
              </label>
              <div className="analyse-config-separator" />
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
              <label className="analyse-config-item" title="Scale all text in this chart — per sheet, saved with the project. Use when the chart will be shrunk in a presentation.">Text
                <input type="range" min="1" max="2.2" step="0.05" value={activeTextScale} onChange={(e) => setTextScale(Number(e.target.value))} style={{ width: 70, height: 12 }} />
                <span>{activeTextScale.toFixed(2)}×</span>
              </label>
              <div className="analyse-config-separator" />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}
          {activeSheet === 'lifecycle' && (
            <div className="analyse-chart-config">
              <span className="analyse-config-item" style={{ cursor: 'default' }}>Avg OM (£) per SKU by launch-age bucket — click legend entries to isolate categories; hover points for SKU counts</span>
              <span style={{ flex: 1 }} />
              <label className="analyse-config-item" title="Scale all text in this chart — per sheet, saved with the project. Use when the chart will be shrunk in a presentation.">Text
                <input type="range" min="1" max="2.2" step="0.05" value={activeTextScale} onChange={(e) => setTextScale(Number(e.target.value))} style={{ width: 70, height: 12 }} />
                <span>{activeTextScale.toFixed(2)}×</span>
              </label>
              <div className="analyse-config-separator" />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}
          {activeSheet === 'pareto' && (
            <div className="analyse-chart-config">
              <span className="analyse-config-item" style={{ cursor: 'default' }}>SKUs ranked by revenue — dashed line is cumulative share; click legend entries to isolate categories</span>
              <span style={{ flex: 1 }} />
              <label className="analyse-config-item" title="Scale all text in this chart — per sheet, saved with the project. Use when the chart will be shrunk in a presentation.">Text
                <input type="range" min="1" max="2.2" step="0.05" value={activeTextScale} onChange={(e) => setTextScale(Number(e.target.value))} style={{ width: 70, height: 12 }} />
                <span>{activeTextScale.toFixed(2)}×</span>
              </label>
              <div className="analyse-config-separator" />
              <button className="analyse-snip-btn" onClick={handleSnip}>{snipStatus ?? 'Copy to clipboard'}</button>
            </div>
          )}
          {(activeSheet === 'growth' || activeSheet === 'growth-plans' || activeSheet === 'growth-groups') && (
            <div className="analyse-chart-config">
              <div className="analyse-metric-toggle" role="tablist">
                <button role="tab" className={growthMetric === 'revenue' ? 'active' : ''} onClick={() => setGrowthMetric('revenue')}>Revenue</button>
                <button role="tab" className={growthMetric === 'margin' ? 'active' : ''} onClick={() => setGrowthMetric('margin')}>OM £</button>
              </div>
              <div className="analyse-config-separator" />
              <label className="analyse-config-item">Growth %
                <input type="number" min="1" max="100" step="1" className="analyse-config-input" style={{ width: 44 }}
                  value={growthPct} onChange={(e) => setGrowthPct(Math.max(1, Number(e.target.value) || 5))} />
              </label>
              <label className="analyse-config-item" title="Show the dashed growth-uplift block, SKU-requirement annotations, and combined newness">
                <input type="checkbox" checked={showGrowthUplift} onChange={(e) => setShowGrowthUplift(e.target.checked)} />
                Growth uplift
              </label>
              {showGrowthUplift && activeSheet !== 'growth-groups' && (
                <label className="analyse-config-item" title="Summary bar concatenating every category's growth block into one combined annual newness requirement">
                  <input type="checkbox" checked={showCombinedNewness} onChange={(e) => setShowCombinedNewness(e.target.checked)} />
                  Combined newness
                </label>
              )}
              {activeSheet === 'growth-groups' && (
                <>
                  <label className="analyse-config-item" title="Overlay cumulative totals in the top-right of the chart: grand total, per-group totals, and compound-group cross-category totals">
                    <input type="checkbox" checked={showGroupSummary} onChange={(e) => setShowGroupSummary(e.target.checked)} />
                    Summary
                  </label>
                  <button className="analyse-snip-btn" onClick={() => setShowGroupsDialog(true)} title="Define named groups (e.g. Core / Duo) and assign range plans to them">
                    Manage Groups ({planGroups.length})
                  </button>
                  <button className="analyse-snip-btn" onClick={() => setShowCompoundDialog(true)}
                    title="Define named buckets of Item Ranking values — each bar splits into stacked segments by bucket, with unallocated rankings in a catch-all segment">
                    Compound Groups ({compoundGroups.length})
                  </button>
                </>
              )}
              <div className="analyse-metric-toggle" role="tablist">
                <button role="tab" className={!growthVertical ? 'active' : ''} onClick={() => setGrowthVertical(false)}>Horizontal</button>
                <button role="tab" className={growthVertical ? 'active' : ''} onClick={() => setGrowthVertical(true)}>Vertical</button>
              </div>
              {sharedSkuCount > 0 && (
                <>
                  <div className="analyse-config-separator" />
                  <span className="analyse-config-item" style={{ cursor: 'help', color: '#e65100' }}
                    title="These SKUs exist in more than one of the selected range plans. Both growth sheets count each SKU once — on Growth by Plan it is attributed to the first selected plan containing it, so later plans' segments show their incremental contribution.">
                    ⚠ {sharedSkuCount} SKU{sharedSkuCount !== 1 ? 's' : ''} shared between plans (counted once)
                  </span>
                </>
              )}
              <div className="analyse-config-separator" />
              {/* Category filter lives HERE (below the canvas) so it is
                  never captured in the slide copy. Opens upward — the
                  config bar sits near the bottom of the viewport. */}
              <div className="toolbar-dropdown-wrapper">
                <button className="toolbar-btn" style={{ fontSize: 10, padding: '3px 9px' }} onClick={() => setShowCatFilter((v) => !v)}>
                  Categories ({allCategories.length - growthHiddenCats.size}/{allCategories.length}) ▾
                </button>
                {showCatFilter && (
                  <div className="toolbar-dropdown" onMouseLeave={() => setShowCatFilter(false)}
                    style={{ bottom: '100%', top: 'auto', marginBottom: 4, maxHeight: 260, overflowY: 'auto' }}>
                    {allCategories.map((cat) => (
                      <label key={cat} className="dropdown-checkbox">
                        <input type="checkbox" checked={!growthHiddenCats.has(cat)}
                          onChange={() => toggleGrowthCat(cat)} />
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: catColors.get(cat) ?? '#999', display: 'inline-block', flexShrink: 0 }} />
                          {cat}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <span className="analyse-config-item" style={{ cursor: 'default' }}>Bar segments are one avg-SKU wide — count the ticks in the growth block to read the SKU requirement</span>
              <span style={{ flex: 1 }} />
              <label className="analyse-config-item" title="Scale all text in this chart — per sheet, saved with the project. Use when the chart will be shrunk in a presentation.">Text
                <input type="range" min="1" max="2.2" step="0.05" value={activeTextScale} onChange={(e) => setTextScale(Number(e.target.value))} style={{ width: 70, height: 12 }} />
                <span>{activeTextScale.toFixed(2)}×</span>
              </label>
              <div className="analyse-config-separator" />
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

function Sunburst({ plans, catalogue, metric, shelfSide, showSegments, catColors, textScale }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide, showSegments), [plans, catalogue, metric, shelfSide, showSegments]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    // Layout at a proportionally SMALLER internal size, then let the
    // viewBox scale it back up — text, margins, axes, and spacing all
    // grow together so enlarged text genuinely gets its room.
    const width = dims.width / textScale;
    const height = dims.height / textScale;
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
  }, [data, dims, metric, wrapperRef, showSegments, catColors, textScale]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
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

function Icicle({ plans, catalogue, metric, shelfSide, activeLens, aspMode, showSegments, catColors, textScale }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide, showSegments), [plans, catalogue, metric, shelfSide, showSegments]);
  const cw = showSegments ? ICICLE_COLS_SEG : ICICLE_COLS_NO;
  const md = cw.length;
  const dl = showSegments ? ['', 'Category', 'Plan', 'Segment', 'SKU'] : ['', 'Category', 'Plan', 'SKU'];

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    // Layout at a proportionally SMALLER internal size, then let the
    // viewBox scale it back up — text, margins, axes, and spacing all
    // grow together so enlarged text genuinely gets its room.
    const width = dims.width / textScale;
    const height = dims.height / textScale;
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
  }, [data, dims, metric, wrapperRef, activeLens, shelfSide, aspMode, cw, md, dl, catColors, textScale]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
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

function ScatterPlot({ plans, catalogue, shelfSide, config, catColors, textScale, hiddenCats, onToggleCat }: { plans: RangePlan[]; catalogue: Product[]; shelfSide: string; config: ScatterConfig; catColors: Map<string, string>; textScale: number; hiddenCats: Set<string>; onToggleCat: (cat: string) => void }) {
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
    // Layout at a proportionally SMALLER internal size, then let the
    // viewBox scale it back up — text, margins, axes, and spacing all
    // grow together so enlarged text genuinely gets its room.
    const width = dims.width / textScale;
    const height = dims.height / textScale;
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
  }, [points, dims, wrapperRef, colorMap, categories, logX, logY, maxXN, maxYN, dotSize, contours, hiddenCats, onToggleCat, xField, xAccessor, xLabel, ageShade, textScale]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
}

// ---------- Scatter Stats Panel ----------

function fmtGbp(v: number): string {
  if (Math.abs(v) >= 1e6) return `£${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `£${(v / 1e3).toFixed(1)}K`;
  return `£${v.toFixed(0)}`;
}

function ScatterStats({ points, growthPct, onGrowthChange, growthMetric, onGrowthMetricChange, catColors }: {
  points: { rrp: number; margin: number; revenue: number; category: string }[];
  growthPct: number;
  onGrowthChange: (v: number) => void;
  growthMetric: 'margin' | 'revenue';
  onGrowthMetricChange: (m: 'margin' | 'revenue') => void;
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
    const v = growthMetric === 'revenue' ? p.revenue : p.margin;
    const e = catMap.get(p.category) ?? { total: 0, count: 0 };
    e.total += v; e.count++; catMap.set(p.category, e);
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
        <div className="analyse-metric-toggle" role="tablist" style={{ marginTop: 4 }}>
          <button role="tab" className={growthMetric === 'margin' ? 'active' : ''} onClick={() => onGrowthMetricChange('margin')} style={{ padding: '2px 8px', fontSize: 9 }}>OM £</button>
          <button role="tab" className={growthMetric === 'revenue' ? 'active' : ''} onClick={() => onGrowthMetricChange('revenue')} style={{ padding: '2px 8px', fontSize: 9 }}>Revenue</button>
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

function LifecycleChart({ plans, catalogue, shelfSide, catColors, textScale, hiddenCats, onToggleCat }: {
  plans: RangePlan[]; catalogue: Product[]; shelfSide: string;
  catColors: Map<string, string>; textScale: number; hiddenCats: Set<string>; onToggleCat: (cat: string) => void;
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
    // Layout at a proportionally SMALLER internal size, then let the
    // viewBox scale it back up — text, margins, axes, and spacing all
    // grow together so enlarged text genuinely gets its room.
    const width = dims.width / textScale;
    const height = dims.height / textScale;
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
  }, [points, excluded, dims, wrapperRef, catColors, categories, hiddenCats, onToggleCat, textScale]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Revenue Rank (Pareto) ----------

interface ParetoPoint { sku: string; name: string; category: string; revenue: number; }

function ParetoChart({ plans, catalogue, shelfSide, catColors, textScale, hiddenCats, onToggleCat }: {
  plans: RangePlan[]; catalogue: Product[]; shelfSide: string;
  catColors: Map<string, string>; textScale: number; hiddenCats: Set<string>; onToggleCat: (cat: string) => void;
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
    // Layout at a proportionally SMALLER internal size, then let the
    // viewBox scale it back up — text, margins, axes, and spacing all
    // grow together so enlarged text genuinely gets its room.
    const width = dims.width / textScale;
    const height = dims.height / textScale;
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
  }, [points, dims, wrapperRef, catColors, categories, hiddenCats, onToggleCat, textScale]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Growth charts (shared helpers) ----------

/** Tick step so SKU-unit divisions bunch to a ~1.8px minimum spacing
 * instead of merging into a solid block — a dense hatch still reads
 * as "many SKUs" rather than "one". Returns 0 when no ticks fit. */
function unitTickStep(unitPx: number): number {
  if (unitPx <= 0.05) return 0;
  return unitPx >= 3 ? 1 : Math.ceil(1.8 / unitPx);
}

interface GrowthChartProps {
  plans: RangePlan[]; catalogue: Product[]; shelfSide: string;
  catColors: Map<string, string>; textScale: number; hiddenCats: Set<string>;
  growthPct: number; growthMetric: 'margin' | 'revenue';
  showCombined: boolean; showGrowth: boolean; vertical: boolean;
}

// ---------- Growth (stacked existing + incremental, SKU-unit ticks) ----------

function GrowthChart({ plans, catalogue, shelfSide, catColors, textScale, hiddenCats, growthPct, growthMetric, showCombined, showGrowth, vertical }: GrowthChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const cats = useMemo(() => {
    const seen = new Set<string>();
    const map = new Map<string, { total: number; n: number }>();
    for (const plan of plans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, catalogue);
        if (!prod || seen.has(prod.id)) continue;
        seen.add(prod.id);
        const v = growthMetric === 'revenue' ? (prod.revenue ?? 0) : (prod.operatingMarginGbp ?? 0);
        if (v <= 0) continue;
        const cat = prod.category || 'Uncategorised';
        if (hiddenCats.has(cat)) continue;
        const e = map.get(cat) ?? { total: 0, n: 0 };
        e.total += v; e.n++; map.set(cat, e);
      }
    }
    return Array.from(map.entries())
      .map(([cat, { total, n }]) => ({ cat, total, n, avg: total / n }))
      .sort((a, b) => b.total - a.total);
  }, [plans, catalogue, shelfSide, growthMetric, hiddenCats]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const width = dims.width / textScale;
    const height = dims.height / textScale;
    const margin = vertical
      ? { top: 34, right: 20, bottom: 56, left: 64 }
      : { top: 20, right: 130, bottom: 36, left: 130 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20 || cats.length === 0) return;

    const rows = cats.map((c) => {
      const inc = showGrowth ? c.total * (growthPct / 100) : 0;
      return { ...c, inc, skusNeeded: showGrowth && c.avg > 0 ? Math.ceil(inc / c.avg) : 0 };
    });
    const combinedShown = showCombined && showGrowth && rows.length > 0;
    const COMBINED_KEY = '__combined__';
    const domain = combinedShown ? [...rows.map((r) => r.cat), COMBINED_KEY] : rows.map((r) => r.cat);
    const maxV = d3.max(rows, (r) => r.total + r.inc) ?? 0;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const metricLabel = `${growthMetric === 'revenue' ? 'Revenue' : 'Operating Margin'} (£)${showGrowth ? ` — existing + ${growthPct}% growth` : ''}`;

    const hoverSeg = (label: string, value: string) => (ev: MouseEvent) => {
      const rc = wrapperRef.current?.getBoundingClientRect();
      if (rc) setTooltip({ x: ev.clientX - rc.left + 12, y: ev.clientY - rc.top - 8, label, value, depth: growthMetric === 'revenue' ? 'Revenue' : 'OM £' });
    };
    const moveSeg = (ev: MouseEvent) => {
      const rc = wrapperRef.current?.getBoundingClientRect();
      if (rc) setTooltip((pv) => pv ? { ...pv, x: ev.clientX - rc.left + 12, y: ev.clientY - rc.top - 8 } : null);
    };

    if (!vertical) {
      const xScale = d3.scaleLinear().domain([0, maxV * 1.02]).range([0, iW]);
      const yScale = d3.scaleBand<string>().domain(domain).range([0, iH]).padding(0.3);

      g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).ticks(Math.floor(iW / 90)).tickFormat((d) => fmtGbp(+d)))
        .selectAll('text').attr('font-size', '8px');
      g.append('g').call(d3.axisLeft(yScale).tickFormat((d) => d === COMBINED_KEY ? '' : d)).selectAll('text').attr('font-size', '9px').attr('font-weight', '600');
      g.append('text').attr('x', iW / 2).attr('y', iH + 30).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666').text(metricLabel);
      g.append('g').attr('class', 'gx').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).ticks(Math.floor(iW / 90)).tickSize(-iH).tickFormat(() => ''))
        .selectAll('line').attr('stroke', '#eee');
      g.selectAll('.gx .domain').remove();

      const drawTicks = (x0: number, x1: number, y: number, bh: number, unitPx: number, startUnit: number, heavy: boolean) => {
        const step = unitTickStep(unitPx);
        if (step === 0) return;
        let drawn = 0;
        for (let u = startUnit + step; drawn < 1000; u += step) {
          const ux = u * unitPx;
          if (ux >= x1) break;
          if (ux > x0) {
            g.append('line').attr('x1', ux).attr('x2', ux).attr('y1', y).attr('y2', y + bh)
              .attr('stroke', '#fff').attr('stroke-width', heavy ? 1.5 : 1).attr('opacity', heavy ? 0.95 : 0.75);
            drawn++;
          }
        }
      };

      for (const r of rows) {
        const y = yScale(r.cat)!;
        const bh = yScale.bandwidth();
        const base = catColors.get(r.cat) ?? '#999';
        const incColor = d3.interpolateLab(base, '#ffffff')(0.55);
        const unitPx = xScale(r.avg);

        g.append('rect').attr('x', 0).attr('y', y).attr('width', xScale(r.total)).attr('height', bh)
          .attr('fill', base).attr('fill-opacity', 0.9).attr('rx', 2).style('cursor', 'pointer')
          .on('mouseenter', hoverSeg(`${r.cat} — existing`, `${fmtGbp(r.total)} · ${r.n} SKUs · avg ${fmtGbp(r.avg)}/SKU`))
          .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
        drawTicks(0, xScale(r.total), y, bh, unitPx, 0, false);

        if (showGrowth && r.inc > 0) {
          g.append('rect').attr('x', xScale(r.total)).attr('y', y)
            .attr('width', Math.max(0, xScale(r.total + r.inc) - xScale(r.total))).attr('height', bh)
            .attr('fill', incColor).attr('stroke', base).attr('stroke-width', 1).attr('stroke-dasharray', '3,2').attr('rx', 2)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — +${growthPct}% growth`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} new SKU${r.skusNeeded !== 1 ? 's' : ''} @ avg ${fmtGbp(r.avg)}/SKU`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          drawTicks(xScale(r.total), xScale(r.total + r.inc), y, bh, unitPx, Math.floor(r.total / r.avg), true);

          g.append('text').attr('x', xScale(r.total + r.inc) + 6).attr('y', y + bh / 2 + 3)
            .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#333')
            .text(`+${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`);
          g.append('text').attr('x', xScale(r.total + r.inc) + 6).attr('y', y + bh / 2 + 13)
            .attr('font-size', '7.5px').attr('fill', '#888')
            .text(`@ ${fmtGbp(r.avg)}/SKU`);
        }

        if (xScale(r.total) > 70) {
          const label = fmtGbp(r.total);
          const labelW = label.length * 6.5 + 12;
          g.append('rect').attr('x', 6).attr('y', y + bh / 2 - 8).attr('width', labelW).attr('height', 16).attr('rx', 8)
            .attr('fill', '#fff').attr('fill-opacity', 0.8);
          g.append('text').attr('x', 6 + labelW / 2).attr('y', y + bh / 2 + 3.5).attr('text-anchor', 'middle')
            .attr('font-size', '10px').attr('font-weight', '700').attr('fill', '#1a1a2e').text(label);
        }
      }

      if (combinedShown) {
        const comboY = yScale(COMBINED_KEY)!;
        const comboBh = yScale.bandwidth();
        const totalInc = rows.reduce((sm, r) => sm + r.inc, 0);
        const totalSkus = rows.reduce((sm, r) => sm + r.skusNeeded, 0);
        g.append('line').attr('x1', 0).attr('x2', iW)
          .attr('y1', comboY - yScale.step() * 0.15).attr('y2', comboY - yScale.step() * 0.15)
          .attr('stroke', '#ddd').attr('stroke-width', 0.5);
        g.append('text').attr('x', -8).attr('y', comboY + comboBh / 2 + 3).attr('text-anchor', 'end')
          .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#333').text('Combined newness');
        let cx = 0;
        for (const r of rows) {
          const segW = xScale(r.inc);
          if (segW <= 0) continue;
          const base = catColors.get(r.cat) ?? '#999';
          g.append('rect').attr('x', cx).attr('y', comboY).attr('width', segW).attr('height', comboBh)
            .attr('fill', d3.interpolateLab(base, '#ffffff')(0.45)).attr('stroke', base).attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — newness`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          const unitPx = xScale(r.avg);
          const step = unitTickStep(unitPx);
          if (step > 0) {
            let drawn = 0;
            for (let u = step; u * unitPx < segW && drawn < 500; u += step) {
              g.append('line').attr('x1', cx + u * unitPx).attr('x2', cx + u * unitPx)
                .attr('y1', comboY).attr('y2', comboY + comboBh)
                .attr('stroke', '#fff').attr('stroke-width', 1).attr('opacity', 0.9);
              drawn++;
            }
          }
          cx += segW;
        }
        g.append('text').attr('x', cx + 6).attr('y', comboY + comboBh / 2 + 3)
          .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#333')
          .text(`+${totalSkus} SKUs · ${fmtGbp(totalInc)}`);
      }
    } else {
      // ---------- Vertical orientation ----------
      const xScale = d3.scaleBand<string>().domain(domain).range([0, iW]).padding(0.3);
      const yScale = d3.scaleLinear().domain([0, maxV * 1.08]).range([iH, 0]);

      const xAxisG = g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).tickFormat((d) => d === COMBINED_KEY ? 'Combined' : d));
      xAxisG.selectAll('text').attr('font-size', '8.5px').attr('font-weight', '600')
        .attr('text-anchor', 'end').attr('transform', 'rotate(-30)').attr('dx', '-4px').attr('dy', '4px');
      g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => fmtGbp(+d))).selectAll('text').attr('font-size', '8px');
      g.append('text').attr('x', -iH / 2).attr('y', -50).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)')
        .attr('font-size', '9px').attr('fill', '#666').text(metricLabel);
      g.append('g').attr('class', 'gy')
        .call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => ''))
        .selectAll('line').attr('stroke', '#eee');
      g.selectAll('.gy .domain').remove();

      const drawHTicks = (x: number, bw: number, vFrom: number, vTo: number, unit: number, startUnit: number, heavy: boolean) => {
        const unitPx = yScale(0) - yScale(unit);
        const step = unitTickStep(unitPx);
        if (step === 0) return;
        let drawn = 0;
        for (let u = startUnit + step; drawn < 1000; u += step) {
          const v = u * unit;
          if (v >= vTo) break;
          if (v > vFrom) {
            g.append('line').attr('x1', x).attr('x2', x + bw).attr('y1', yScale(v)).attr('y2', yScale(v))
              .attr('stroke', '#fff').attr('stroke-width', heavy ? 1.5 : 1).attr('opacity', heavy ? 0.95 : 0.75);
            drawn++;
          }
        }
      };

      for (const r of rows) {
        const x = xScale(r.cat)!;
        const bw = xScale.bandwidth();
        const base = catColors.get(r.cat) ?? '#999';
        const incColor = d3.interpolateLab(base, '#ffffff')(0.55);

        g.append('rect').attr('x', x).attr('y', yScale(r.total)).attr('width', bw).attr('height', iH - yScale(r.total))
          .attr('fill', base).attr('fill-opacity', 0.9).attr('rx', 2).style('cursor', 'pointer')
          .on('mouseenter', hoverSeg(`${r.cat} — existing`, `${fmtGbp(r.total)} · ${r.n} SKUs · avg ${fmtGbp(r.avg)}/SKU`))
          .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
        drawHTicks(x, bw, 0, r.total, r.avg, 0, false);

        if (showGrowth && r.inc > 0) {
          g.append('rect').attr('x', x).attr('y', yScale(r.total + r.inc)).attr('width', bw)
            .attr('height', Math.max(0, yScale(r.total) - yScale(r.total + r.inc)))
            .attr('fill', incColor).attr('stroke', base).attr('stroke-width', 1).attr('stroke-dasharray', '3,2').attr('rx', 2)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — +${growthPct}% growth`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} new SKU${r.skusNeeded !== 1 ? 's' : ''} @ avg ${fmtGbp(r.avg)}/SKU`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          drawHTicks(x, bw, r.total, r.total + r.inc, r.avg, Math.floor(r.total / r.avg), true);

          g.append('text').attr('x', x + bw / 2).attr('y', yScale(r.total + r.inc) - 14).attr('text-anchor', 'middle')
            .attr('font-size', '8.5px').attr('font-weight', '700').attr('fill', '#333')
            .text(`+${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`);
          g.append('text').attr('x', x + bw / 2).attr('y', yScale(r.total + r.inc) - 5).attr('text-anchor', 'middle')
            .attr('font-size', '7px').attr('fill', '#888').text(`@ ${fmtGbp(r.avg)}`);
        }

        if (iH - yScale(r.total) > 42 && bw > 34) {
          const label = fmtGbp(r.total);
          const labelW = Math.min(label.length * 6 + 10, bw - 2);
          g.append('rect').attr('x', x + bw / 2 - labelW / 2).attr('y', iH - 22).attr('width', labelW).attr('height', 15).attr('rx', 7.5)
            .attr('fill', '#fff').attr('fill-opacity', 0.8);
          g.append('text').attr('x', x + bw / 2).attr('y', iH - 11).attr('text-anchor', 'middle')
            .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#1a1a2e').text(label);
        }
      }

      if (combinedShown) {
        const x = xScale(COMBINED_KEY)!;
        const bw = xScale.bandwidth();
        const totalInc = rows.reduce((sm, r) => sm + r.inc, 0);
        const totalSkus = rows.reduce((sm, r) => sm + r.skusNeeded, 0);
        let cy = 0; // cumulative value from bottom
        for (const r of rows) {
          if (r.inc <= 0) continue;
          const base = catColors.get(r.cat) ?? '#999';
          const y0 = yScale(cy + r.inc), y1 = yScale(cy);
          g.append('rect').attr('x', x).attr('y', y0).attr('width', bw).attr('height', Math.max(0, y1 - y0))
            .attr('fill', d3.interpolateLab(base, '#ffffff')(0.45)).attr('stroke', base).attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — newness`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          cy += r.inc;
        }
        g.append('text').attr('x', x + bw / 2).attr('y', yScale(cy) - 5).attr('text-anchor', 'middle')
          .attr('font-size', '8px').attr('font-weight', '700').attr('fill', '#333')
          .text(`+${totalSkus} SKUs · ${fmtGbp(totalInc)}`);
      }
    }
  }, [cats, dims, wrapperRef, catColors, growthPct, growthMetric, showCombined, showGrowth, vertical, textScale]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Growth by Plan (category bars stacked by range plan) ----------

function GrowthPlanChart({ plans, catalogue, shelfSide, catColors, textScale, hiddenCats, growthPct, growthMetric, showCombined, showGrowth, vertical }: GrowthChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // FIRST-PLAN-WINS dedupe — mirrors GrowthChart's skip sequence
  // exactly so both sheets reconcile to the penny (see v1.26.5).
  const cats = useMemo(() => {
    const map = new Map<string, Map<string, { total: number; n: number }>>();
    const seen = new Set<string>();
    for (const plan of plans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, catalogue);
        if (!prod || seen.has(prod.id)) continue;
        seen.add(prod.id);
        const v = growthMetric === 'revenue' ? (prod.revenue ?? 0) : (prod.operatingMarginGbp ?? 0);
        if (v <= 0) continue;
        const cat = prod.category || 'Uncategorised';
        if (hiddenCats.has(cat)) continue;
        if (!map.has(cat)) map.set(cat, new Map());
        const pm = map.get(cat)!;
        const e = pm.get(plan.name) ?? { total: 0, n: 0 };
        e.total += v; e.n++; pm.set(plan.name, e);
      }
    }
    return Array.from(map.entries()).map(([cat, pm]) => {
      const segs = plans
        .map((pl) => ({ plan: pl.name, ...(pm.get(pl.name) ?? { total: 0, n: 0 }) }))
        .filter((sg) => sg.total > 0)
        .map((sg) => ({ ...sg, avg: sg.total / sg.n }));
      const total = segs.reduce((sm, x) => sm + x.total, 0);
      const n = segs.reduce((sm, x) => sm + x.n, 0);
      return { cat, segs, total, n, avg: n > 0 ? total / n : 0 };
    }).sort((a, b) => b.total - a.total);
  }, [plans, catalogue, shelfSide, growthMetric, hiddenCats]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const width = dims.width / textScale;
    const height = dims.height / textScale;
    const margin = vertical
      ? { top: 34, right: 20, bottom: 56, left: 64 }
      : { top: 20, right: 130, bottom: 36, left: 130 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20 || cats.length === 0) return;

    const rows = cats.map((c) => {
      const inc = showGrowth ? c.total * (growthPct / 100) : 0;
      return { ...c, inc, skusNeeded: showGrowth && c.avg > 0 ? Math.ceil(inc / c.avg) : 0 };
    });
    const combinedShown = showCombined && showGrowth && rows.length > 0;
    const COMBINED_KEY = '__combined__';
    const domain = combinedShown ? [...rows.map((r) => r.cat), COMBINED_KEY] : rows.map((r) => r.cat);
    const maxV = d3.max(rows, (r) => r.total + r.inc) ?? 0;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const metricLabel = `${growthMetric === 'revenue' ? 'Revenue' : 'Operating Margin'} (£) by range plan${showGrowth ? ` — existing + ${growthPct}% growth` : ''}`;

    const hoverSeg = (label: string, value: string) => (ev: MouseEvent) => {
      const rc = wrapperRef.current?.getBoundingClientRect();
      if (rc) setTooltip({ x: ev.clientX - rc.left + 12, y: ev.clientY - rc.top - 8, label, value, depth: growthMetric === 'revenue' ? 'Revenue' : 'OM £' });
    };
    const moveSeg = (ev: MouseEvent) => {
      const rc = wrapperRef.current?.getBoundingClientRect();
      if (rc) setTooltip((pv) => pv ? { ...pv, x: ev.clientX - rc.left + 12, y: ev.clientY - rc.top - 8 } : null);
    };

    if (!vertical) {
      const xScale = d3.scaleLinear().domain([0, maxV * 1.02]).range([0, iW]);
      const yScale = d3.scaleBand<string>().domain(domain).range([0, iH]).padding(0.3);

      g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).ticks(Math.floor(iW / 90)).tickFormat((d) => fmtGbp(+d)))
        .selectAll('text').attr('font-size', '8px');
      g.append('g').call(d3.axisLeft(yScale).tickFormat((d) => d === COMBINED_KEY ? '' : d)).selectAll('text').attr('font-size', '9px').attr('font-weight', '600');
      g.append('text').attr('x', iW / 2).attr('y', iH + 30).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666').text(metricLabel);
      g.append('g').attr('class', 'gx').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).ticks(Math.floor(iW / 90)).tickSize(-iH).tickFormat(() => ''))
        .selectAll('line').attr('stroke', '#eee');
      g.selectAll('.gx .domain').remove();

      for (const r of rows) {
        const y = yScale(r.cat)!;
        const bh = yScale.bandwidth();
        const base = catColors.get(r.cat) ?? '#999';
        const incColor = d3.interpolateLab(base, '#ffffff')(0.55);

        const segLabels: { start: number; plan: string }[] = [];
        let cx = 0;
        for (const sg of r.segs) {
          const segW = xScale(sg.total);
          if (segW <= 0) continue;
          g.append('rect').attr('x', cx).attr('y', y).attr('width', segW).attr('height', bh)
            .attr('fill', base).attr('fill-opacity', 0.9).attr('stroke', '#fff').attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} · ${sg.plan}`, `${fmtGbp(sg.total)} · ${sg.n} SKUs · avg ${fmtGbp(sg.avg)}/SKU`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));

          const unitPx = xScale(sg.avg);
          const step = unitTickStep(unitPx);
          if (step > 0) {
            let drawn = 0;
            for (let u = step; u * unitPx < segW && drawn < 800; u += step) {
              g.append('line').attr('x1', cx + u * unitPx).attr('x2', cx + u * unitPx).attr('y1', y).attr('y2', y + bh)
                .attr('stroke', '#fff').attr('stroke-width', 0.75).attr('opacity', 0.7);
              drawn++;
            }
          }
          segLabels.push({ start: cx, plan: sg.plan });
          cx += segW;
        }

        segLabels.forEach((sl, i) => {
          const laneY = y + bh + 8 + (i % 2) * 8;
          const sameLaneNext = segLabels[i + 2];
          const maxW = (sameLaneNext ? sameLaneNext.start : iW + 110) - sl.start - 6;
          const maxChars = Math.max(3, Math.floor(maxW / 4.3));
          const label = sl.plan.length > maxChars ? sl.plan.slice(0, maxChars - 1) + '…' : sl.plan;
          g.append('line').attr('x1', sl.start + 0.5).attr('x2', sl.start + 0.5)
            .attr('y1', y + bh).attr('y2', laneY - 6).attr('stroke', '#ccc').attr('stroke-width', 0.6);
          const t = g.append('text').attr('x', sl.start + 3).attr('y', laneY)
            .attr('font-size', '7px').attr('font-weight', '600').attr('fill', '#666').text(label);
          t.append('title').text(sl.plan);
        });

        if (showGrowth && r.inc > 0) {
          g.append('rect').attr('x', cx).attr('y', y)
            .attr('width', Math.max(0, xScale(r.total + r.inc) - cx)).attr('height', bh)
            .attr('fill', incColor).attr('stroke', base).attr('stroke-width', 1).attr('stroke-dasharray', '3,2').attr('rx', 2)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — +${growthPct}% growth`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} new SKU${r.skusNeeded !== 1 ? 's' : ''} @ avg ${fmtGbp(r.avg)}/SKU`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          const gUnitPx = xScale(r.avg);
          const gStep = unitTickStep(gUnitPx);
          if (gStep > 0) {
            let drawn = 0;
            for (let u = Math.floor(r.total / r.avg) + gStep; drawn < 500; u += gStep) {
              const ux = u * gUnitPx;
              if (ux >= xScale(r.total + r.inc)) break;
              if (ux > cx) {
                g.append('line').attr('x1', ux).attr('x2', ux).attr('y1', y).attr('y2', y + bh)
                  .attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', 0.95);
                drawn++;
              }
            }
          }
          g.append('text').attr('x', xScale(r.total + r.inc) + 6).attr('y', y + bh / 2 + 3)
            .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#333')
            .text(`+${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`);
          g.append('text').attr('x', xScale(r.total + r.inc) + 6).attr('y', y + bh / 2 + 13)
            .attr('font-size', '7.5px').attr('fill', '#888').text(`@ ${fmtGbp(r.avg)}/SKU`);
        }

        if (xScale(r.total) > 70) {
          const label = fmtGbp(r.total);
          const labelW = label.length * 6.5 + 12;
          g.append('rect').attr('x', 6).attr('y', y + bh / 2 - 8).attr('width', labelW).attr('height', 16).attr('rx', 8)
            .attr('fill', '#fff').attr('fill-opacity', 0.8);
          g.append('text').attr('x', 6 + labelW / 2).attr('y', y + bh / 2 + 3.5).attr('text-anchor', 'middle')
            .attr('font-size', '10px').attr('font-weight', '700').attr('fill', '#1a1a2e').text(label);
        }
      }

      if (combinedShown) {
        const comboY = yScale(COMBINED_KEY)!;
        const comboBh = yScale.bandwidth();
        const totalInc = rows.reduce((sm, r) => sm + r.inc, 0);
        const totalSkus = rows.reduce((sm, r) => sm + r.skusNeeded, 0);
        g.append('line').attr('x1', 0).attr('x2', iW)
          .attr('y1', comboY - yScale.step() * 0.15).attr('y2', comboY - yScale.step() * 0.15)
          .attr('stroke', '#ddd').attr('stroke-width', 0.5);
        g.append('text').attr('x', -8).attr('y', comboY + comboBh / 2 + 3).attr('text-anchor', 'end')
          .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#333').text('Combined newness');
        let cx = 0;
        for (const r of rows) {
          const segW = xScale(r.inc);
          if (segW <= 0) continue;
          const base = catColors.get(r.cat) ?? '#999';
          g.append('rect').attr('x', cx).attr('y', comboY).attr('width', segW).attr('height', comboBh)
            .attr('fill', d3.interpolateLab(base, '#ffffff')(0.45)).attr('stroke', base).attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — newness`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          cx += segW;
        }
        g.append('text').attr('x', cx + 6).attr('y', comboY + comboBh / 2 + 3)
          .attr('font-size', '9px').attr('font-weight', '700').attr('fill', '#333')
          .text(`+${totalSkus} SKUs · ${fmtGbp(totalInc)}`);
      }
    } else {
      // ---------- Vertical orientation ----------
      const xScale = d3.scaleBand<string>().domain(domain).range([0, iW]).padding(0.3);
      const yScale = d3.scaleLinear().domain([0, maxV * 1.08]).range([iH, 0]);

      const xAxisG = g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).tickFormat((d) => d === COMBINED_KEY ? 'Combined' : d));
      xAxisG.selectAll('text').attr('font-size', '8.5px').attr('font-weight', '600')
        .attr('text-anchor', 'end').attr('transform', 'rotate(-30)').attr('dx', '-4px').attr('dy', '4px');
      g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => fmtGbp(+d))).selectAll('text').attr('font-size', '8px');
      g.append('text').attr('x', -iH / 2).attr('y', -50).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)')
        .attr('font-size', '9px').attr('fill', '#666').text(metricLabel);
      g.append('g').attr('class', 'gy')
        .call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => ''))
        .selectAll('line').attr('stroke', '#eee');
      g.selectAll('.gy .domain').remove();

      for (const r of rows) {
        const x = xScale(r.cat)!;
        const bw = xScale.bandwidth();
        const base = catColors.get(r.cat) ?? '#999';
        const incColor = d3.interpolateLab(base, '#ffffff')(0.55);

        // Plan segments stacked bottom-up in selection order.
        let cv = 0;
        for (const sg of r.segs) {
          const y0 = yScale(cv + sg.total), y1 = yScale(cv);
          const segH = Math.max(0, y1 - y0);
          if (segH <= 0) { cv += sg.total; continue; }
          g.append('rect').attr('x', x).attr('y', y0).attr('width', bw).attr('height', segH)
            .attr('fill', base).attr('fill-opacity', 0.9).attr('stroke', '#fff').attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} · ${sg.plan}`, `${fmtGbp(sg.total)} · ${sg.n} SKUs · avg ${fmtGbp(sg.avg)}/SKU`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));

          const unitPx = yScale(0) - yScale(sg.avg);
          const step = unitTickStep(unitPx);
          if (step > 0) {
            let drawn = 0;
            for (let u = step; u * sg.avg < sg.total && drawn < 800; u += step) {
              const vy = yScale(cv + u * sg.avg);
              g.append('line').attr('x1', x).attr('x2', x + bw).attr('y1', vy).attr('y2', vy)
                .attr('stroke', '#fff').attr('stroke-width', 0.75).attr('opacity', 0.7);
              drawn++;
            }
          }
          // Plan name inside the segment when tall enough.
          if (segH >= 12 && bw > 30) {
            const maxChars = Math.max(3, Math.floor((bw - 6) / 4.3));
            const label = sg.plan.length > maxChars ? sg.plan.slice(0, maxChars - 1) + '…' : sg.plan;
            const t = g.append('text').attr('x', x + bw / 2).attr('y', (y0 + y1) / 2 + 2.5)
              .attr('text-anchor', 'middle').attr('font-size', '7px').attr('font-weight', '600')
              .attr('fill', 'rgba(255,255,255,0.95)').style('pointer-events', 'none').text(label);
            t.append('title').text(sg.plan);
          }
          cv += sg.total;
        }

        if (showGrowth && r.inc > 0) {
          const y0 = yScale(r.total + r.inc), y1 = yScale(r.total);
          g.append('rect').attr('x', x).attr('y', y0).attr('width', bw).attr('height', Math.max(0, y1 - y0))
            .attr('fill', incColor).attr('stroke', base).attr('stroke-width', 1).attr('stroke-dasharray', '3,2').attr('rx', 2)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — +${growthPct}% growth`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} new SKU${r.skusNeeded !== 1 ? 's' : ''} @ avg ${fmtGbp(r.avg)}/SKU`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          g.append('text').attr('x', x + bw / 2).attr('y', y0 - 14).attr('text-anchor', 'middle')
            .attr('font-size', '8.5px').attr('font-weight', '700').attr('fill', '#333')
            .text(`+${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`);
          g.append('text').attr('x', x + bw / 2).attr('y', y0 - 5).attr('text-anchor', 'middle')
            .attr('font-size', '7px').attr('fill', '#888').text(`@ ${fmtGbp(r.avg)}`);
        }
      }

      if (combinedShown) {
        const x = xScale(COMBINED_KEY)!;
        const bw = xScale.bandwidth();
        const totalInc = rows.reduce((sm, r) => sm + r.inc, 0);
        const totalSkus = rows.reduce((sm, r) => sm + r.skusNeeded, 0);
        let cv = 0;
        for (const r of rows) {
          if (r.inc <= 0) continue;
          const base = catColors.get(r.cat) ?? '#999';
          const y0 = yScale(cv + r.inc), y1 = yScale(cv);
          g.append('rect').attr('x', x).attr('y', y0).attr('width', bw).attr('height', Math.max(0, y1 - y0))
            .attr('fill', d3.interpolateLab(base, '#ffffff')(0.45)).attr('stroke', base).attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseenter', hoverSeg(`${r.cat} — newness`, `${fmtGbp(r.inc)} ≈ ${r.skusNeeded} SKU${r.skusNeeded !== 1 ? 's' : ''}`))
            .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
          cv += r.inc;
        }
        g.append('text').attr('x', x + bw / 2).attr('y', yScale(cv) - 5).attr('text-anchor', 'middle')
          .attr('font-size', '8px').attr('font-weight', '700').attr('fill', '#333')
          .text(`+${totalSkus} SKUs · ${fmtGbp(totalInc)}`);
      }
    }
  }, [cats, dims, wrapperRef, catColors, growthPct, growthMetric, showCombined, showGrowth, vertical, plans, textScale]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Plan Groups dialog (Growth by Group) ----------

function PlanGroupsDialog({ groups, title, onTitleChange, onChange, onClose }: {
  groups: { id: string; name: string; planIds: string[] }[];
  title: string;
  onTitleChange: (title: string) => void;
  onChange: (groups: { id: string; name: string; planIds: string[] }[]) => void;
  onClose: () => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const addGroup = () => {
    onChange([...groups, { id: `pg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: `Group ${groups.length + 1}`, planIds: [] }]);
  };
  const rename = (id: string, name: string) => onChange(groups.map((g) => g.id === id ? { ...g, name } : g));
  const remove = (id: string) => onChange(groups.filter((g) => g.id !== id));
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    const next = [...groups];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onChange(next);
  };

  return (
    <div className="slab-dialog-overlay" onClick={onClose}>
      <div className="slab-dialog" style={{ width: 420, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3>Plan Groups</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#666' }}>
          Create and name your groups here (e.g. Core, Duo). To assign range plans,
          use the group boxes that appear next to each plan in the sidebar while the
          Growth by Group sheet is open. A plan contributes to a group's bar only
          when it is also ticked for this view. Drag ⠿ to reorder — the order sets
          the bar order within each category.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333', marginBottom: 10 }}>
          Legend title
          <input className="slab-dialog-input" style={{ flex: 1 }} value={title}
            onChange={(e) => onTitleChange(e.target.value)} placeholder="Groups" />
        </label>
        {groups.map((g, gi) => (
          <div key={g.id} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 10, marginBottom: 10, opacity: dragIdx === gi ? 0.5 : 1 }}
            onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
            onDrop={(e) => { if (dragIdx !== null) { e.preventDefault(); moveTo(dragIdx, gi); setDragIdx(null); } }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span draggable onDragStart={(e) => { setDragIdx(gi); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragIdx(null)}
                style={{ cursor: 'grab', color: '#aaa', fontSize: 14, userSelect: 'none' }} title="Drag to reorder">⠿</span>
              <input className="slab-dialog-input" style={{ flex: 1 }} value={g.name}
                onChange={(e) => rename(g.id, e.target.value)} placeholder="Group name" />
              <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>
                {g.planIds.length} plan{g.planIds.length === 1 ? '' : 's'}
              </span>
              <button className="slab-dialog-btn cancel" onClick={() => remove(g.id)} title="Delete group">×</button>
            </div>
          </div>
        ))}
        <div className="slab-dialog-actions" style={{ justifyContent: 'space-between' }}>
          <button className="slab-dialog-btn primary" onClick={addGroup}>+ Add Group</button>
          <button className="slab-dialog-btn cancel" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Compound Groups dialog (Growth by Group segments) ----------

function CompoundGroupsDialog({ groups, restName, restIndex, title, onTitleChange, availableRankings, onChange, onReorder, onRestNameChange, onClose }: {
  groups: { id: string; name: string; rankings: string[] }[];
  restName: string;
  restIndex: number;
  title: string;
  onTitleChange: (title: string) => void;
  availableRankings: string[];
  onChange: (groups: { id: string; name: string; rankings: string[] }[]) => void;
  onReorder: (groups: { id: string; name: string; rankings: string[] }[], restIndex: number) => void;
  onRestNameChange: (name: string) => void;
  onClose: () => void;
}) {
  // Combined display list: group cards plus the catch-all card at its
  // stacking position — all draggable as peers.
  type Item = { kind: 'group'; gi: number } | { kind: 'rest' };
  const items: Item[] = groups.map((_, gi) => ({ kind: 'group', gi } as Item));
  items.splice(Math.min(restIndex, groups.length), 0, { kind: 'rest' });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const addGroup = () => {
    onChange([...groups, { id: `cg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: `Compound ${groups.length + 1}`, rankings: [] }]);
  };
  const rename = (id: string, name: string) => onChange(groups.map((g) => g.id === id ? { ...g, name } : g));
  const remove = (gi: number) => {
    onReorder(groups.filter((_, i) => i !== gi), gi < restIndex ? restIndex - 1 : restIndex);
  };
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    const newGroups = next.flatMap((it) => it.kind === 'group' ? [groups[it.gi]] : []);
    onReorder(newGroups, next.findIndex((it) => it.kind === 'rest'));
  };
  const toggleRanking = (id: string, ranking: string) => onChange(groups.map((g) => {
    if (g.id !== id) return g;
    return { ...g, rankings: g.rankings.includes(ranking) ? g.rankings.filter((r) => r !== ranking) : [...g.rankings, ranking] };
  }));
  // First group claiming a ranking wins at aggregation time — flag
  // rankings already claimed by an earlier group so double-allocations
  // are visible while still allowed.
  const claimedBefore = (gi: number, ranking: string) =>
    groups.slice(0, gi).find((g) => g.rankings.includes(ranking))?.name;

  return (
    <div className="slab-dialog-overlay" onClick={onClose}>
      <div className="slab-dialog" style={{ width: 440, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3>Compound Groups</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#666' }}>
          Name each compound group and tick the Item Rankings that belong to it —
          every bar on the Growth by Group sheet then splits into stacked segments,
          one per compound group. SKUs whose ranking is unallocated (or blank) fall
          into the dashed catch-all group. If a ranking is ticked in two groups,
          the first group listed wins. Drag ⠿ to reorder — the order (catch-all
          included) sets the stacking order of the segments.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333', marginBottom: 10 }}>
          Legend title
          <input className="slab-dialog-input" style={{ flex: 1 }} value={title}
            onChange={(e) => onTitleChange(e.target.value)} placeholder="Compound groups" />
        </label>
        {availableRankings.length === 0 && (
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#c62828' }}>
            No Item Ranking values found in the catalogue — import products with an
            Item Ranking column first.
          </p>
        )}
        {items.map((it, idx) => {
          const dragProps = {
            onDragOver: (e: React.DragEvent) => { if (dragIdx !== null) e.preventDefault(); },
            onDrop: (e: React.DragEvent) => { if (dragIdx !== null) { e.preventDefault(); moveTo(dragIdx, idx); setDragIdx(null); } },
          };
          const handle = (
            <span draggable onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragIdx(null)}
              style={{ cursor: 'grab', color: '#aaa', fontSize: 14, userSelect: 'none' }} title="Drag to reorder">⠿</span>
          );
          if (it.kind === 'rest') {
            return (
              <div key="__rest__" style={{ border: '1px dashed #bbb', borderRadius: 6, padding: 10, marginBottom: 10, opacity: dragIdx === idx ? 0.5 : 1 }} {...dragProps}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333' }}>
                  {handle}
                  Everything else appears as
                  <input className="slab-dialog-input" style={{ flex: 1 }} value={restName}
                    onChange={(e) => onRestNameChange(e.target.value)} placeholder="Other" />
                </label>
              </div>
            );
          }
          const g = groups[it.gi];
          const gi = it.gi;
          return (
            <div key={g.id} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 10, marginBottom: 10, opacity: dragIdx === idx ? 0.5 : 1 }} {...dragProps}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                {handle}
                <input className="slab-dialog-input" style={{ flex: 1 }} value={g.name}
                  onChange={(e) => rename(g.id, e.target.value)} placeholder="Compound group name" />
                <button className="slab-dialog-btn cancel" onClick={() => remove(gi)} title="Delete compound group">×</button>
              </div>
              <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {availableRankings.map((r) => {
                  const claimer = claimedBefore(gi, r);
                  return (
                    <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', cursor: 'pointer' }}>
                      <input type="checkbox" checked={g.rankings.includes(r)} onChange={() => toggleRanking(g.id, r)} />
                      {r}
                      {claimer && g.rankings.includes(r) && (
                        <span style={{ fontSize: 10, color: '#e65100' }}>(also in {claimer} — that group wins)</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="slab-dialog-actions" style={{ justifyContent: 'space-between' }}>
          <button className="slab-dialog-btn primary" onClick={addGroup}>+ Add Compound Group</button>
          <button className="slab-dialog-btn cancel" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Growth by Group (grouped bars per category) ----------

function GrowthGroupChart({ groups, compounds, restName, restIndex, groupsTitle, compoundsTitle, plans, catalogue, shelfSide, catColors, textScale, hiddenCats, growthPct, growthMetric, showGrowth, vertical, showSummary }: {
  groups: { id: string; name: string; planIds: string[] }[];
  compounds: { id: string; name: string; rankings: string[] }[];
  restName: string;
  restIndex: number;
  groupsTitle: string;
  compoundsTitle: string;
  plans: RangePlan[]; catalogue: Product[]; shelfSide: string;
  catColors: Map<string, string>; textScale: number; hiddenCats: Set<string>;
  growthPct: number; growthMetric: 'margin' | 'revenue';
  showGrowth: boolean; vertical: boolean; showSummary: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Compound segment names: defined buckets in order, catch-all last.
  const segNames = useMemo(
    () => [...compounds.map((c) => c.name), restName.trim() || 'Other'],
    [compounds, restName]);

  // Per group: dedupe first-plan-wins WITHIN the group's selected
  // plans, then per-category totals of the chosen metric, split by
  // compound segment (a ranking claimed by two buckets goes to the
  // first; unclaimed/blank rankings go to the catch-all).
  const data = useMemo(() => {
    const restIdx = compounds.length;
    const rankIdx = new Map<string, number>();
    compounds.forEach((cg, i) => {
      for (const r of cg.rankings) if (!rankIdx.has(r)) rankIdx.set(r, i);
    });
    return groups.map((grp) => {
      const groupPlans = plans.filter((p) => grp.planIds.includes(p.id));
      const seen = new Set<string>();
      const catMap = new Map<string, { total: number; n: number; segs: number[]; segNs: number[] }>();
      for (const plan of groupPlans) {
        const shelf = resolveShelf(plan, shelfSide);
        if (!shelf) continue;
        for (const item of shelf.items) {
          const prod = getProductForItem(item, catalogue);
          if (!prod || seen.has(prod.id)) continue;
          seen.add(prod.id);
          const v = growthMetric === 'revenue' ? (prod.revenue ?? 0) : (prod.operatingMarginGbp ?? 0);
          if (v <= 0) continue;
          const cat = prod.category || 'Uncategorised';
          if (hiddenCats.has(cat)) continue;
          const e = catMap.get(cat) ?? {
            total: 0, n: 0,
            segs: new Array(restIdx + 1).fill(0),
            segNs: new Array(restIdx + 1).fill(0),
          };
          e.total += v; e.n++;
          const rk = (prod.itemRanking ?? '').trim();
          const si = rk && rankIdx.has(rk) ? rankIdx.get(rk)! : restIdx;
          e.segs[si] += v; e.segNs[si]++;
          catMap.set(cat, e);
        }
      }
      return { name: grp.name, catMap };
    });
  }, [groups, compounds, plans, catalogue, shelfSide, growthMetric, hiddenCats]);

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const width = dims.width / textScale;
    const height = dims.height / textScale;
    const margin = vertical
      ? { top: 40, right: 20, bottom: 56, left: 64 }
      : { top: 28, right: 120, bottom: 36, left: 130 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20) return;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    if (groups.length === 0 || data.every((d) => d.catMap.size === 0)) {
      g.append('text').attr('x', iW / 2).attr('y', iH / 2).attr('text-anchor', 'middle')
        .attr('font-size', '12px').attr('fill', '#888')
        .text(groups.length === 0
          ? 'No groups defined — use Manage Groups in the bar below to create Core / Duo groups.'
          : 'No data for the defined groups — check that their plans are selected in the sidebar.');
      return;
    }

    // Categories = union across groups, sorted by combined total.
    const catTotals = new Map<string, number>();
    for (const d of data) for (const [cat, e] of d.catMap) catTotals.set(cat, (catTotals.get(cat) ?? 0) + e.total);
    const categories = Array.from(catTotals.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);

    // Per category per group stats with growth.
    type Cell = { total: number; n: number; avg: number; inc: number; skusNeeded: number; segs: number[]; segNs: number[] } | null;
    const cell = (gi: number, cat: string): Cell => {
      const e = data[gi].catMap.get(cat);
      if (!e) return null;
      const avg = e.total / e.n;
      const inc = showGrowth ? e.total * (growthPct / 100) : 0;
      return { total: e.total, n: e.n, avg, inc, skusNeeded: showGrowth && avg > 0 ? Math.ceil(inc / avg) : 0, segs: e.segs, segNs: e.segNs };
    };
    // Compound view: stacked ranking-bucket segments inside each bar.
    // segOrder maps stacking position → aggregation index (compounds in
    // defined order with the catch-all inserted at its dragged
    // position); shading follows stacking position.
    const compound = compounds.length > 0;
    const segOrder = compounds.map((_, i) => i);
    segOrder.splice(Math.min(restIndex, compounds.length), 0, compounds.length);
    const segShade = (fill: string, pi: number) => d3.interpolateLab(fill, '#ffffff')(Math.min(0.6, pi * 0.2));
    const maxV = d3.max(categories.flatMap((cat) => data.map((_, gi) => { const c = cell(gi, cat); return c ? c.total + c.inc : 0; }))) ?? 0;
    if (maxV <= 0) return;

    // Group shading: group 1 = full category colour, later groups
    // progressively lighter — consistent in every category.
    const shade = (base: string, gi: number) => d3.interpolateLab(base, '#ffffff')(Math.min(gi * 0.38, 0.65));

    const hoverSeg = (label: string, value: string) => (ev: MouseEvent) => {
      const rc = wrapperRef.current?.getBoundingClientRect();
      if (rc) setTooltip({ x: ev.clientX - rc.left + 12, y: ev.clientY - rc.top - 8, label, value, depth: growthMetric === 'revenue' ? 'Revenue' : 'OM £' });
    };
    const moveSeg = (ev: MouseEvent) => {
      const rc = wrapperRef.current?.getBoundingClientRect();
      if (rc) setTooltip((pv) => pv ? { ...pv, x: ev.clientX - rc.left + 12, y: ev.clientY - rc.top - 8 } : null);
    };

    const metricLabel = `${growthMetric === 'revenue' ? 'Revenue' : 'Operating Margin'} (£) by group${showGrowth ? ` — existing + ${growthPct}% growth` : ''}`;

    if (!vertical) {
      const xScale = d3.scaleLinear().domain([0, maxV * 1.02]).range([0, iW]);
      const yOuter = d3.scaleBand<string>().domain(categories).range([0, iH]).padding(0.25);
      const yInner = d3.scaleBand<string>().domain(data.map((d) => d.name)).range([0, yOuter.bandwidth()]).padding(0.12);

      g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).ticks(Math.floor(iW / 90)).tickFormat((d) => fmtGbp(+d)))
        .selectAll('text').attr('font-size', '8px');
      g.append('g').call(d3.axisLeft(yOuter)).selectAll('text').attr('font-size', '9px').attr('font-weight', '600');
      g.append('text').attr('x', iW / 2).attr('y', iH + 30).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666').text(metricLabel);
      g.append('g').attr('class', 'gx').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(xScale).ticks(Math.floor(iW / 90)).tickSize(-iH).tickFormat(() => ''))
        .selectAll('line').attr('stroke', '#eee');
      g.selectAll('.gx .domain').remove();

      for (const cat of categories) {
        const yBase = yOuter(cat)!;
        const base = catColors.get(cat) ?? '#999';
        let catTotal = 0;
        let maxEnd = 0;
        data.forEach((d, gi) => {
          const c = cell(gi, cat);
          if (!c) return;
          const y = yBase + yInner(d.name)!;
          const bh = yInner.bandwidth();
          const fill = shade(base, gi);
          const barW = xScale(c.total);
          // Approximate width the in-bar group name will occupy, so the
          // first compound segment's label can dodge it.
          const groupLabelW = barW > 26 && bh >= 9
            ? Math.min(d.name.length, Math.max(2, Math.floor((barW - 8) / 4.3))) * 4.3 + 8
            : 0;
          if (!compound) {
            g.append('rect').attr('x', 0).attr('y', y).attr('width', barW).attr('height', bh)
              .attr('fill', fill).attr('fill-opacity', 0.92).attr('rx', 2).style('cursor', 'pointer')
              .on('mouseenter', hoverSeg(`${cat} · ${d.name}`, `${fmtGbp(c.total)} · ${c.n} SKUs · avg ${fmtGbp(c.avg)}/SKU`))
              .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
            const unitPx = xScale(c.avg);
            const step = unitTickStep(unitPx);
            if (step > 0) {
              let drawn = 0;
              for (let u = step; u * unitPx < barW && drawn < 800; u += step) {
                g.append('line').attr('x1', u * unitPx).attr('x2', u * unitPx).attr('y1', y).attr('y2', y + bh)
                  .attr('stroke', '#fff').attr('stroke-width', 0.75).attr('opacity', 0.7);
                drawn++;
              }
            }
          } else {
            let cv = 0;
            segOrder.forEach((si, pi) => {
              const sv = c.segs[si];
              if (sv <= 0) return;
              const x0 = xScale(cv), x1 = xScale(cv + sv);
              const segFill = segShade(fill, pi);
              g.append('rect').attr('x', x0).attr('y', y).attr('width', Math.max(0, x1 - x0)).attr('height', bh)
                .attr('fill', segFill).attr('fill-opacity', 0.95).attr('stroke', '#fff').attr('stroke-width', 0.75)
                .style('cursor', 'pointer')
                .on('mouseenter', hoverSeg(`${cat} · ${d.name} · ${segNames[si]}`, `${fmtGbp(sv)} · ${c.segNs[si]} SKU${c.segNs[si] !== 1 ? 's' : ''}`))
                .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
              // Segment name (plus its value when it fits) inside the
              // segment, dodging the group name at the start of the bar.
              const lx0 = si === 0 ? x0 + groupLabelW + 4 : x0;
              const segW = x1 - lx0;
              if (segW > 26 && bh >= 9) {
                const maxChars = Math.max(2, Math.floor((segW - 6) / 3.8));
                const withVal = `${segNames[si]} ${fmtGbp(sv)}`;
                const sl = withVal.length <= maxChars ? withVal
                  : segNames[si].length <= maxChars ? segNames[si]
                  : segNames[si].slice(0, Math.max(1, maxChars - 1)) + '…';
                const st = g.append('text').attr('x', (lx0 + x1) / 2).attr('y', y + bh / 2 + 2.2).attr('text-anchor', 'middle')
                  .attr('font-size', '6.5px').attr('font-weight', '600')
                  .attr('fill', d3.hsl(segFill).l > 0.62 ? '#444' : 'rgba(255,255,255,0.95)')
                  .style('pointer-events', 'none').text(sl);
                st.append('title').text(`${segNames[si]} — ${fmtGbp(sv)}`);
              }
              cv += sv;
            });
          }
          let endX = barW;
          if (showGrowth && c.inc > 0) {
            g.append('rect').attr('x', barW).attr('y', y)
              .attr('width', Math.max(0, xScale(c.total + c.inc) - barW)).attr('height', bh)
              .attr('fill', d3.interpolateLab(fill, '#ffffff')(0.5)).attr('stroke', fill).attr('stroke-width', 1).attr('stroke-dasharray', '3,2').attr('rx', 2)
              .style('cursor', 'pointer')
              .on('mouseenter', hoverSeg(`${cat} · ${d.name} — +${growthPct}%`, `${fmtGbp(c.inc)} ≈ ${c.skusNeeded} new SKU${c.skusNeeded !== 1 ? 's' : ''} @ avg ${fmtGbp(c.avg)}/SKU`))
              .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
            g.append('text').attr('x', xScale(c.total + c.inc) + 5).attr('y', y + bh / 2 + 3)
              .attr('font-size', '7.5px').attr('font-weight', '700').attr('fill', '#333')
              .text(`+${c.skusNeeded}`);
            endX = xScale(c.total + c.inc) + 10 + String(c.skusNeeded).length * 5;
          }
          // Group name inside the start of the bar.
          if (barW > 26 && bh >= 9) {
            const maxChars = Math.max(2, Math.floor((barW - 8) / 4.3));
            const gl = d.name.length > maxChars ? d.name.slice(0, Math.max(1, maxChars - 1)) + '…' : d.name;
            const gt = g.append('text').attr('x', 4).attr('y', y + bh / 2 + 2.5)
              .attr('font-size', '7px').attr('font-weight', '600').attr('fill', 'rgba(255,255,255,0.95)')
              .style('pointer-events', 'none').text(gl);
            gt.append('title').text(d.name);
          }
          // Bar total just past the end of the bar (after the growth
          // block and "+N" annotation when shown).
          const label = fmtGbp(c.total);
          g.append('text').attr('x', endX + 4).attr('y', y + bh / 2 + 3)
            .attr('font-size', '8.5px').attr('font-weight', '700').attr('fill', '#1a1a2e')
            .text(label);
          endX += 8 + label.length * 5;
          catTotal += c.total;
          maxEnd = Math.max(maxEnd, endX);
        });
        // Cumulative category total in a pill past the category's bars,
        // vertically centred on the category band.
        if (catTotal > 0) {
          const cl2 = fmtGbp(catTotal);
          const clw = cl2.length * 6 + 12;
          const cy = yBase + yOuter.bandwidth() / 2;
          g.append('rect').attr('x', maxEnd + 8).attr('y', cy - 7.5).attr('width', clw).attr('height', 15).attr('rx', 7.5)
            .attr('fill', '#fff').attr('fill-opacity', 0.85).attr('stroke', '#ddd').attr('stroke-width', 0.5);
          g.append('text').attr('x', maxEnd + 8 + clw / 2).attr('y', cy + 3.5).attr('text-anchor', 'middle')
            .attr('font-size', '10px').attr('font-weight', '700').attr('fill', '#1a1a2e')
            .text(cl2);
        }
      }
    } else {
      const xOuter = d3.scaleBand<string>().domain(categories).range([0, iW]).padding(0.25);
      const xInner = d3.scaleBand<string>().domain(data.map((d) => d.name)).range([0, xOuter.bandwidth()]).padding(0.12);
      const yScale = d3.scaleLinear().domain([0, maxV * 1.08]).range([iH, 0]);

      // Axis line + ticks only — the labels are drawn per bar (group
      // name) and per band (category name) in two rows below.
      g.append('g').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xOuter).tickFormat(() => ''));
      g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => fmtGbp(+d))).selectAll('text').attr('font-size', '8px');
      g.append('text').attr('x', -iH / 2).attr('y', -50).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)')
        .attr('font-size', '9px').attr('fill', '#666').text(metricLabel);
      g.append('g').attr('class', 'gy')
        .call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => ''))
        .selectAll('line').attr('stroke', '#eee');
      g.selectAll('.gy .domain').remove();

      for (const cat of categories) {
        const xBase = xOuter(cat)!;
        const base = catColors.get(cat) ?? '#999';
        // Category name centred under its band — row 2 of the axis labels.
        const catMaxChars = Math.max(3, Math.floor(xOuter.step() / 4.6));
        const cl = cat.length > catMaxChars ? cat.slice(0, catMaxChars - 1) + '…' : cat;
        const ct = g.append('text').attr('x', xBase + xOuter.bandwidth() / 2).attr('y', iH + 25).attr('text-anchor', 'middle')
          .attr('font-size', '8.5px').attr('font-weight', '700').attr('fill', '#333').text(cl);
        ct.append('title').text(cat);
        let catTotal = 0;
        let topY = Infinity;
        data.forEach((d, gi) => {
          const c = cell(gi, cat);
          if (!c) return;
          const x = xBase + xInner(d.name)!;
          const bw = xInner.bandwidth();
          const fill = shade(base, gi);
          if (!compound) {
            g.append('rect').attr('x', x).attr('y', yScale(c.total)).attr('width', bw).attr('height', iH - yScale(c.total))
              .attr('fill', fill).attr('fill-opacity', 0.92).attr('rx', 2).style('cursor', 'pointer')
              .on('mouseenter', hoverSeg(`${cat} · ${d.name}`, `${fmtGbp(c.total)} · ${c.n} SKUs · avg ${fmtGbp(c.avg)}/SKU`))
              .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
            const unitPx = yScale(0) - yScale(c.avg);
            const step = unitTickStep(unitPx);
            if (step > 0) {
              let drawn = 0;
              for (let u = step; u * c.avg < c.total && drawn < 800; u += step) {
                const vy = yScale(u * c.avg);
                g.append('line').attr('x1', x).attr('x2', x + bw).attr('y1', vy).attr('y2', vy)
                  .attr('stroke', '#fff').attr('stroke-width', 0.75).attr('opacity', 0.7);
                drawn++;
              }
            }
          } else {
            let cv = 0;
            segOrder.forEach((si, pi) => {
              const sv = c.segs[si];
              if (sv <= 0) return;
              const sy1 = yScale(cv), sy0 = yScale(cv + sv);
              const segFill = segShade(fill, pi);
              g.append('rect').attr('x', x).attr('y', sy0).attr('width', bw).attr('height', Math.max(0, sy1 - sy0))
                .attr('fill', segFill).attr('fill-opacity', 0.95).attr('stroke', '#fff').attr('stroke-width', 0.75)
                .style('cursor', 'pointer')
                .on('mouseenter', hoverSeg(`${cat} · ${d.name} · ${segNames[si]}`, `${fmtGbp(sv)} · ${c.segNs[si]} SKU${c.segNs[si] !== 1 ? 's' : ''}`))
                .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
              // Segment name inside when the segment is tall enough;
              // value on a second line when there is room for both.
              const segH = sy1 - sy0;
              if (segH >= 10 && bw > 22) {
                const maxChars = Math.max(2, Math.floor((bw - 4) / 3.8));
                const sl = segNames[si].length > maxChars ? segNames[si].slice(0, Math.max(1, maxChars - 1)) + '…' : segNames[si];
                const segTextFill = d3.hsl(segFill).l > 0.62 ? '#444' : 'rgba(255,255,255,0.95)';
                const twoLine = segH >= 20;
                const st = g.append('text').attr('x', x + bw / 2).attr('y', (sy0 + sy1) / 2 + (twoLine ? -1.5 : 2.2)).attr('text-anchor', 'middle')
                  .attr('font-size', '6.5px').attr('font-weight', '600')
                  .attr('fill', segTextFill).style('pointer-events', 'none').text(sl);
                st.append('title').text(`${segNames[si]} — ${fmtGbp(sv)}`);
                if (twoLine) {
                  g.append('text').attr('x', x + bw / 2).attr('y', (sy0 + sy1) / 2 + 7).attr('text-anchor', 'middle')
                    .attr('font-size', '6px').attr('font-weight', '700')
                    .attr('fill', segTextFill).style('pointer-events', 'none').text(fmtGbp(sv));
                }
              }
              cv += sv;
            });
          }
          let barTop = yScale(c.total);
          if (showGrowth && c.inc > 0) {
            const y0 = yScale(c.total + c.inc), y1 = yScale(c.total);
            g.append('rect').attr('x', x).attr('y', y0).attr('width', bw).attr('height', Math.max(0, y1 - y0))
              .attr('fill', d3.interpolateLab(fill, '#ffffff')(0.5)).attr('stroke', fill).attr('stroke-width', 1).attr('stroke-dasharray', '3,2').attr('rx', 2)
              .style('cursor', 'pointer')
              .on('mouseenter', hoverSeg(`${cat} · ${d.name} — +${growthPct}%`, `${fmtGbp(c.inc)} ≈ ${c.skusNeeded} new SKU${c.skusNeeded !== 1 ? 's' : ''} @ avg ${fmtGbp(c.avg)}/SKU`))
              .on('mousemove', moveSeg).on('mouseleave', () => setTooltip(null));
            g.append('text').attr('x', x + bw / 2).attr('y', y0 - 4).attr('text-anchor', 'middle')
              .attr('font-size', '7.5px').attr('font-weight', '700').attr('fill', '#333')
              .text(`+${c.skusNeeded}`);
            barTop = y0 - 12;
          }
          // Group name just below the axis line — row 1 of the labels.
          const maxChars = Math.max(2, Math.floor(bw / 4));
          const gl = d.name.length > maxChars ? d.name.slice(0, Math.max(1, maxChars - 1)) + '…' : d.name;
          const gt = g.append('text').attr('x', x + bw / 2).attr('y', iH + 12).attr('text-anchor', 'middle')
            .attr('font-size', '7px').attr('font-weight', '600').attr('fill', '#555').text(gl);
          gt.append('title').text(d.name);
          // Bar total in a pill above the bar (above the growth block
          // and its "+N" annotation when those are shown).
          const label = fmtGbp(c.total);
          const labelW = label.length * 5.5 + 10;
          const pillBottom = showGrowth && c.inc > 0 ? yScale(c.total + c.inc) - 12 : yScale(c.total) - 2;
          g.append('rect').attr('x', x + bw / 2 - labelW / 2).attr('y', pillBottom - 13).attr('width', labelW).attr('height', 13).attr('rx', 6.5)
            .attr('fill', '#fff').attr('fill-opacity', 0.8).style('pointer-events', 'none');
          g.append('text').attr('x', x + bw / 2).attr('y', pillBottom - 3.5).attr('text-anchor', 'middle')
            .attr('font-size', '8.5px').attr('font-weight', '700').attr('fill', '#1a1a2e')
            .style('pointer-events', 'none').text(label);
          barTop = pillBottom - 15;
          catTotal += c.total;
          topY = Math.min(topY, barTop);
        });
        // Cumulative category total floating above the tallest bar,
        // centred on the category band.
        if (catTotal > 0 && isFinite(topY)) {
          const label = fmtGbp(catTotal);
          const labelW = label.length * 6 + 12;
          const cx = xBase + xOuter.bandwidth() / 2;
          const ty = Math.max(topY - 8, -margin.top + 14);
          g.append('rect').attr('x', cx - labelW / 2).attr('y', ty - 11).attr('width', labelW).attr('height', 15).attr('rx', 7.5)
            .attr('fill', '#fff').attr('fill-opacity', 0.85).style('pointer-events', 'none');
          g.append('text').attr('x', cx).attr('y', ty).attr('text-anchor', 'middle')
            .attr('font-size', '10px').attr('font-weight', '700').attr('fill', '#1a1a2e')
            .style('pointer-events', 'none').text(label);
        }
      }
    }

    // Summary overlay: cumulative totals card in the top-right corner —
    // grand total, per-group cross-category totals, and (in compound
    // view) compound-group cross-category totals.
    if (showSummary) {
      const grand = data.reduce((sm, d) => {
        for (const e of d.catMap.values()) sm += e.total;
        return sm;
      }, 0);
      const groupTotals = data.map((d) => {
        let t = 0;
        for (const e of d.catMap.values()) t += e.total;
        return { name: d.name, total: t };
      });
      const segTotals = segOrder.map((si) => {
        let t = 0;
        for (const d of data) for (const e of d.catMap.values()) t += e.segs[si] ?? 0;
        return { name: segNames[si], total: t };
      });
      type Row = { label: string; value?: string; header?: boolean; bold?: boolean };
      const rows: Row[] = [
        { label: growthMetric === 'revenue' ? 'Total Revenue' : 'Total OM £', value: fmtGbp(grand), bold: true },
        { label: groupsTitle.trim() || 'Groups', header: true },
        ...groupTotals.map((t) => ({ label: t.name, value: fmtGbp(t.total) })),
      ];
      if (compound) {
        rows.push({ label: compoundsTitle.trim() || 'Compound groups', header: true });
        rows.push(...segTotals.filter((t) => t.total > 0).map((t) => ({ label: t.name, value: fmtGbp(t.total) })));
      }
      const rowH = 11, headH = 12, pad = 8;
      const clip = (s: string) => s.length > 22 ? s.slice(0, 21) + '…' : s;
      const w = Math.max(120, ...rows.map((r) => clip(r.label).length * 4.4 + (r.value ? r.value.length * 5 : 0) + 26));
      const h = pad * 2 + rows.reduce((sm, r) => sm + (r.header ? headH : rowH), 0);
      const panel = g.append('g').attr('transform', `translate(${iW - w},0)`);
      panel.append('rect').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h).attr('rx', 5)
        .attr('fill', '#fff').attr('fill-opacity', 0.92).attr('stroke', '#ddd').attr('stroke-width', 0.75);
      let ry = pad;
      for (const r of rows) {
        if (r.header) {
          ry += headH;
          panel.append('text').attr('x', 8).attr('y', ry - 3)
            .attr('font-size', '6.5px').attr('font-weight', '700').attr('fill', '#999')
            .attr('letter-spacing', '0.5').text(r.label.toUpperCase());
          panel.append('line').attr('x1', 8).attr('x2', w - 8).attr('y1', ry - 12).attr('y2', ry - 12)
            .attr('stroke', '#eee').attr('stroke-width', 0.75);
        } else {
          ry += rowH;
          const lt = panel.append('text').attr('x', 8).attr('y', ry - 3)
            .attr('font-size', '8px').attr('font-weight', r.bold ? '700' : '400')
            .attr('fill', r.bold ? '#1a1a2e' : '#555').text(clip(r.label));
          if (r.label.length > 22) lt.append('title').text(r.label);
          panel.append('text').attr('x', w - 8).attr('y', ry - 3).attr('text-anchor', 'end')
            .attr('font-size', '8px').attr('font-weight', '700').attr('fill', '#1a1a2e').text(r.value ?? '');
        }
      }
    }
  }, [data, groups.length, compounds.length, segNames, restIndex, groupsTitle, compoundsTitle, dims, wrapperRef, catColors, growthPct, growthMetric, showGrowth, vertical, textScale, showSummary]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width / textScale} ${dims.height / textScale}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}
