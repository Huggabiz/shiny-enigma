import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useProjectStore } from '../store/useProjectStore';
import type { Lens, MatrixCellAssignment, Product, RangePlan, Shelf, ShelfItem } from '../types';
import './AnalyseView.css';

type Metric = 'rrp' | 'revenue';
type AspMode = 'standard' | 'weighted';
type SheetId = 'sunburst' | 'icicle';

const SHEETS: { id: SheetId; label: string }[] = [
  { id: 'sunburst', label: 'Sunburst' },
  { id: 'icicle', label: 'Icicle' },
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

function buildHierarchyData(
  plans: RangePlan[],
  catalogue: Product[],
  metric: Metric,
  shelfSide: string,
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
      const val = metric === 'rrp' ? (prod.rrp ?? 0) : (prod.revenue ?? 0);
      if (val <= 0) continue;

      if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
      const planMap = categoryMap.get(cat)!;
      if (!planMap.has(plan.name)) planMap.set(plan.name, new Map());
      const segMap = planMap.get(plan.name)!;
      if (!segMap.has(segment)) segMap.set(segment, []);
      segMap.get(segment)!.push({
        name: prod.name,
        sku: prod.sku,
        value: val,
        productId: prod.id,
        revenue: prod.revenue ?? 0,
      });
    }
  }

  const children: HierNode[] = [];
  for (const [cat, planMap] of categoryMap) {
    const planChildren: HierNode[] = [];
    let catSkuCount = 0;
    let catRevenue = 0;
    let catWeighted = 0;
    for (const [planName, segMap] of planMap) {
      const segChildren: HierNode[] = [];
      let planSkuCount = 0;
      let planRevenue = 0;
      let planWeighted = 0;
      for (const [seg, skus] of segMap) {
        const segRevenue = skus.reduce((s, x) => s + x.revenue, 0);
        const segWeighted = skus.reduce((s, x) => s + (x.value * x.revenue), 0);
        const skuNodes: HierNode[] = skus.map((s) => ({
          name: `${s.sku} — ${s.name}`,
          value: s.value,
          productId: s.productId,
          skuCount: 1,
          totalRevenue: s.revenue,
          weightedRrpSum: s.value * s.revenue,
        }));
        segChildren.push({ name: seg, children: skuNodes, skuCount: skus.length, totalRevenue: segRevenue, weightedRrpSum: segWeighted });
        planSkuCount += skus.length;
        planRevenue += segRevenue;
        planWeighted += segWeighted;
      }
      planChildren.push({ name: planName, children: segChildren, skuCount: planSkuCount, totalRevenue: planRevenue, weightedRrpSum: planWeighted });
      catSkuCount += planSkuCount;
      catRevenue += planRevenue;
      catWeighted += planWeighted;
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

const DEPTH_LABELS = ['', 'Category', 'Range Plan', 'Segment', 'SKU'];

function formatValue(v: number, metric: Metric): string {
  if (metric === 'rrp') return `£${v.toFixed(2)}`;
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `£${(v / 1_000).toFixed(0)}K`;
  return `£${v.toFixed(0)}`;
}

function formatMetricLabel(
  value: number, metric: Metric, depth: number,
  skuCount: number, aspMode: AspMode, totalRevenue: number, weightedRrpSum: number,
): string {
  if (metric === 'revenue') {
    return formatValue(value, 'revenue');
  }
  if (depth === 4) return `£${value.toFixed(2)}`;
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
}

export function AnalyseView() {
  const {
    project,
    clearAnalyseEntries,
  } = useProjectStore();

  const [metric, setMetric] = useState<Metric>('revenue');
  const [shelfSide, setShelfSide] = useState('current');
  const [activeSheet, setActiveSheet] = useState<SheetId>('sunburst');
  const [aspMode, setAspMode] = useState<AspMode>('standard');

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

  if (!project) return null;

  const chartProps: ChartProps = {
    plans: selectedPlans,
    catalogue: project.catalogue,
    metric,
    shelfSide,
    activeLens,
    aspMode,
  };

  return (
    <div className="analyse-view">
      <div className="analyse-toolbar">
        <h2 className="analyse-title">Analyse</h2>
        <div className="analyse-metric-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={shelfSide === 'current'}
            className={shelfSide === 'current' ? 'active' : ''}
            onClick={() => setShelfSide('current')}
          >
            Current
          </button>
          <button
            role="tab"
            aria-selected={shelfSide === 'future'}
            className={shelfSide === 'future' ? 'active' : ''}
            onClick={() => setShelfSide('future')}
          >
            Future
          </button>
        </div>
        <div className="analyse-metric-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={metric === 'revenue'}
            className={metric === 'revenue' ? 'active' : ''}
            onClick={() => setMetric('revenue')}
          >
            Revenue
          </button>
          <button
            role="tab"
            aria-selected={metric === 'rrp'}
            className={metric === 'rrp' ? 'active' : ''}
            onClick={() => setMetric('rrp')}
          >
            RRP
          </button>
        </div>
        {metric === 'rrp' && (
          <div className="analyse-metric-toggle" role="tablist">
            <button
              role="tab"
              aria-selected={aspMode === 'standard'}
              className={aspMode === 'standard' ? 'active' : ''}
              onClick={() => setAspMode('standard')}
            >
              ASP
            </button>
            <button
              role="tab"
              aria-selected={aspMode === 'weighted'}
              className={aspMode === 'weighted' ? 'active' : ''}
              onClick={() => setAspMode('weighted')}
            >
              Weighted ASP
            </button>
          </div>
        )}
        <div className="analyse-toolbar-actions">
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
            <button
              className="analyse-clear"
              onClick={() => {
                if (confirm('Clear all selected plans from analyse view?')) clearAnalyseEntries();
              }}
            >
              Clear
            </button>
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
                <h3>Category Breakdown</h3>
                <p>
                  {selectedPlans.map((p) => p.name).join(', ')} — by {metric === 'revenue' ? 'Historic Revenue' : 'RRP'}
                </p>
              </div>
              {activeSheet === 'sunburst' ? (
                <Sunburst {...chartProps} />
              ) : (
                <Icicle {...chartProps} />
              )}
            </div>
          </div>
          <div className="analyse-sheet-tabs">
            {SHEETS.map((s) => (
              <button
                key={s.id}
                className={`analyse-sheet-tab ${activeSheet === s.id ? 'active' : ''}`}
                onClick={() => setActiveSheet(s.id)}
              >
                {s.label}
              </button>
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

function Sunburst({ plans, catalogue, metric, shelfSide }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide), [plans, catalogue, metric, shelfSide]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dims;
    const radius = Math.min(width, height) / 2 * 0.82;

    const root = d3
      .hierarchy<HierNode>(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    if (!root.children || root.children.length === 0) return;

    const partition = d3.partition<HierNode>().size([2 * Math.PI, radius]);
    const partitioned = partition(root) as d3.HierarchyRectangularNode<HierNode>;

    const arc = d3
      .arc<d3.HierarchyRectangularNode<HierNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle(0.002)
      .padRadius(radius / 2)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => d.y1 - 1);

    const g = svg
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    type RNode = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (partitioned.descendants() as RNode[]).filter((d) => d.depth > 0);

    g.selectAll('path')
      .data(nodes)
      .join('path')
      .attr('d', arc as any)
      .attr('fill', (d) => getCategoryColor(d, partitioned))
      .attr('fill-opacity', (d) => 1 - d.depth * 0.08)
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill-opacity', 1);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltip({
            x: event.clientX - rect.left + 12,
            y: event.clientY - rect.top - 8,
            label: d.data.name,
            value: formatValue(d.value ?? 0, metric),
            depth: DEPTH_LABELS[d.depth] ?? '',
          });
        }
      })
      .on('mousemove', function (event) {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltip((prev) =>
            prev ? { ...prev, x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8 } : null,
          );
        }
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this).attr('fill-opacity', 1 - d.depth * 0.08);
        setTooltip(null);
      });

    g.selectAll('text.cat-label')
      .data(nodes.filter((d) => d.depth === 1 && (d.x1 - d.x0) > 0.15))
      .join('text')
      .attr('class', 'cat-label')
      .attr('transform', (d) => {
        const angle = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90;
        const r = (d.y0 + d.y1) / 2;
        return `rotate(${angle}) translate(${r},0) rotate(${angle > 90 ? 180 : 0})`;
      })
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .attr('fill', '#fff')
      .text((d) => {
        const maxLen = Math.floor(((d.x1 - d.x0) * (d.y0 + d.y1) / 2) / 6);
        const name = d.data.name;
        return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
      });

    g.selectAll('text.plan-label')
      .data(nodes.filter((d) => d.depth === 2 && (d.x1 - d.x0) > 0.2))
      .join('text')
      .attr('class', 'plan-label')
      .attr('transform', (d) => {
        const angle = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90;
        const r = (d.y0 + d.y1) / 2;
        return `rotate(${angle}) translate(${r},0) rotate(${angle > 90 ? 180 : 0})`;
      })
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('fill', '#fff')
      .text((d) => {
        const maxLen = Math.floor(((d.x1 - d.x0) * (d.y0 + d.y1) / 2) / 5.5);
        const name = d.data.name;
        return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
      });
  }, [data, dims, metric, wrapperRef]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

// ---------- Icicle (horizontal) ----------

// Custom column widths as fractions of total width (depths 1-4).
// Category and Plan are narrow (text wraps), Segment medium, SKU wide.
const ICICLE_COL_WEIGHTS = [0.10, 0.10, 0.16, 0.64];

function getSkuCount(node: d3.HierarchyNode<HierNode>): number {
  if (node.data.skuCount != null) return node.data.skuCount;
  return node.leaves().length;
}

function isInLens(node: d3.HierarchyNode<HierNode>, lens: Lens, stageKey: string): boolean {
  if (!node.data.productId) return false;
  if (lens.builtInKind) return false;
  if (lens.scope === 'per-stage') {
    return lens.stageProductIds?.[stageKey]?.includes(node.data.productId) ?? false;
  }
  return lens.productIds.includes(node.data.productId);
}

function Icicle({ plans, catalogue, metric, shelfSide, activeLens, aspMode }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide), [plans, catalogue, metric, shelfSide]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dims;
    const margin = { top: 56, right: 4, bottom: 4, left: 4 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const root = d3
      .hierarchy<HierNode>(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    if (!root.children || root.children.length === 0) return;

    // Use partition for vertical proportions (x0/x1) then remap horizontal (y0/y1)
    const partition = d3.partition<HierNode>().size([innerH, innerW]).padding(1);
    const partitioned = partition(root);

    // Build cumulative column boundaries from weights
    const colStarts = [0];
    for (let i = 0; i < ICICLE_COL_WEIGHTS.length; i++) {
      colStarts.push(colStarts[i] + ICICLE_COL_WEIGHTS[i] * innerW);
    }

    type RNode = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (partitioned.descendants() as RNode[]).filter((d) => d.depth > 0);

    // Remap y0/y1 to custom column widths (removing root gap)
    for (const n of nodes) {
      const d = n.depth - 1;
      if (d < ICICLE_COL_WEIGHTS.length) {
        n.y0 = colStarts[d];
        n.y1 = colStarts[d + 1];
      }
    }

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    g.selectAll('rect')
      .data(nodes)
      .join('rect')
      .attr('x', (d) => d.y0)
      .attr('y', (d) => d.x0)
      .attr('width', (d) => Math.max(0, d.y1 - d.y0 - 1))
      .attr('height', (d) => Math.max(0, d.x1 - d.x0))
      .attr('fill', (d) => {
        if (d.depth === 4 && activeLens && isInLens(d, activeLens, shelfSide)) {
          return activeLens.color;
        }
        return getCategoryColor(d, partitioned);
      })
      .attr('fill-opacity', (d) => {
        if (d.depth === 4 && activeLens && isInLens(d, activeLens, shelfSide)) return 0.85;
        return 1 - d.depth * 0.06;
      })
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#333').attr('stroke-width', 1);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          const sc = getSkuCount(d);
          const metricStr = formatMetricLabel(
            d.value ?? 0, metric, d.depth, sc, aspMode,
            d.data.totalRevenue ?? 0, d.data.weightedRrpSum ?? 0,
          );
          setTooltip({
            x: event.clientX - rect.left + 12,
            y: event.clientY - rect.top - 8,
            label: d.data.name,
            value: metricStr + (sc > 1 ? ` (${sc} SKUs)` : ''),
            depth: DEPTH_LABELS[d.depth] ?? '',
          });
        }
      })
      .on('mousemove', function (event) {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltip((prev) =>
            prev ? { ...prev, x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 8 } : null,
          );
        }
      })
      .on('mouseleave', function (_event, d) {
        const origOpacity = (d.depth === 4 && activeLens && isInLens(d, activeLens, shelfSide)) ? 0.85 : 1 - d.depth * 0.06;
        d3.select(this).attr('fill-opacity', origOpacity).attr('stroke', 'none');
        setTooltip(null);
      });

    // Text labels with wrapping and metric values
    const labelGroups = g.selectAll<SVGGElement, RNode>('g.icicle-label-g')
      .data(nodes.filter((d) => (d.x1 - d.x0) > 13))
      .join('g')
      .attr('class', 'icicle-label-g')
      .attr('transform', (d) => `translate(${d.y0 + 4},${d.x0 + 2})`);

    labelGroups.each(function (d) {
      const group = d3.select(this);
      const cellW = d.y1 - d.y0 - 8;
      const cellH = d.x1 - d.x0 - 4;
      if (cellW < 10 || cellH < 10) return;

      const fontSize = d.depth <= 2 ? 9 : 8;
      const charW = fontSize * 0.55;
      const lineH = fontSize + 2;
      const maxCharsPerLine = Math.max(2, Math.floor(cellW / charW));

      // Wrap name into lines
      const name = d.data.name;
      const words = name.split(/\s+/);
      const lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        const test = currentLine ? `${currentLine} ${word}` : word;
        if (test.length <= maxCharsPerLine) {
          currentLine = test;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine - 1) + '…' : word;
        }
      }
      if (currentLine) lines.push(currentLine);

      // Metric line
      const sc = getSkuCount(d);
      const metricText = formatMetricLabel(
        d.value ?? 0, metric, d.depth, sc, aspMode,
        d.data.totalRevenue ?? 0, d.data.weightedRrpSum ?? 0,
      );

      const totalLines = lines.length + 1;
      const totalTextH = totalLines * lineH;
      const fits = totalTextH <= cellH;
      const maxLines = Math.max(1, Math.floor((cellH - lineH) / lineH));
      const visibleLines = fits ? lines : lines.slice(0, maxLines);
      if (!fits && visibleLines.length > 0) {
        const last = visibleLines[visibleLines.length - 1];
        visibleLines[visibleLines.length - 1] = last.slice(0, Math.max(1, last.length - 1)) + '…';
      }

      const isLight = d.depth <= 2;

      visibleLines.forEach((line, i) => {
        group.append('text')
          .attr('x', 0)
          .attr('y', i * lineH + lineH * 0.75)
          .attr('font-size', `${fontSize}px`)
          .attr('font-weight', d.depth === 1 ? '700' : '600')
          .attr('fill', isLight ? '#fff' : '#333')
          .text(line);
      });

      // Metric value below the name
      const metricY = visibleLines.length * lineH + lineH * 0.75;
      if (metricY + 2 < cellH) {
        group.append('text')
          .attr('x', 0)
          .attr('y', metricY)
          .attr('font-size', `${Math.max(7, fontSize - 1)}px`)
          .attr('font-weight', '400')
          .attr('fill', isLight ? 'rgba(255,255,255,0.8)' : '#888')
          .text(metricText.length > maxCharsPerLine ? metricText.slice(0, maxCharsPerLine - 1) + '…' : metricText);
      }
    });
  }, [data, dims, metric, wrapperRef, activeLens, shelfSide, aspMode]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}
