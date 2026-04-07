import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import type { Shelf, SankeyLink, Product } from '../types';
import './SankeyFlow.css';

interface SankeyFlowProps {
  currentShelf: Shelf;
  futureShelf: Shelf;
  links: SankeyLink[];
  catalogue: Product[];
  onRemoveLink?: (sourceId: string, targetId: string) => void;
}

const CARD_WIDTH = 100;
const CARD_GAP = 10;
const CARD_SLOT_WIDTH = CARD_WIDTH + CARD_GAP;
const FLOW_HEIGHT = 120;
const DEAD_END_Y = FLOW_HEIGHT - 10;

export function SankeyFlow({
  currentShelf,
  futureShelf,
  links,
  catalogue,
  onRemoveLink,
}: SankeyFlowProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Find unlinked current shelf items
  const unlinkedItems = useMemo(() => {
    const linkedSourceIds = new Set(links.map(l => l.sourceItemId));
    return currentShelf.items.filter(item => !linkedSourceIds.has(item.id));
  }, [currentShelf.items, links]);

  const hasContent = links.length > 0 || unlinkedItems.length > 0;

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!hasContent) return;

    // Match the shelf centering logic exactly
    const containerWidth = containerRef.current.offsetWidth;
    const currentContentWidth = currentShelf.items.length * CARD_SLOT_WIDTH;
    const futureContentWidth = futureShelf.items.length * CARD_SLOT_WIDTH;

    // Shelves use justify-content: center with gap:10 — the rail padding is 8px each side
    // The centering offset matches what CSS flexbox does
    const railPadding = 8;
    const availableWidth = containerWidth - railPadding * 2;
    const currentOffset = railPadding + Math.max(0, (availableWidth - currentContentWidth) / 2);
    const futureOffset = railPadding + Math.max(0, (availableWidth - futureContentWidth) / 2);

    // SVG fills the container width — no scrollbar
    svg.attr('width', containerWidth).attr('height', FLOW_HEIGHT);

    // Scale line widths
    const allVolumes = [
      ...links.map(l => l.volume),
      ...unlinkedItems.map(item => {
        const product = catalogue.find(p => p.id === item.productId);
        return product?.volume || 0;
      }),
    ];
    const maxVolume = Math.max(...allVolumes, 1);
    const minWidth = 2;
    const maxWidth = 20;

    // Draw explicit links
    links.forEach((link) => {
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
      const targetIndex = futureShelf.items.findIndex((i) => i.id === link.targetItemId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      // Center of each card slot
      const sourceX = currentOffset + sourceIndex * CARD_SLOT_WIDTH + CARD_WIDTH / 2;
      const targetX = futureOffset + targetIndex * CARD_SLOT_WIDTH + CARD_WIDTH / 2;
      const strokeWidth = minWidth + ((link.volume / maxVolume) * (maxWidth - minWidth));

      const color =
        link.type === 'growth'
          ? '#4CAF50'
          : link.type === 'loss'
          ? '#F44336'
          : '#2196F3';

      const path = d3.path();
      path.moveTo(sourceX, 0);
      path.bezierCurveTo(sourceX, FLOW_HEIGHT * 0.4, targetX, FLOW_HEIGHT * 0.6, targetX, FLOW_HEIGHT);

      svg
        .append('path')
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

      // Volume label
      const midX = (sourceX + targetX) / 2;
      svg
        .append('text')
        .attr('x', midX)
        .attr('y', FLOW_HEIGHT / 2 - strokeWidth / 2 - 3)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#888')
        .text(link.volume.toLocaleString());
    });

    // Draw unlinked items as red dead-end flows
    unlinkedItems.forEach((item) => {
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === item.id);
      if (sourceIndex === -1) return;

      const product = catalogue.find(p => p.id === item.productId);
      const volume = product?.volume || 0;
      if (volume === 0) return;

      const sourceX = currentOffset + sourceIndex * CARD_SLOT_WIDTH + CARD_WIDTH / 2;
      const strokeWidth = minWidth + ((volume / maxVolume) * (maxWidth - minWidth));

      const path = d3.path();
      path.moveTo(sourceX, 0);
      path.bezierCurveTo(
        sourceX, FLOW_HEIGHT * 0.3,
        sourceX, FLOW_HEIGHT * 0.5,
        sourceX, DEAD_END_Y
      );

      svg
        .append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', '#F44336')
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-linecap', 'round');

      // Dead end X mark
      const xSize = 5;
      svg.append('line')
        .attr('x1', sourceX - xSize).attr('y1', DEAD_END_Y - xSize)
        .attr('x2', sourceX + xSize).attr('y2', DEAD_END_Y + xSize)
        .attr('stroke', '#F44336').attr('stroke-width', 2).attr('stroke-opacity', 0.7);
      svg.append('line')
        .attr('x1', sourceX + xSize).attr('y1', DEAD_END_Y - xSize)
        .attr('x2', sourceX - xSize).attr('y2', DEAD_END_Y + xSize)
        .attr('stroke', '#F44336').attr('stroke-width', 2).attr('stroke-opacity', 0.7);

      // Lost volume label
      svg
        .append('text')
        .attr('x', sourceX)
        .attr('y', DEAD_END_Y - strokeWidth / 2 - 6)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#e53935')
        .attr('font-weight', '600')
        .text(`-${volume.toLocaleString()}`);
    });
  }, [currentShelf, futureShelf, links, catalogue, onRemoveLink, unlinkedItems, hasContent]);

  // Re-render on container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      // Force re-render by triggering the main effect
      if (svgRef.current) {
        svgRef.current.dispatchEvent(new Event('resize'));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (!hasContent) {
    return (
      <div className="sankey-empty">
        <span>Enable Link Mode to connect products between shelves. Unlinked products will show lost volume.</span>
      </div>
    );
  }

  return (
    <div className="sankey-container" ref={containerRef}>
      <svg ref={svgRef} className="sankey-svg" />
    </div>
  );
}
