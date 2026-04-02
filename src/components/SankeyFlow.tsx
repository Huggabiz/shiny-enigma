import { useEffect, useRef } from 'react';
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

const CARD_WIDTH = 110; // matches card width + gap
const FLOW_HEIGHT = 120;

export function SankeyFlow({
  currentShelf,
  futureShelf,
  links,
  catalogue,
  onRemoveLink,
}: SankeyFlowProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (links.length === 0) {
      return;
    }

    // Calculate max volume for scaling line widths
    const maxVolume = Math.max(...links.map((l) => l.volume), 1);
    const minWidth = 2;
    const maxWidth = 20;

    const width = Math.max(
      currentShelf.items.length * CARD_WIDTH,
      futureShelf.items.length * CARD_WIDTH,
      400
    );

    svg.attr('width', width).attr('height', FLOW_HEIGHT);

    // Draw each link as a curved path
    links.forEach((link) => {
      const sourceIndex = currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
      const targetIndex = futureShelf.items.findIndex((i) => i.id === link.targetItemId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const sourceX = sourceIndex * CARD_WIDTH + CARD_WIDTH / 2;
      const targetX = targetIndex * CARD_WIDTH + CARD_WIDTH / 2;
      const strokeWidth =
        minWidth + ((link.volume / maxVolume) * (maxWidth - minWidth));

      const color =
        link.type === 'growth'
          ? '#4CAF50'
          : link.type === 'loss'
          ? '#F44336'
          : '#2196F3';

      // Curved path
      const path = d3.path();
      path.moveTo(sourceX, 0);
      path.bezierCurveTo(
        sourceX,
        FLOW_HEIGHT * 0.4,
        targetX,
        FLOW_HEIGHT * 0.6,
        targetX,
        FLOW_HEIGHT
      );

      // Main flow
      svg
        .append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-opacity', 0.5)
        .attr('stroke-linecap', 'round')
        .style('cursor', 'pointer')
        .on('mouseenter', function () {
          d3.select(this).attr('stroke-opacity', 0.8);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('stroke-opacity', 0.5);
        })
        .on('click', () => {
          onRemoveLink?.(link.sourceItemId, link.targetItemId);
        });

      // Growth sliver (green widening)
      if (link.type === 'growth') {
        const sliverPath = d3.path();
        sliverPath.moveTo(targetX - strokeWidth / 2 - 3, FLOW_HEIGHT);
        sliverPath.lineTo(targetX - strokeWidth / 2, FLOW_HEIGHT * 0.7);
        sliverPath.lineTo(targetX - strokeWidth / 2, FLOW_HEIGHT);
        sliverPath.closePath();
        svg
          .append('path')
          .attr('d', sliverPath.toString())
          .attr('fill', '#4CAF50')
          .attr('opacity', 0.4);
      }

      // Loss indicator (red dead end)
      if (link.type === 'loss') {
        svg
          .append('circle')
          .attr('cx', targetX)
          .attr('cy', FLOW_HEIGHT - 5)
          .attr('r', 6)
          .attr('fill', '#F44336')
          .attr('opacity', 0.6);
        svg
          .append('text')
          .attr('x', targetX)
          .attr('y', FLOW_HEIGHT - 2)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#fff')
          .text('×');
      }

      // Volume label on the flow
      const midX = (sourceX + targetX) / 2;
      const midY = FLOW_HEIGHT / 2;

      const sourceProduct = currentShelf.items[sourceIndex];
      const product = catalogue.find((p) => p.id === sourceProduct?.productId);

      svg
        .append('text')
        .attr('x', midX)
        .attr('y', midY)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#666')
        .attr('dy', -strokeWidth / 2 - 2)
        .text(`${link.volume.toLocaleString()} ${product ? `(${product.sku})` : ''}`);
    });
  }, [currentShelf, futureShelf, links, catalogue, onRemoveLink]);

  if (links.length === 0) {
    return (
      <div className="sankey-empty">
        <span>Enable Link Mode to connect products between shelves</span>
      </div>
    );
  }

  return (
    <div className="sankey-container">
      <svg ref={svgRef} className="sankey-svg" />
    </div>
  );
}
