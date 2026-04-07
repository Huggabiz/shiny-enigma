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

export function SankeyFlow({
  currentShelf,
  futureShelf,
  links,
  catalogue,
  railWidth,
  onRemoveLink,
}: SankeyFlowProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // For each current item, compute how much volume is unallocated
  const lossFlows = useMemo(() => {
    return currentShelf.items.map((item) => {
      const product = catalogue.find((p) => p.id === item.productId);
      const volume = product?.volume || 0;
      const outgoing = links.filter((l) => l.sourceItemId === item.id);
      const totalPercent = outgoing.reduce((sum, l) => sum + (l.percent ?? 100), 0);
      const lostPercent = Math.max(0, 100 - totalPercent);
      const lostVolume = Math.round(volume * lostPercent / 100);
      return { item, volume, lostPercent, lostVolume, hasLinks: outgoing.length > 0 };
    }).filter((f) => f.lostVolume > 0);
  }, [currentShelf.items, links, catalogue]);

  const hasContent = links.length > 0 || lossFlows.length > 0;

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

    // Create a gradient definition for loss flows
    const defs = svg.append('defs');
    const lossGradient = defs.append('linearGradient')
      .attr('id', 'loss-gradient')
      .attr('x1', '0').attr('y1', '0')
      .attr('x2', '0').attr('y2', '1');
    lossGradient.append('stop').attr('offset', '0%').attr('stop-color', '#F44336').attr('stop-opacity', 0.5);
    lossGradient.append('stop').attr('offset', '100%').attr('stop-color', '#F44336').attr('stop-opacity', 0.05);

    // Scale line widths
    const allVolumes = [
      ...links.map((l) => l.volume),
      ...lossFlows.map((f) => f.lostVolume),
    ];
    const maxVolume = Math.max(...allVolumes, 1);
    const minWidth = 2;
    const maxWidth = 20;

    // Draw transfer links
    links.forEach((link) => {
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
      const targetIndex = futureShelf.items.findIndex((i) => i.id === link.targetItemId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const sourceX = currentLayout.offsetLeft + sourceIndex * currentLayout.slotWidth + currentLayout.cardWidth / 2;
      const targetX = futureLayout.offsetLeft + targetIndex * futureLayout.slotWidth + futureLayout.cardWidth / 2;
      const strokeWidth = minWidth + ((link.volume / maxVolume) * (maxWidth - minWidth));

      const color = link.type === 'growth' ? '#4CAF50' : link.type === 'loss' ? '#F44336' : '#2196F3';

      const path = d3.path();
      path.moveTo(sourceX, 0);
      path.bezierCurveTo(sourceX, FLOW_HEIGHT * 0.4, targetX, FLOW_HEIGHT * 0.6, targetX, FLOW_HEIGHT);

      svg.append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', 0.45)
        .attr('stroke-linecap', 'round')
        .style('cursor', 'pointer')
        .on('mouseenter', function () { d3.select(this).attr('stroke-opacity', 0.75); })
        .on('mouseleave', function () { d3.select(this).attr('stroke-opacity', 0.45); })
        .on('click', () => { onRemoveLink?.(link.sourceItemId, link.targetItemId); });

      // Percent + volume label
      const midX = (sourceX + targetX) / 2;
      const pct = link.percent ?? 100;
      svg.append('text')
        .attr('x', midX)
        .attr('y', FLOW_HEIGHT / 2 - strokeWidth / 2 - 3)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#888')
        .text(`${pct}% (${link.volume.toLocaleString()})`);
    });

    // Draw loss flows — red with gradient fade
    lossFlows.forEach((flow) => {
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === flow.item.id);
      if (sourceIndex === -1) return;

      const sourceX = currentLayout.offsetLeft + sourceIndex * currentLayout.slotWidth + currentLayout.cardWidth / 2;
      const strokeWidth = minWidth + ((flow.lostVolume / maxVolume) * (maxWidth - minWidth));

      const path = d3.path();
      path.moveTo(sourceX, 0);
      path.bezierCurveTo(sourceX, FLOW_HEIGHT * 0.3, sourceX, FLOW_HEIGHT * 0.6, sourceX, FLOW_HEIGHT);

      svg.append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', 'url(#loss-gradient)')
        .attr('stroke-width', strokeWidth)
        .attr('stroke-linecap', 'round');

      // Lost volume label
      svg.append('text')
        .attr('x', sourceX)
        .attr('y', FLOW_HEIGHT - 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#e53935')
        .attr('font-weight', '600')
        .text(`-${flow.lostVolume.toLocaleString()}`);
    });
  }, [currentShelf, futureShelf, links, catalogue, onRemoveLink, lossFlows, hasContent, railWidth, currentLayout, futureLayout]);

  if (!hasContent) {
    return (
      <div className="sankey-empty">
        <span>Use Link Mode or Auto-Link to connect products between shelves.</span>
      </div>
    );
  }

  return (
    <div className="sankey-container">
      <svg ref={svgRef} className="sankey-svg" />
    </div>
  );
}
