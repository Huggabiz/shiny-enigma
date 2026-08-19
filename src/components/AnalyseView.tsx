import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import type { Lens, MatrixCellAssignment, Product, RangePlan, Shelf, ShelfItem } from '../types';
import './AnalyseView.css';

type Metric = 'rrp' | 'revenue' | 'margin';
type AspMode = 'standard' | 'weighted';
type SheetId = 'icicle' | 'scatter' | 'sunburst';

const SHEETS: { id: SheetId; label: string }[] = [
  { id: 'icicle', label: 'Icicle' },
  { id: 'scatter', label: 'Scatter' },
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
  ['#1976d2', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9'],
  ['#388e3c', '#43a047', '#66bb6a', '#81c784', '#a5d6a7'],
  ['#f57c00', '#fb8c00', '#ffa726', '#ffb74d', '#ffcc80'],
  ['#7b1fa2', '#8e24aa', '#ab47bc', '#ba68c8', '#ce93d8'],
  ['#c62828', '#d32f2f', '#e53935', '#ef5350', '#ef9a9a'],
  ['#00838f', '#0097a7', '#00acc1', '#26c6da', '#4dd0e1'],
];

function getCategoryColor(node: d3.HierarchyNode<HierNode>, root: d3.HierarchyNode<HierNode>): string {
  let a = node; while (a.depth > 1 && a.parent) a = a.parent;
  const ci = (root.children ?? []).indexOf(a) % RING_COLORS.length;
  const p = RING_COLORS[ci < 0 ? 0 : ci];
  return p[Math.min(node.depth - 1, p.length - 1)];
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

interface ChartProps { plans: RangePlan[]; catalogue: Product[]; metric: Metric; shelfSide: string; activeLens?: Lens | null; aspMode: AspMode; showSegments: boolean; }

// Per-sheet config state that persists across tab switches
interface IcicleConfig { metric: Metric; aspMode: AspMode; showSegments: boolean; }
interface ScatterConfig { logX: boolean; logY: boolean; maxX: string; maxY: string; dotSize: number; }

export function AnalyseView() {
  const { project, clearAnalyseEntries } = useProjectStore();

  const [shelfSide, setShelfSide] = useState('current');
  const [activeSheet, setActiveSheet] = useState<SheetId>('icicle');

  // Per-sheet config persisted across tab switches
  const [icicleConfig, setIcicleConfig] = useState<IcicleConfig>({ metric: 'revenue', aspMode: 'standard', showSegments: true });
  const [scatterConfig, setScatterConfig] = useState<ScatterConfig>({ logX: false, logY: false, maxX: '', maxY: '', dotSize: 5 });
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

  if (!project) return null;

  const chartProps: ChartProps = {
    plans: selectedPlans, catalogue: project.catalogue,
    metric: icicleConfig.metric, shelfSide, activeLens,
    aspMode: icicleConfig.aspMode, showSegments: icicleConfig.showSegments,
  };

  const updateIcicle = (patch: Partial<IcicleConfig>) => setIcicleConfig((c) => ({ ...c, ...patch }));
  const updateScatter = (patch: Partial<ScatterConfig>) => setScatterConfig((c) => ({ ...c, ...patch }));

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
            <div className="analyse-canvas">
              {activeSheet === 'icicle' ? <Icicle {...chartProps} /> : activeSheet === 'scatter' ? <ScatterPlot plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} config={scatterConfig} /> : <Sunburst {...chartProps} />}
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
            </div>
          )}
          {activeSheet === 'scatter' && (
            <div className="analyse-chart-config">
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
            </div>
          )}

          <div className="analyse-sheet-tabs">
            {SHEETS.map((s) => (
              <button key={s.id} className={`analyse-sheet-tab ${activeSheet === s.id ? 'active' : ''}`} onClick={() => setActiveSheet(s.id)}>{s.label}</button>
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

function Sunburst({ plans, catalogue, metric, shelfSide, showSegments }: ChartProps) {
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
    g.selectAll('path').data(nodes).join('path').attr('d', arc as any).attr('fill', (d) => getCategoryColor(d, part)).attr('fill-opacity', (d) => 1 - d.depth * 0.08).attr('stroke', '#fff').attr('stroke-width', 0.5).style('cursor', 'pointer')
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
  }, [data, dims, metric, wrapperRef, showSegments]);

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

function Icicle({ plans, catalogue, metric, shelfSide, activeLens, aspMode, showSegments }: ChartProps) {
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
      .attr('fill', (d) => (d.depth === leaf && activeLens && isInLens(d, activeLens, shelfSide)) ? activeLens.color : getCategoryColor(d, part))
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
  }, [data, dims, metric, wrapperRef, activeLens, shelfSide, aspMode, cw, md, dl]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
}

// ---------- Scatter ----------

const SCAT_COLORS = ['#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c62828', '#00838f', '#5d4037', '#455a64', '#e91e63', '#00bcd4', '#8bc34a', '#ff9800'];

interface ScatterPoint { sku: string; name: string; category: string; subCategory: string; rrp: number; margin: number; }

function ScatterPlot({ plans, catalogue, shelfSide, config }: { plans: RangePlan[]; catalogue: Product[]; shelfSide: string; config: ScatterConfig }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const points = useMemo(() => {
    const seen = new Set<string>(), pts: ScatterPoint[] = [];
    for (const plan of plans) { const shelf = resolveShelf(plan, shelfSide); if (!shelf) continue;
      for (const item of shelf.items) { const prod = getProductForItem(item, catalogue); if (!prod || seen.has(prod.id)) continue; seen.add(prod.id);
        const rrp = prod.rrp ?? 0, margin = prod.operatingMarginGbp ?? 0;
        if (rrp <= 0 && margin === 0) continue;
        pts.push({ sku: prod.sku, name: prod.name, category: prod.category || 'Uncategorised', subCategory: prod.subCategory || '', rrp, margin });
      }
    } return pts;
  }, [plans, catalogue, shelfSide]);

  const categories = useMemo(() => { const m = new Map<string, Set<string>>(); for (const p of points) { if (!m.has(p.category)) m.set(p.category, new Set()); if (p.subCategory) m.get(p.category)!.add(p.subCategory); } return m; }, [points]);

  const colorMap = useMemo(() => {
    const m = new Map<string, string>(); let i = 0;
    for (const [cat, subs] of categories) {
      const b = SCAT_COLORS[i % SCAT_COLORS.length]; m.set(cat, b);
      Array.from(subs).forEach((sub, si, arr) => { m.set(`${cat}::${sub}`, d3.interpolateLab(b, '#fff')(0.15 + (si / Math.max(1, arr.length)) * 0.35)); });
      i++;
    } return m;
  }, [categories]);

  const { logX, logY, dotSize } = config;
  const maxXN = config.maxX ? Number(config.maxX) : undefined;
  const maxYN = config.maxY ? Number(config.maxY) : undefined;

  useEffect(() => {
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove();
    const { width, height } = dims;
    const margin = { top: 12, right: 12, bottom: 40, left: 60 };
    const iW = width - margin.left - margin.right, iH = height - margin.top - margin.bottom;
    if (iW < 20 || iH < 20 || points.length === 0) return;

    const xE = d3.extent(points, (p) => p.margin) as [number, number];
    const yE = d3.extent(points, (p) => p.rrp) as [number, number];
    const xMax = (maxXN != null && maxXN > 0) ? maxXN : xE[1];
    const yMax = (maxYN != null && maxYN > 0) ? maxYN : yE[1];

    let xScale: d3.ScaleLogarithmic<number, number> | d3.ScaleLinear<number, number>;
    let yScale: d3.ScaleLogarithmic<number, number> | d3.ScaleLinear<number, number>;
    if (logX) { const lo = Math.max(1, Math.min(...points.map((p) => p.margin).filter((v) => v > 0))); xScale = d3.scaleLog().domain([lo * 0.8, xMax * 1.05]).range([0, iW]).clamp(true); }
    else { const p = (xMax - xE[0]) * 0.05 || 1; xScale = d3.scaleLinear().domain([xE[0] - p, xMax + p]).range([0, iW]); }
    if (logY) { const lo = Math.max(0.01, Math.min(...points.map((p) => p.rrp).filter((v) => v > 0))); yScale = d3.scaleLog().domain([lo * 0.8, yMax * 1.05]).range([iH, 0]).clamp(true); }
    else { const p = (yMax - yE[0]) * 0.05 || 1; yScale = d3.scaleLinear().domain([yE[0] - p, yMax + p]).range([iH, 0]); }

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    g.append('g').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(Math.floor(iW / 80)).tickFormat((d) => `£${d3.format(',.0f')(d as number)}`)).selectAll('text').attr('font-size', '8px');
    g.append('g').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickFormat((d) => `£${d3.format(',.2f')(d as number)}`)).selectAll('text').attr('font-size', '8px');
    g.append('text').attr('x', iW / 2).attr('y', iH + 32).attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#666').text(`Operating Margin (£)${logX ? ' — log' : ''}`);
    g.append('text').attr('x', -iH / 2).attr('y', -44).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)').attr('font-size', '9px').attr('fill', '#666').text(`RRP (£)${logY ? ' — log' : ''}`);
    g.append('g').attr('class', 'gx').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(Math.floor(iW / 80)).tickSize(-iH).tickFormat(() => '')).selectAll('line').attr('stroke', '#eee');
    g.append('g').attr('class', 'gy').call(d3.axisLeft(yScale).ticks(Math.floor(iH / 40)).tickSize(-iW).tickFormat(() => '')).selectAll('line').attr('stroke', '#eee');
    g.selectAll('.gx .domain, .gy .domain').remove();

    const vis = points.filter((p) => { if (logX && p.margin <= 0) return false; if (logY && p.rrp <= 0) return false; return true; });
    g.selectAll('circle').data(vis).join('circle')
      .attr('cx', (d) => xScale(d.margin)).attr('cy', (d) => yScale(d.rrp)).attr('r', dotSize)
      .attr('fill', (d) => { const k = d.subCategory ? `${d.category}::${d.subCategory}` : d.category; return colorMap.get(k) ?? colorMap.get(d.category) ?? '#999'; })
      .attr('fill-opacity', 0.75).attr('stroke', (d) => colorMap.get(d.category) ?? '#999').attr('stroke-width', 1).style('cursor', 'pointer')
      .on('mouseenter', function (ev, d) { d3.select(this).attr('r', dotSize + 2).attr('fill-opacity', 1).attr('stroke-width', 2); const r = wrapperRef.current?.getBoundingClientRect(); if (r) setTooltip({ x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8, label: `${d.sku} — ${d.name}`, value: `RRP: £${d.rrp.toFixed(2)} | OM: £${d.margin.toLocaleString()}`, depth: d.subCategory ? `${d.category} / ${d.subCategory}` : d.category }); })
      .on('mousemove', function (ev) { const r = wrapperRef.current?.getBoundingClientRect(); if (r) setTooltip((p) => p ? { ...p, x: ev.clientX - r.left + 12, y: ev.clientY - r.top - 8 } : null); })
      .on('mouseleave', function () { d3.select(this).attr('r', dotSize).attr('fill-opacity', 0.75).attr('stroke-width', 1); setTooltip(null); });

    // Legend — inside plot, top-left, vertically stacked
    const lG = g.append('g').attr('transform', 'translate(8, 4)');
    let ly = 0;
    for (const [cat] of categories) {
      const c = colorMap.get(cat) ?? '#999';
      lG.append('rect').attr('x', -4).attr('y', ly - 3).attr('width', cat.length * 5.5 + 22).attr('height', 15).attr('fill', '#fff').attr('fill-opacity', 0.88).attr('rx', 2);
      lG.append('circle').attr('cx', 4).attr('cy', ly + 5).attr('r', 4).attr('fill', c);
      lG.append('text').attr('x', 12).attr('y', ly + 8).attr('font-size', '8px').attr('fill', '#555').text(cat);
      ly += 16;
    }
  }, [points, dims, wrapperRef, colorMap, categories, logX, logY, maxXN, maxYN, dotSize]);

  return (<div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}><svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" /><ChartTooltip tooltip={tooltip} /></div>);
}
