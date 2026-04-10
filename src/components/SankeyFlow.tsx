import { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import type { Shelf, SankeyLink, Product } from '../types';
import { computeShelfLayout } from '../utils/layout';
import './SankeyFlow.css';

interface SankeyFlowProps {
  currentShelf: Shelf;
  futureShelf: Shelf;
  links: SankeyLink[];
  catalogue: Product[];
  railWidth: number;
  variantCurrentIds?: Set<string> | null;
  variantFutureIds?: Set<string> | null;
  showGhosted?: boolean;
  discontinuedItems?: import('../types').ShelfItem[];
  showDiscontinued?: boolean;
  onClickFlow?: (sourceItemId: string) => void;
}

const FLOW_HEIGHT_FALLBACK = 84;

interface FlowSpec {
  link: SankeyLink;
  sourceItemId: string;
  targetItemId: string;
  strokeWidth: number;
  color: string;
  isLoss: boolean;
  volume: number;
}

export function SankeyFlow({
  currentShelf,
  futureShelf,
  links,
  catalogue,
  railWidth,
  variantCurrentIds,
  variantFutureIds,
  showGhosted: showGhostedProp,
  discontinuedItems,
  showDiscontinued,
  onClickFlow,
}: SankeyFlowProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [flowHeight, setFlowHeight] = useState(FLOW_HEIGHT_FALLBACK);

  // Measure the container's height so the d3 paths stretch to fill the gap
  // between the current and future shelves (which varies with the canvas).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      if (h > 0) setFlowHeight(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Use the shelf's railWidth directly — the SVG is positioned to match
  const effectiveWidth = railWidth;

  // Build all flow specs including loss flows
  const { flows, hasContent } = useMemo(() => {
    const allFlows: FlowSpec[] = [];

    // Get all volumes for scaling
    const allVolumes: number[] = [];
    links.forEach((l) => allVolumes.push(l.volume));

    // Compute loss per source
    const lossMap = new Map<string, number>();
    for (const item of currentShelf.items) {
      const product = catalogue.find((p) => p.id === item.productId);
      const volume = product?.volume || 0;
      const outgoing = links.filter((l) => l.sourceItemId === item.id);
      const totalPercent = outgoing.reduce((sum, l) => sum + (l.percent ?? 100), 0);
      const lostVolume = Math.round(volume * Math.max(0, 100 - totalPercent) / 100);
      if (lostVolume > 0) {
        lossMap.set(item.id, lostVolume);
        allVolumes.push(lostVolume);
      }
    }

    const maxVolume = Math.max(...allVolumes, 1);
    const minW = 2;
    const maxW = 20;
    const calcWidth = (vol: number) => minW + ((vol / maxVolume) * (maxW - minW));

    // Transfer links
    for (const link of links) {
      if (!currentShelf.items.some((i) => i.id === link.sourceItemId)) continue;
      if (!futureShelf.items.some((i) => i.id === link.targetItemId)) continue;
      allFlows.push({
        link,
        sourceItemId: link.sourceItemId,
        targetItemId: link.targetItemId,
        strokeWidth: calcWidth(link.volume),
        color: link.type === 'growth' ? '#4CAF50' : link.type === 'loss' ? '#F44336' : '#2196F3',
        isLoss: false,
        volume: link.volume,
      });
    }

    // Loss flows
    for (const [itemId, lostVolume] of lossMap) {
      allFlows.push({
        link: { sourceItemId: itemId, targetItemId: '__loss__', percent: 0, volume: lostVolume, type: 'loss' },
        sourceItemId: itemId,
        targetItemId: '__loss__',
        strokeWidth: calcWidth(lostVolume),
        color: '#F44336',
        isLoss: true,
        volume: lostVolume,
      });
    }

    return { flows: allFlows, hasContent: allFlows.length > 0 };
  }, [currentShelf.items, futureShelf.items, links, catalogue]);

  // Compute visible items (matching Shelf's filter logic)
  const visibleCurrentItems = useMemo(() =>
    currentShelf.items.filter((i) => {
      if (!variantCurrentIds) return true;
      return variantCurrentIds.has(i.id) || showGhostedProp;
    }),
    [currentShelf.items, variantCurrentIds, showGhostedProp]
  );
  const visibleFutureItems = useMemo(() =>
    futureShelf.items.filter((i) => {
      if (!variantFutureIds) return true;
      return variantFutureIds.has(i.id) || showGhostedProp;
    }),
    [futureShelf.items, variantFutureIds, showGhostedProp]
  );

  // Layout based on visible regular items only (matching Shelf's explicit positioning)
  const currentLayout = useMemo(
    () => computeShelfLayout(visibleCurrentItems.length, effectiveWidth),
    [visibleCurrentItems.length, effectiveWidth]
  );
  // Include discontinued items in future layout to match shelf card sizing
  const futureDiscCount = (showDiscontinued && discontinuedItems?.length) || 0;
  const futureTotalCount = visibleFutureItems.length + (futureDiscCount > 0 ? futureDiscCount + 1 : 0);
  const futureLayout = useMemo(
    () => computeShelfLayout(futureTotalCount, effectiveWidth),
    [futureTotalCount, effectiveWidth]
  );

  useEffect(() => {
    if (!svgRef.current || !effectiveWidth) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!hasContent) return;

    svg.attr('width', effectiveWidth).attr('height', flowHeight);

    // Gradient for loss flows
    const defs = svg.append('defs');
    const lossGrad = defs.append('linearGradient')
      .attr('id', 'loss-gradient').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    lossGrad.append('stop').attr('offset', '0%').attr('stop-color', '#F44336').attr('stop-opacity', 0.5);
    lossGrad.append('stop').attr('offset', '100%').attr('stop-color', '#F44336').attr('stop-opacity', 0.05);

    // ---- Compute stacking offsets using VISIBLE item indices ----
    // Map item IDs to visible indices
    const visCurrentIdx = new Map(visibleCurrentItems.map((item, idx) => [item.id, idx]));
    const visFutureIdx = new Map(visibleFutureItems.map((item, idx) => [item.id, idx]));

    // Filter flows to only those with visible source/target
    const visibleFlows = flows.filter((f) => {
      if (!visCurrentIdx.has(f.sourceItemId)) return false;
      if (!f.isLoss && !visFutureIdx.has(f.targetItemId)) return false;
      return true;
    });

    // Group by source
    const bySource = new Map<number, FlowSpec[]>();
    for (const f of visibleFlows) {
      const idx = visCurrentIdx.get(f.sourceItemId)!;
      const arr = bySource.get(idx) || [];
      arr.push(f);
      bySource.set(idx, arr);
    }

    // Group by target (excluding loss)
    const byTarget = new Map<number, FlowSpec[]>();
    for (const f of visibleFlows) {
      if (f.isLoss) continue;
      const idx = visFutureIdx.get(f.targetItemId)!;
      const arr = byTarget.get(idx) || [];
      arr.push(f);
      byTarget.set(idx, arr);
    }

    // Sort to minimize crossing
    for (const [, arr] of bySource) {
      arr.sort((a, b) => {
        if (a.isLoss && !b.isLoss) return 1;
        if (!a.isLoss && b.isLoss) return -1;
        return (visFutureIdx.get(a.targetItemId) ?? 0) - (visFutureIdx.get(b.targetItemId) ?? 0);
      });
    }
    for (const [, arr] of byTarget) {
      arr.sort((a, b) => (visCurrentIdx.get(a.sourceItemId) ?? 0) - (visCurrentIdx.get(b.sourceItemId) ?? 0));
    }

    // Compute x offset for each flow at source and target
    const sourceOffsets = new Map<FlowSpec, number>();
    const targetOffsets = new Map<FlowSpec, number>();

    for (const [sourceIdx, arr] of bySource) {
      const totalWidth = arr.reduce((sum, f) => sum + f.strokeWidth, 0);
      const cardCenterX = currentLayout.offsetLeft + sourceIdx * currentLayout.slotWidth + currentLayout.cardWidth / 2;
      let x = cardCenterX - totalWidth / 2;
      for (const f of arr) {
        sourceOffsets.set(f, x + f.strokeWidth / 2);
        x += f.strokeWidth;
      }
    }

    for (const [targetIdx, arr] of byTarget) {
      const totalWidth = arr.reduce((sum, f) => sum + f.strokeWidth, 0);
      const cardCenterX = futureLayout.offsetLeft + targetIdx * futureLayout.slotWidth + futureLayout.cardWidth / 2;
      let x = cardCenterX - totalWidth / 2;
      for (const f of arr) {
        targetOffsets.set(f, x + f.strokeWidth / 2);
        x += f.strokeWidth;
      }
    }

    // ---- Draw flows ----
    for (const flow of visibleFlows) {
      const sx = sourceOffsets.get(flow) || 0;

      if (flow.isLoss) {
        // Find discontinued card position if showing
        const discIdx = showDiscontinued && discontinuedItems
          ? discontinuedItems.findIndex((i) => i.id === flow.sourceItemId)
          : -1;

        if (discIdx >= 0) {
          // Draw red curve to the discontinued ghost card in future shelf
          // Position: after regular items + separator gap + disc item index
          const regularEndX = futureLayout.offsetLeft + visibleFutureItems.length * futureLayout.slotWidth;
          const separatorWidth = 20; // separator div + gaps
          const tx = regularEndX + separatorWidth + discIdx * futureLayout.slotWidth + futureLayout.cardWidth / 2;

          const path = d3.path();
          path.moveTo(sx, 0);
          path.bezierCurveTo(sx, flowHeight * 0.4, tx, flowHeight * 0.6, tx, flowHeight);

          svg.append('path')
            .attr('d', path.toString())
            .attr('fill', 'none')
            .attr('stroke', '#F44336')
            .attr('stroke-width', flow.strokeWidth)
            .attr('stroke-opacity', 0.35)
            .attr('stroke-linecap', 'round')
            .style('cursor', 'pointer')
            .on('click', () => { onClickFlow?.(flow.sourceItemId); });

          const midX = (sx + tx) / 2;
          svg.append('text')
            .attr('x', midX)
            .attr('y', flowHeight / 2 - flow.strokeWidth / 2 - 3)
            .attr('text-anchor', 'middle')
            .attr('font-size', '8px')
            .attr('fill', '#e53935')
            .attr('font-weight', '600')
            .text(`-${flow.volume.toLocaleString()}`);
        } else {
          // No discontinued card — fade out vertically
          const path = d3.path();
          path.moveTo(sx, 0);
          path.bezierCurveTo(sx, flowHeight * 0.3, sx, flowHeight * 0.6, sx, flowHeight);

          svg.append('path')
            .attr('d', path.toString())
            .attr('fill', 'none')
            .attr('stroke', 'url(#loss-gradient)')
            .attr('stroke-width', flow.strokeWidth)
            .attr('stroke-linecap', 'round');

          svg.append('text')
            .attr('x', sx)
            .attr('y', flow.strokeWidth / 2 + 12)
            .attr('text-anchor', 'middle')
            .attr('font-size', '8px')
            .attr('fill', '#e53935')
            .attr('font-weight', '600')
            .text(`-${flow.volume.toLocaleString()}`);
        }
      } else {
        const tx = targetOffsets.get(flow) || 0;

        // Dim flows for variant-excluded items
        const isExcluded = variantCurrentIds
          ? !variantCurrentIds.has(flow.sourceItemId)
          : false;
        const baseOpacity = isExcluded ? 0.1 : 0.45;
        const hoverOpacity = isExcluded ? 0.15 : 0.75;

        const path = d3.path();
        path.moveTo(sx, 0);
        path.bezierCurveTo(sx, flowHeight * 0.4, tx, flowHeight * 0.6, tx, flowHeight);

        svg.append('path')
          .attr('d', path.toString())
          .attr('fill', 'none')
          .attr('stroke', flow.color)
          .attr('stroke-width', flow.strokeWidth)
          .attr('stroke-opacity', baseOpacity)
          .attr('stroke-linecap', 'round')
          .style('cursor', 'pointer')
          .on('mouseenter', function () { d3.select(this).attr('stroke-opacity', hoverOpacity); })
          .on('mouseleave', function () { d3.select(this).attr('stroke-opacity', baseOpacity); })
          .on('click', () => { onClickFlow?.(flow.link.sourceItemId); });

        // Label at midpoint — initial position, may be nudged by the
        // collision-avoidance pass below.
        const midX = (sx + tx) / 2;
        const idealY = flowHeight / 2 - flow.strokeWidth / 2 - 3;
        const pct = flow.link.percent ?? 100;
        svg.append('text')
          .attr('class', 'flow-label')
          .attr('x', midX)
          .attr('y', idealY)
          .attr('data-ideal-x', midX)
          .attr('data-ideal-y', idealY)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', '#888')
          .text(`${pct}% (${flow.volume.toLocaleString()})`);
      }
    }

    // ── Label collision avoidance ──
    // Push overlapping labels apart on the Y axis so each one finds a
    // readable spot. Draws thin leader lines back to the ideal midpoint
    // when a label has been displaced far from its original position.
    const labelNodes = svg.selectAll<SVGTextElement, unknown>('text.flow-label').nodes();
    if (labelNodes.length > 1) {
      interface LabelBox { node: SVGTextElement; x: number; y: number; w: number; h: number; idealY: number; }
      const boxes: LabelBox[] = labelNodes.map((node) => {
        const bbox = node.getBBox();
        const y = parseFloat(node.getAttribute('y') || '0');
        const idealY = parseFloat(node.getAttribute('data-ideal-y') || String(y));
        return {
          node,
          x: bbox.x,
          y,
          w: bbox.width,
          h: bbox.height,
          idealY,
        };
      });

      const pad = 2;
      const minY = 6;
      const maxY = flowHeight - 4;

      for (let iter = 0; iter < 40; iter++) {
        let moved = false;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            // Horizontal overlap check
            const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            if (hOverlap <= pad) continue;
            // Vertical overlap check (y is baseline, so the box top is y - h)
            const aTop = a.y - a.h;
            const bTop = b.y - b.h;
            const vOverlap = Math.min(a.y, b.y) - Math.max(aTop, bTop);
            if (vOverlap <= pad) continue;
            const push = (vOverlap + pad) / 2;
            // Move the higher one further up, the lower one further down
            if (a.y < b.y) {
              a.y = Math.max(minY, a.y - push);
              b.y = Math.min(maxY, b.y + push);
            } else {
              a.y = Math.min(maxY, a.y + push);
              b.y = Math.max(minY, b.y - push);
            }
            moved = true;
          }
        }
        if (!moved) break;
      }

      // Write displaced positions back to the DOM and draw leader lines
      // for labels that have moved far from their ideal spot.
      for (const box of boxes) {
        box.node.setAttribute('y', String(box.y));
        if (Math.abs(box.y - box.idealY) > 6) {
          const cx = box.x + box.w / 2;
          svg.insert('line', 'text.flow-label')
            .attr('x1', cx)
            .attr('y1', box.idealY)
            .attr('x2', cx)
            .attr('y2', box.y - box.h + 1)
            .attr('stroke', '#bbb')
            .attr('stroke-width', 0.6)
            .attr('stroke-opacity', 0.5);
        }
      }
    }
  }, [flows, hasContent, effectiveWidth, flowHeight, currentLayout, futureLayout, onClickFlow, visibleCurrentItems, visibleFutureItems, showDiscontinued, discontinuedItems, variantCurrentIds]);

  if (!hasContent) {
    return (
      <div ref={containerRef} className="sankey-container sankey-empty-container">
        <div className="sankey-empty">
          <span>Connect products between shelves using Link Mode.</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="sankey-container" style={{ width: railWidth }}>
      <svg ref={svgRef} className="sankey-svg" />
    </div>
  );
}
