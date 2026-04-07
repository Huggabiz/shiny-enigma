import { useEffect, useRef, useMemo } from 'react';
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
  onRemoveLink?: (sourceId: string, targetId: string) => void;
}

const FLOW_HEIGHT = 120;

interface FlowSpec {
  link: SankeyLink;
  sourceIndex: number;
  targetIndex: number;
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
  onRemoveLink,
}: SankeyFlowProps) {
  const svgRef = useRef<SVGSVGElement>(null);

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
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
      const targetIndex = futureShelf.items.findIndex((i) => i.id === link.targetItemId);
      if (sourceIndex === -1 || targetIndex === -1) continue;
      allFlows.push({
        link,
        sourceIndex,
        targetIndex,
        strokeWidth: calcWidth(link.volume),
        color: link.type === 'growth' ? '#4CAF50' : link.type === 'loss' ? '#F44336' : '#2196F3',
        isLoss: false,
        volume: link.volume,
      });
    }

    // Loss flows (virtual — targetIndex = -1)
    for (const [itemId, lostVolume] of lossMap) {
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === itemId);
      if (sourceIndex === -1) continue;
      allFlows.push({
        link: { sourceItemId: itemId, targetItemId: '__loss__', percent: 0, volume: lostVolume, type: 'loss' },
        sourceIndex,
        targetIndex: -1,
        strokeWidth: calcWidth(lostVolume),
        color: '#F44336',
        isLoss: true,
        volume: lostVolume,
      });
    }

    return { flows: allFlows, hasContent: allFlows.length > 0 };
  }, [currentShelf.items, futureShelf.items, links, catalogue]);

  const currentLayout = useMemo(
    () => computeShelfLayout(currentShelf.items.length, railWidth),
    [currentShelf.items.length, railWidth]
  );
  const futureLayout = useMemo(
    () => computeShelfLayout(futureShelf.items.length, railWidth),
    [futureShelf.items.length, railWidth]
  );

  useEffect(() => {
    if (!svgRef.current || !railWidth) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!hasContent) return;

    svg.attr('width', railWidth).attr('height', FLOW_HEIGHT);

    // Gradient for loss flows
    const defs = svg.append('defs');
    const lossGrad = defs.append('linearGradient')
      .attr('id', 'loss-gradient').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    lossGrad.append('stop').attr('offset', '0%').attr('stop-color', '#F44336').attr('stop-opacity', 0.5);
    lossGrad.append('stop').attr('offset', '100%').attr('stop-color', '#F44336').attr('stop-opacity', 0.05);

    // ---- Compute stacking offsets ----
    // Group flows by source index, then compute each flow's horizontal offset at the source
    const bySource = new Map<number, FlowSpec[]>();
    for (const f of flows) {
      const arr = bySource.get(f.sourceIndex) || [];
      arr.push(f);
      bySource.set(f.sourceIndex, arr);
    }

    // Group flows by target index (excluding loss flows)
    const byTarget = new Map<number, FlowSpec[]>();
    for (const f of flows) {
      if (f.isLoss) continue;
      const arr = byTarget.get(f.targetIndex) || [];
      arr.push(f);
      byTarget.set(f.targetIndex, arr);
    }

    // For each group, sort by target position (for source groups) or source position (for target groups)
    // so flows don't cross unnecessarily
    for (const [, arr] of bySource) {
      arr.sort((a, b) => {
        if (a.isLoss && !b.isLoss) return 1; // loss goes last (rightmost)
        if (!a.isLoss && b.isLoss) return -1;
        return a.targetIndex - b.targetIndex;
      });
    }
    for (const [, arr] of byTarget) {
      arr.sort((a, b) => a.sourceIndex - b.sourceIndex);
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
    for (const flow of flows) {
      const sx = sourceOffsets.get(flow) || 0;

      if (flow.isLoss) {
        // Loss flow — straight down with gradient fade
        const path = d3.path();
        path.moveTo(sx, 0);
        path.bezierCurveTo(sx, FLOW_HEIGHT * 0.3, sx, FLOW_HEIGHT * 0.6, sx, FLOW_HEIGHT);

        svg.append('path')
          .attr('d', path.toString())
          .attr('fill', 'none')
          .attr('stroke', 'url(#loss-gradient)')
          .attr('stroke-width', flow.strokeWidth)
          .attr('stroke-linecap', 'round');

        svg.append('text')
          .attr('x', sx)
          .attr('y', FLOW_HEIGHT - 14)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#e53935')
          .attr('font-weight', '600')
          .text(`-${flow.volume.toLocaleString()}`);
      } else {
        const tx = targetOffsets.get(flow) || 0;

        const path = d3.path();
        path.moveTo(sx, 0);
        path.bezierCurveTo(sx, FLOW_HEIGHT * 0.4, tx, FLOW_HEIGHT * 0.6, tx, FLOW_HEIGHT);

        svg.append('path')
          .attr('d', path.toString())
          .attr('fill', 'none')
          .attr('stroke', flow.color)
          .attr('stroke-width', flow.strokeWidth)
          .attr('stroke-opacity', 0.45)
          .attr('stroke-linecap', 'round')
          .style('cursor', 'pointer')
          .on('mouseenter', function () { d3.select(this).attr('stroke-opacity', 0.75); })
          .on('mouseleave', function () { d3.select(this).attr('stroke-opacity', 0.45); })
          .on('click', () => { onRemoveLink?.(flow.link.sourceItemId, flow.link.targetItemId); });

        // Label at midpoint
        const midX = (sx + tx) / 2;
        const pct = flow.link.percent ?? 100;
        svg.append('text')
          .attr('x', midX)
          .attr('y', FLOW_HEIGHT / 2 - flow.strokeWidth / 2 - 3)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', '#888')
          .text(`${pct}% (${flow.volume.toLocaleString()})`);
      }
    }
  }, [flows, hasContent, railWidth, currentLayout, futureLayout, onRemoveLink]);

  if (!hasContent) {
    return (
      <div className="sankey-empty">
        <span>Connect products between shelves using Link Mode.</span>
      </div>
    );
  }

  return (
    <div className="sankey-container">
      <svg ref={svgRef} className="sankey-svg" />
    </div>
  );
}
