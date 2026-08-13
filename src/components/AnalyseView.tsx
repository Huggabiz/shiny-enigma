import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useProjectStore } from '../store/useProjectStore';
import type { Product, RangePlan, ShelfItem } from '../types';
import './AnalyseView.css';

type Metric = 'rrp' | 'revenue';
type SheetId = 'sunburst' | 'icicle';

const SHEETS: { id: SheetId; label: string }[] = [
  { id: 'sunburst', label: 'Sunburst' },
  { id: 'icicle', label: 'Icicle' },
];

interface HierNode {
  name: string;
  value?: number;
  children?: HierNode[];
}

function getProductForItem(item: ShelfItem, catalogue: Product[]): Product | null {
  if (item.isPlaceholder && item.placeholderData) {
    return item.placeholderData as unknown as Product;
  }
  return catalogue.find((p) => p.id === item.productId) ?? null;
}

function getSegmentLabel(shelf: { matrixLayout?: { xLabels: string[]; yLabels: string[] }; items: ShelfItem[] }, item: ShelfItem): string {
  const ml = shelf.matrixLayout;
  if (!ml) return 'Unsegmented';
  const idx = shelf.items.indexOf(item);
  if (idx < 0) return 'Unsegmented';
  const cols = ml.xLabels.length || 1;
  const xi = idx % cols;
  const yi = Math.floor(idx / cols);
  const xLabel = ml.xLabels[xi] ?? '';
  const yLabel = ml.yLabels[yi] ?? '';
  if (xLabel && yLabel) return `${yLabel} / ${xLabel}`;
  return xLabel || yLabel || 'Unsegmented';
}

function buildHierarchyData(
  plans: RangePlan[],
  catalogue: Product[],
  metric: Metric,
  shelfSide: string,
): HierNode {
  const categoryMap = new Map<string, Map<string, Map<string, { name: string; sku: string; value: number }[]>>>();

  for (const plan of plans) {
    let shelf;
    if (shelfSide === 'current') shelf = plan.currentShelf;
    else if (shelfSide === 'future') shelf = plan.futureShelf;
    else {
      const stageId = shelfSide.replace('stage-', '');
      const entry = (plan.intermediateShelves ?? []).find((s) => s.stageId === stageId);
      shelf = entry?.shelf;
    }
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
      segMap.get(segment)!.push({ name: prod.name, sku: prod.sku, value: val });
    }
  }

  const children: HierNode[] = [];
  for (const [cat, planMap] of categoryMap) {
    const planChildren: HierNode[] = [];
    for (const [planName, segMap] of planMap) {
      const segChildren: HierNode[] = [];
      for (const [seg, skus] of segMap) {
        const skuNodes: HierNode[] = skus.map((s) => ({ name: `${s.sku} — ${s.name}`, value: s.value }));
        segChildren.push({ name: seg, children: skuNodes });
      }
      planChildren.push({ name: planName, children: segChildren });
    }
    children.push({ name: cat, children: planChildren });
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

interface ChartProps {
  plans: RangePlan[];
  catalogue: Product[];
  metric: Metric;
  shelfSide: string;
}

export function AnalyseView() {
  const {
    project,
    clearAnalyseEntries,
  } = useProjectStore();

  const [metric, setMetric] = useState<Metric>('revenue');
  const [shelfSide, setShelfSide] = useState('current');
  const [activeSheet, setActiveSheet] = useState<SheetId>('sunburst');

  const analyseView = project?.analyseView ?? { entries: [] };
  const entries = analyseView.entries;

  const selectedPlans = useMemo(() => {
    if (!project) return [];
    return entries
      .map((e) => project.plans.find((p) => p.id === e.planId))
      .filter((p): p is RangePlan => p != null);
  }, [entries, project]);

  if (!project) return null;

  const chartProps: ChartProps = {
    plans: selectedPlans,
    catalogue: project.catalogue,
    metric,
    shelfSide,
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
        <div className="analyse-toolbar-actions">
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

function Icicle({ plans, catalogue, metric, shelfSide }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { wrapperRef, dims, measureRef } = useMeasure();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const data = useMemo(() => buildHierarchyData(plans, catalogue, metric, shelfSide), [plans, catalogue, metric, shelfSide]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dims;
    const margin = { top: 44, right: 4, bottom: 4, left: 4 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const root = d3
      .hierarchy<HierNode>(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    if (!root.children || root.children.length === 0) return;

    const partition = d3.partition<HierNode>().size([innerH, innerW]).padding(1);
    const partitioned = partition(root);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    type RNode = d3.HierarchyRectangularNode<HierNode>;
    const nodes = (partitioned.descendants() as RNode[]).filter((d) => d.depth > 0);

    g.selectAll('rect')
      .data(nodes)
      .join('rect')
      .attr('x', (d) => d.y0)
      .attr('y', (d) => d.x0)
      .attr('width', (d) => Math.max(0, d.y1 - d.y0 - 1))
      .attr('height', (d) => Math.max(0, d.x1 - d.x0))
      .attr('fill', (d) => getCategoryColor(d, partitioned))
      .attr('fill-opacity', (d) => 1 - d.depth * 0.06)
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#333').attr('stroke-width', 1);
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
        d3.select(this).attr('fill-opacity', 1 - d.depth * 0.06).attr('stroke', 'none');
        setTooltip(null);
      });

    // Text labels — only when the rect is big enough
    g.selectAll('text.icicle-label')
      .data(nodes.filter((d) => (d.x1 - d.x0) > 14 && (d.y1 - d.y0) > 30))
      .join('text')
      .attr('class', 'icicle-label')
      .attr('x', (d) => d.y0 + 4)
      .attr('y', (d) => (d.x0 + d.x1) / 2)
      .attr('dy', '0.35em')
      .attr('font-size', (d) => d.depth <= 2 ? '10px' : '9px')
      .attr('font-weight', (d) => d.depth === 1 ? '700' : '600')
      .attr('fill', (d) => d.depth <= 2 ? '#fff' : '#333')
      .text((d) => {
        const maxLen = Math.floor((d.y1 - d.y0 - 8) / 6);
        const name = d.data.name;
        return name.length > maxLen ? name.slice(0, Math.max(1, maxLen - 1)) + '…' : name;
      });
  }, [data, dims, metric, wrapperRef]);

  return (
    <div ref={measureRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} className="analyse-sunburst" viewBox={`0 0 ${dims.width} ${dims.height}`} preserveAspectRatio="xMidYMid meet" />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}
