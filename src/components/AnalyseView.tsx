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

const METRIC_LABEL: Record<Metric, string> = {
  revenue: 'Historic Revenue',
  rrp: 'RRP',
  margin: 'Operating Margin (£)',
};

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
  if (item.isPlaceholder && item.placeholderData) {
    return item.placeholderData as unknown as Product;
  }
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

function buildHierarchyData(
  plans: RangePlan[], catalogue: Product[], metric: Metric,
  shelfSide: string, showSegments: boolean,
): HierNode {
  return showSegments
    ? buildWithSegments(plans, catalogue, metric, shelfSide)
    : buildWithoutSegments(plans, catalogue, metric, shelfSide);
}

function buildWithSegments(
  plans: RangePlan[], catalogue: Product[], metric: Metric, shelfSide: string,
): HierNode {
  const categoryMap = new Map<string, Map<string, Map<string, { name: string; sku: string; value: number; productId: string; revenue: number }[]>>>();

  for (const plan of plans) {
    const shelf = resolveShelf(plan, shelfSide);
    if (!shelf) continue;
    for (const item of shelf.items) {
      const prod = getProductForItem(item, catalogue);
      if (!prod) continue;
      const cat = prod.category || 'Uncategorised';
      const segment = getSegmentLabel(shelf, item);
      const val = metricValue(prod, metric);
      if (val <= 0) continue;
      if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
      const planMap = categoryMap.get(cat)!;
      if (!planMap.has(plan.name)) planMap.set(plan.name, new Map());
      const segMap = planMap.get(plan.name)!;
      if (!segMap.has(segment)) segMap.set(segment, []);
      segMap.get(segment)!.push({
        name: prod.name, sku: prod.sku, value: val,
        productId: prod.id, revenue: prod.revenue ?? 0,
      });
    }
  }

  const children: HierNode[] = [];
  for (const [cat, planMap] of categoryMap) {
    const planChildren: HierNode[] = [];
    let catSkuCount = 0, catRevenue = 0, catWeighted = 0;
    for (const [planName, segMap] of planMap) {
      const segChildren: HierNode[] = [];
      let planSkuCount = 0, planRevenue = 0, planWeighted = 0;
      for (const [seg, skus] of segMap) {
        const segRevenue = skus.reduce((s, x) => s + x.revenue, 0);
        const segWeighted = skus.reduce((s, x) => s + (x.value * x.revenue), 0);
        const skuNodes: HierNode[] = skus.map((s) => ({
          name: `${s.sku} — ${s.name}`, value: s.value, productId: s.productId,
          skuCount: 1, totalRevenue: s.revenue, weightedRrpSum: s.value * s.revenue,
        }));
        segChildren.push({ name: seg, children: skuNodes, skuCount: skus.length, totalRevenue: segRevenue, weightedRrpSum: segWeighted });
        planSkuCount += skus.length; planRevenue += segRevenue; planWeighted += segWeighted;
      }
      planChildren.push({ name: planName, children: segChildren, skuCount: planSkuCount, totalRevenue: planRevenue, weightedRrpSum: planWeighted });
      catSkuCount += planSkuCount; catRevenue += planRevenue; catWeighted += planWeighted;
    }
    children.push({ name: cat, children: planChildren, skuCount: catSkuCount, totalRevenue: catRevenue, weightedRrpSum: catWeighted });
  }
  return { name: 'All', children };
}

function buildWithoutSegments(
  plans: RangePlan[], catalogue: Product[], metric: Metric, shelfSide: string,
): HierNode {
  const categoryMap = new Map<string, Map<string, { name: string; sku: string; value: number; productId: string; revenue: number }[]>>();

  for (const plan of plans) {
    const shelf = resolveShelf(plan, shelfSide);
    if (!shelf) continue;
    for (const item of shelf.items) {
      const prod = getProductForItem(item, catalogue);
      if (!prod) continue;
      const cat = prod.category || 'Uncategorised';
      const val = metricValue(prod, metric);
      if (val <= 0) continue;
      if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
      const planMap = categoryMap.get(cat)!;
      if (!planMap.has(plan.name)) planMap.set(plan.name, []);
      planMap.get(plan.name)!.push({
        name: prod.name, sku: prod.sku, value: val,
        productId: prod.id, revenue: prod.revenue ?? 0,
      });
    }
  }

  const children: HierNode[] = [];
  for (const [cat, planMap] of categoryMap) {
    const planChildren: HierNode[] = [];
    let catSkuCount = 0, catRevenue = 0, catWeighted = 0;
    for (const [planName, skus] of planMap) {
      const planRevenue = skus.reduce((s, x) => s + x.revenue, 0);
      const planWeighted = skus.reduce((s, x) => s + (x.value * x.revenue), 0);
      const skuNodes: HierNode[] = skus.map((s) => ({
        name: `${s.sku} — ${s.name}`, value: s.value, productId: s.productId,
        skuCount: 1, totalRevenue: s.revenue, weightedRrpSum: s.value * s.revenue,
      }));
      planChildren.push({ name: planName, children: skuNodes, skuCount: skus.length, totalRevenue: planRevenue, weightedRrpSum: planWeighted });
      catSkuCount += skus.length; catRevenue += planRevenue; catWeighted += planWeighted;
    }
    children.push({ name: cat, children: planChildren, skuCount: catSkuCount, totalRevenue: catRevenue, weightedRrpSum: catWeighted });
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
  let ancestor = node;
  while (ancestor.depth > 1 && ancestor.parent) ancestor = ancestor.parent;
  const catIdx = (root.children ?? []).indexOf(ancestor) % RING_COLORS.length;
  const palette = RING_COLORS[catIdx < 0 ? 0 : catIdx];
  const shade = Math.min(node.depth - 1, palette.length - 1);
  return palette[shade];
}

function formatValue(v: number, metric: Metric): string {
  if (metric === 'rrp') return `£${v.toFixed(2)}`;
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `£${(v / 1_000).toFixed(0)}K`;
  return `£${v.toFixed(0)}`;
}

function formatMetricLabel(
  value: number, metric: Metric, isLeaf: boolean,
  skuCount: number, aspMode: AspMode, totalRevenue: number, weightedRrpSum: number,
): string {
  if (metric === 'revenue' || metric === 'margin') {
    return formatValue(value, 'revenue');
  }
  if (isLeaf) return `£${value.toFixed(2)}`;
  if (skuCount > 0) {
    if (aspMode === 'weighted' && totalRevenue > 0) {
      const wAsp = weightedRrpSum / totalRevenue;
      return `wASP £${wAsp.toFixed(2)}`;
    }
    const asp = value / skuCount;
    return `ASP £${asp.toFixed(2)}`;
  }
  return formatValue(value, 'rrp');
}

interface ChartProps {
  plans: RangePlan[];
  catalogue: Product[];
  metric: Metric;
  shelfSide: string;
  activeLens?: Lens | null;
  aspMode: AspMode;
  showSegments: boolean;
}

export function AnalyseView() {
  const {
    project,
    clearAnalyseEntries,
  } = useProjectStore();

  const [metric, setMetric] = useState<Metric>('revenue');
  const [shelfSide, setShelfSide] = useState('current');
  const [activeSheet, setActiveSheet] = useState<SheetId>('icicle');
  const [aspMode, setAspMode] = useState<AspMode>('standard');
  const [showSegments, setShowSegments] = useState(true);

  const analyseView = project?.analyseView ?? { entries: [] };
  const entries = analyseView.entries;

  const selectedPlans = useMemo(() => {
    if (!project) return [];
    return entries
      .map((e) => project.plans.find((p) => p.id === e.planId))
      .filter((p): p is RangePlan => p != null);
  }, [entries, project]);

  const activeLens = useMemo(() => {
    const ids = project?.activeLensIds ?? [];
    if (ids.length === 0) return null;
    const lenses = project?.lenses ?? [];
    return lenses.find((l) => l.id === ids[0]) ?? null;
  }, [project?.activeLensIds, project?.lenses]);

  const firstPlan = project ? getActivePlan(project) : undefined;
  const stagesForToggle = useMemo(() => {
    const all = firstPlan && project ? getStages(firstPlan, project) : [];
    const vk = project?.visibleStageKeys;
    if (!vk || vk.length === 0) return all;
    const filtered = all.filter((s) => vk.includes(s.key));
    return filtered.length > 0 ? filtered : all;
  }, [firstPlan, project]);

  if (!project) return null;

  const chartProps: ChartProps = {
    plans: selectedPlans,
    catalogue: project.catalogue,
    metric,
    shelfSide,
    activeLens,
    aspMode,
    showSegments,
  };

  return (
    <div className="analyse-view">
      <div className="analyse-toolbar">
        <h2 className="analyse-title">Analyse</h2>
        <div className="analyse-metric-toggle" role="tablist">
          {stagesForToggle.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={shelfSide === s.key}
              className={shelfSide === s.key ? 'active' : ''}
              onClick={() => setShelfSide(s.key)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="analyse-metric-toggle" role="tablist">
          <button role="tab" aria-selected={metric === 'revenue'} className={metric === 'revenue' ? 'active' : ''} onClick={() => setMetric('revenue')}>Revenue</button>
          <button role="tab" aria-selected={metric === 'rrp'} className={metric === 'rrp' ? 'active' : ''} onClick={() => setMetric('rrp')}>RRP</button>
          <button role="tab" aria-selected={metric === 'margin'} className={metric === 'margin' ? 'active' : ''} onClick={() => setMetric('margin')}>OM £</button>
        </div>
        {metric === 'rrp' && (
          <div className="analyse-metric-toggle" role="tablist">
            <button role="tab" aria-selected={aspMode === 'standard'} className={aspMode === 'standard' ? 'active' : ''} onClick={() => setAspMode('standard')}>ASP</button>
            <button role="tab" aria-selected={aspMode === 'weighted'} className={aspMode === 'weighted' ? 'active' : ''} onClick={() => setAspMode('weighted')}>Weighted ASP</button>
          </div>
        )}
        <div className="analyse-toolbar-actions">
          <label className="analyse-show-segments" title="Show matrix segment column between Plan and SKU">
            <input type="checkbox" checked={showSegments} onChange={(e) => setShowSegments(e.target.checked)} />
            Segments
          </label>
          {activeLens && (
            <span className="analyse-toolbar-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: activeLens.color, display: 'inline-block' }} />
              {activeLens.name}
            </span>
          )}
          <span className="analyse-toolbar-meta">
            {selectedPlans.length} plan{selectedPlans.length === 1 ? '' : 's'}
          </span>
          {entries.length > 0 && (
            <button className="analyse-clear" onClick={() => { if (confirm('Clear all selected plans from analyse view?')) clearAnalyseEntries(); }}>Clear</button>
          )}
        </div>
      </div>

      {selectedPlans.length === 0 ? (
        <div className="analyse-empty">
          <h3>No plans selected</h3>
          <p>
            Tick the checkboxes in the <strong>Range Plans</strong> sidebar
            on the left to add plans to the analysis. Each selected plan's
            products will appear in the category breakdown.
          </p>
        </div>
      ) : (
        <div className="analyse-body">
          <div className="analyse-canvas-wrapper">
            <div className="analyse-canvas">
              <div className="analyse-canvas-header">
                <h3>{activeSheet === 'scatter' ? 'RRP vs Operating Margin' : 'Category Breakdown'}</h3>
                <p>
                  {selectedPlans.map((p) => p.name).join(', ')}
                  {activeSheet !== 'scatter' && ` — by ${METRIC_LABEL[metric]}`}
                </p>
              </div>
              {activeSheet === 'icicle' ? (
                <Icicle {...chartProps} />
              ) : activeSheet === 'scatter' ? (
                <ScatterPlot plans={selectedPlans} catalogue={project.catalogue} shelfSide={shelfSide} />
              ) : (
                <Sunburst {...chartProps} />
              )}
            </div>
          </div>
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

// ---------- shared hook: measure container ----------

function useMeasure() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 450 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    (wrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setDims({ width: r.width, height: r.height });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    observerRef.current = obs;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { wrapperRef, dims, measureRef };
}

// ---------- Tooltip ----------

interface TooltipState { x: number; y: number; label: string; value: string; depth: string }

function ChartTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  return (
    <div
      className={`analyse-tooltip ${tooltip ? 'visible' : ''}`}
      style={tooltip ? { left: tooltip.x, top: tooltip.y } : undefined}
    >
      {tooltip && (
        <>
          {tooltip.depth && <div className="analyse-tooltip-value">{tooltip.depth}</div>}
          <div className="analyse-tooltip-label">{tooltip.label}</div>
          <div className="analyse-tooltip-value">{tooltip.value}</div>
        </>
      )}
    </div>
  );
}

// ---------- Sunburst ----------

function Sunburst({ plans, catalogue, metric, shelfSide, showSegments }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const data = useMemo(
    () => buildHierarchyData(plans, catalogue, metric, shelfSide, showSegments),
    [plans, catalogue, metric, shelfSide, showSegments],
  );

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dims;
    const radius = Math.min(width, height) / 2 * 0.82;

    const root = d3.hierarchy<HierNode>(data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if (!root.children || root.children.length === 0) return;

    const partitioned = d3.partition<HierNode>().size([2 * Math.PI, radius])(root) as d3.HierarchyRectangularNode<HierNode>;

    const arc = d3.arc<d3.HierarchyRectangularNode<HierNode>>()
      .startAngle((d) => d.x0).endAngle((d) => d.x1)
      .padAngle(0.002).padRadius(radius / 2)
      .innerRadius((d) => d.y0).outerRadius((d) => d.y1 - 1);

    const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    type RNode = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (partitioned.descendants() as RNode[]).filter((d) => d.depth > 0);
    const depthNames = showSegments ? ['', 'Category', 'Range Plan', 'Segment', 'SKU'] : ['', 'Category', 'Range Plan', 'SKU'];

    g.selectAll('path').data(nodes).join('path')
      .attr('d', arc as any)
      .attr('fill', (d) => getCategoryColor(d, partitioned))
      .attr('fill-opacity', (d) => 1 - d.depth * 0.08)
      .attr('stroke', '#fff').attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill-opacity', 1);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) setTooltip({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8, label: d.data.name, value: formatValue(d.value ?? 0, metric), depth: depthNames[d.depth] ?? '' });
      })
      .on('mousemove', function (event) {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) setTooltip((prev) => prev ? { ...prev, x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8 } : null);
      })
      .on('mouseleave', function (_event, d) { d3.select(this).attr('fill-opacity', 1 - d.depth * 0.08); setTooltip(null); });

    g.selectAll('text.cat-label').data(nodes.filter((d) => d.depth === 1 && (d.x1 - d.x0) > 0.15)).join('text').attr('class', 'cat-label')
      .attr('transform', (d) => { const a = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90; const r = (d.y0 + d.y1) / 2; return `rotate(${a}) translate(${r},0) rotate(${a > 90 ? 180 : 0})`; })
      .attr('text-anchor', 'middle').attr('dy', '0.35em').attr('font-size', '10px').attr('font-weight', '700').attr('fill', '#fff')
      .text((d) => { const m = Math.floor(((d.x1 - d.x0) * (d.y0 + d.y1) / 2) / 6); return d.data.name.length > m ? d.data.name.slice(0, m - 1) + '…' : d.data.name; });

    g.selectAll('text.plan-label').data(nodes.filter((d) => d.depth === 2 && (d.x1 - d.x0) > 0.2)).join('text').attr('class', 'plan-label')
      .attr('transform', (d) => { const a = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90; const r = (d.y0 + d.y1) / 2; return `rotate(${a}) translate(${r},0) rotate(${a > 90 ? 180 : 0})`; })
      .attr('text-anchor', 'middle').attr('dy', '0.35em').attr('font-size', '9px').attr('font-weight', '600').attr('fill', '#fff')
      .text((d) => { const m = Math.floor(((d.x1 - d.x0) * (d.y0 + d.y1) / 2) / 5.5); return d.data.name.length > m ? d.data.name.slice(0, m - 1) + '…' : d.data.name; });
  }, [data, dims, metric, wrapperRef, showSegments]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Icicle (horizontal) ----------

const ICICLE_COLS_WITH_SEG = [0.10, 0.10, 0.20, 0.20];
const ICICLE_COLS_NO_SEG   = [0.12, 0.12, 0.20];

function getSkuCount(node: d3.HierarchyNode<HierNode>): number {
  if (node.data.skuCount != null) return node.data.skuCount;
  return node.leaves().length;
}

function isInLens(node: d3.HierarchyNode<HierNode>, lens: Lens, stageKey: string): boolean {
  if (!node.data.productId) return false;
  if (lens.builtInKind) return false;
  if (lens.scope === 'per-stage') return lens.stageProductIds?.[stageKey]?.includes(node.data.productId) ?? false;
  return lens.productIds.includes(node.data.productId);
}

function Icicle({ plans, catalogue, metric, shelfSide, activeLens, aspMode, showSegments }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide, showSegments), [plans, catalogue, metric, shelfSide, showSegments]);
  const colWeights = showSegments ? ICICLE_COLS_WITH_SEG : ICICLE_COLS_NO_SEG;
  const maxDepth = colWeights.length;
  const depthLabels = showSegments ? ['', 'Category', 'Range Plan', 'Segment', 'SKU'] : ['', 'Category', 'Range Plan', 'SKU'];

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const { width, height } = dims;
    const margin = { top: 56, right: 4, bottom: 4, left: 4 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const root = d3.hierarchy<HierNode>(data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if (!root.children || root.children.length === 0) return;

    const partitioned = d3.partition<HierNode>().size([innerH, innerW]).padding(1)(root);
    const colStarts = [0];
    for (let i = 0; i < colWeights.length; i++) colStarts.push(colStarts[i] + colWeights[i] * innerW);

    type RNode = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (partitioned.descendants() as RNode[]).filter((d) => d.depth > 0 && d.depth <= maxDepth);
    for (const n of nodes) { const d = n.depth - 1; if (d < colWeights.length) { n.y0 = colStarts[d]; n.y1 = colStarts[d + 1]; } }

    const isLeafDepth = maxDepth;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    g.selectAll('rect').data(nodes).join('rect')
      .attr('x', (d) => d.y0).attr('y', (d) => d.x0)
      .attr('width', (d) => Math.max(0, d.y1 - d.y0 - 1)).attr('height', (d) => Math.max(0, d.x1 - d.x0))
      .attr('fill', (d) => { if (d.depth === isLeafDepth && activeLens && isInLens(d, activeLens, shelfSide)) return activeLens.color; return getCategoryColor(d, partitioned); })
      .attr('fill-opacity', (d) => (d.depth === isLeafDepth && activeLens && isInLens(d, activeLens, shelfSide)) ? 0.85 : 1 - d.depth * 0.06)
      .attr('rx', 2).style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#333').attr('stroke-width', 1);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          const sc = getSkuCount(d);
          const metricStr = formatMetricLabel(d.value ?? 0, metric, d.depth === isLeafDepth, sc, aspMode, d.data.totalRevenue ?? 0, d.data.weightedRrpSum ?? 0);
          setTooltip({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8, label: d.data.name, value: metricStr + (sc > 1 ? ` (${sc} SKUs)` : ''), depth: depthLabels[d.depth] ?? '' });
        }
      })
      .on('mousemove', function (event) { const rect = wrapperRef.current?.getBoundingClientRect(); if (rect) setTooltip((prev) => prev ? { ...prev, x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8 } : null); })
      .on('mouseleave', function (_event, d) {
        const o = (d.depth === isLeafDepth && activeLens && isInLens(d, activeLens, shelfSide)) ? 0.85 : 1 - d.depth * 0.06;
        d3.select(this).attr('fill-opacity', o).attr('stroke', 'none'); setTooltip(null);
      });

    const labelGroups = g.selectAll<SVGGElement, RNode>('g.icicle-label-g')
      .data(nodes.filter((d) => (d.x1 - d.x0) > 13)).join('g').attr('class', 'icicle-label-g')
      .attr('transform', (d) => `translate(${d.y0 + 4},${d.x0 + 2})`);

    labelGroups.each(function (d) {
      const group = d3.select(this);
      const cellW = d.y1 - d.y0 - 8, cellH = d.x1 - d.x0 - 4;
      if (cellW < 10 || cellH < 10) return;
      const fontSize = d.depth <= 2 ? 9 : 8;
      const charW = fontSize * 0.55, lineH = fontSize + 2;
      const maxCharsPerLine = Math.max(2, Math.floor(cellW / charW));

      const words = d.data.name.split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (t.length <= maxCharsPerLine) { cur = t; } else { if (cur) lines.push(cur); cur = w.length > maxCharsPerLine ? w.slice(0, maxCharsPerLine - 1) + '…' : w; } }
      if (cur) lines.push(cur);

      const sc = getSkuCount(d);
      const metricText = formatMetricLabel(d.value ?? 0, metric, d.depth === isLeafDepth, sc, aspMode, d.data.totalRevenue ?? 0, d.data.weightedRrpSum ?? 0);
      const fits = (lines.length + 1) * lineH <= cellH;
      const maxLines = Math.max(1, Math.floor((cellH - lineH) / lineH));
      const vis = fits ? lines : lines.slice(0, maxLines);
      if (!fits && vis.length > 0) vis[vis.length - 1] = vis[vis.length - 1].slice(0, Math.max(1, vis[vis.length - 1].length - 1)) + '…';
      const isDark = d.depth <= 2;

      vis.forEach((line, i) => {
        group.append('text').attr('x', 0).attr('y', i * lineH + lineH * 0.75)
          .attr('font-size', `${fontSize}px`).attr('font-weight', d.depth === 1 ? '700' : '600')
          .attr('fill', isDark ? '#fff' : '#333').text(line);
      });
      const metricY = vis.length * lineH + lineH * 0.75;
      if (metricY + 2 < cellH) {
        group.append('text').attr('x', 0).attr('y', metricY)
          .attr('font-size', `${Math.max(7, fontSize - 1)}px`).attr('font-weight', '400')
          .attr('fill', isDark ? 'rgba(255,255,255,0.8)' : '#555')
          .text(metricText.length > maxCharsPerLine ? metricText.slice(0, maxCharsPerLine - 1) + '…' : metricText);
      }
    });
  }, [data, dims, metric, wrapperRef, activeLens, shelfSide, aspMode, colWeights, maxDepth, depthLabels]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Scatter plot ----------

const SCATTER_CAT_COLORS = [
  '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c62828', '#00838f',
  '#5d4037', '#455a64', '#e91e63', '#00bcd4', '#8bc34a', '#ff9800',
];

interface ScatterPoint {
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  rrp: number;
  margin: number;
  productId: string;
}

interface ScatterProps {
  plans: RangePlan[];
  catalogue: Product[];
  shelfSide: string;
}

function ScatterPlot({ plans, catalogue, shelfSide }: ScatterProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const points = useMemo(() => {
    const seen = new Set<string>();
    const pts: ScatterPoint[] = [];
    for (const plan of plans) {
      const shelf = resolveShelf(plan, shelfSide);
      if (!shelf) continue;
      for (const item of shelf.items) {
        const prod = getProductForItem(item, catalogue);
        if (!prod || seen.has(prod.id)) continue;
        seen.add(prod.id);
        const rrp = prod.rrp ?? 0;
        const margin = prod.operatingMarginGbp ?? 0;
        if (rrp <= 0 && margin === 0) continue;
        pts.push({ sku: prod.sku, name: prod.name, category: prod.category || 'Uncategorised', subCategory: prod.subCategory || '', rrp, margin, productId: prod.id });
      }
    }
    return pts;
  }, [plans, catalogue, shelfSide]);

  const categories = useMemo(() => {
    const cats = new Map<string, Set<string>>();
    for (const p of points) {
      if (!cats.has(p.category)) cats.set(p.category, new Set());
      if (p.subCategory) cats.get(p.category)!.add(p.subCategory);
    }
    return cats;
  }, [points]);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (const [cat, subs] of categories) {
      const base = SCATTER_CAT_COLORS[idx % SCATTER_CAT_COLORS.length];
      map.set(cat, base);
      const subArr = Array.from(subs);
      subArr.forEach((sub, si) => {
        const lightness = 0.15 + (si / Math.max(1, subArr.length)) * 0.35;
        map.set(`${cat}::${sub}`, d3.interpolateLab(base, '#fff')(lightness));
      });
      idx++;
    }
    return map;
  }, [categories]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const { width, height } = dims;
    const margin = { top: 56, right: 24, bottom: 40, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    if (innerW < 20 || innerH < 20 || points.length === 0) return;

    const xExtent = d3.extent(points, (p) => p.margin) as [number, number];
    const yExtent = d3.extent(points, (p) => p.rrp) as [number, number];
    const xPad = (xExtent[1] - xExtent[0]) * 0.08 || 1;
    const yPad = (yExtent[1] - yExtent[0]) * 0.08 || 1;

    const xScale = d3.scaleLinear().domain([xExtent[0] - xPad, xExtent[1] + xPad]).range([0, innerW]);
    const yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([innerH, 0]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(Math.floor(innerW / 80)).tickFormat((d) => `£${d3.format(',.0f')(d as number)}`);
    const yAxis = d3.axisLeft(yScale).ticks(Math.floor(innerH / 40)).tickFormat((d) => `£${d3.format(',.2f')(d as number)}`);

    g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
      .selectAll('text').attr('font-size', '8px');
    g.append('g').call(yAxis)
      .selectAll('text').attr('font-size', '8px');

    // Axis labels
    g.append('text').attr('x', innerW / 2).attr('y', innerH + 32).attr('text-anchor', 'middle')
      .attr('font-size', '9px').attr('fill', '#666').text('Operating Margin (£)');
    g.append('text').attr('x', -innerH / 2).attr('y', -44).attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)').attr('font-size', '9px').attr('fill', '#666').text('RRP (£)');

    // Grid lines
    g.append('g').attr('class', 'grid-x').attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(Math.floor(innerW / 80)).tickSize(-innerH).tickFormat(() => ''))
      .selectAll('line').attr('stroke', '#eee');
    g.append('g').attr('class', 'grid-y')
      .call(d3.axisLeft(yScale).ticks(Math.floor(innerH / 40)).tickSize(-innerW).tickFormat(() => ''))
      .selectAll('line').attr('stroke', '#eee');
    g.selectAll('.grid-x .domain, .grid-y .domain').remove();

    // Points
    g.selectAll('circle').data(points).join('circle')
      .attr('cx', (d) => xScale(d.margin))
      .attr('cy', (d) => yScale(d.rrp))
      .attr('r', 5)
      .attr('fill', (d) => {
        const key = d.subCategory ? `${d.category}::${d.subCategory}` : d.category;
        return colorMap.get(key) ?? colorMap.get(d.category) ?? '#999';
      })
      .attr('fill-opacity', 0.75)
      .attr('stroke', (d) => colorMap.get(d.category) ?? '#999')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('r', 7).attr('fill-opacity', 1).attr('stroke-width', 2);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltip({
            x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8,
            label: `${d.sku} — ${d.name}`,
            value: `RRP: £${d.rrp.toFixed(2)} | OM: £${d.margin.toLocaleString()}`,
            depth: d.subCategory ? `${d.category} / ${d.subCategory}` : d.category,
          });
        }
      })
      .on('mousemove', function (event) {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) setTooltip((prev) => prev ? { ...prev, x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8 } : null);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('r', 5).attr('fill-opacity', 0.75).attr('stroke-width', 1);
        setTooltip(null);
      });

    // Legend
    const legendG = svg.append('g').attr('transform', `translate(${margin.left + innerW + 4},${margin.top})`);
    let ly = 0;
    for (const [cat] of categories) {
      const color = colorMap.get(cat) ?? '#999';
      legendG.append('circle').attr('cx', 6).attr('cy', ly + 5).attr('r', 4).attr('fill', color);
      legendG.append('text').attr('x', 14).attr('y', ly + 8).attr('font-size', '8px').attr('fill', '#555').text(cat);
      ly += 14;
    }
  }, [points, dims, wrapperRef, colorMap, categories]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}
