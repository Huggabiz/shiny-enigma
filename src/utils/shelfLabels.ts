// Shared matrix-label derivation used by the Shelf (transform view)
// and the MultiplanView so both render the same "matrix title format"
// bands above the horizontal card rail.
//
// The Y label backgrounds are intentionally tan while X is blue to
// match the existing Shelf CSS rules (.shelf-derived-label.x-label /
// .y-label). MultiplanView reuses those same classes.

import type { Shelf } from '../types';

export interface DerivedLabel {
  text: string;
  /** Index of the first card the label spans, in the visible-items list. */
  startPosition: number;
  /** Index of the last card the label spans, inclusive. */
  endPosition: number;
  color: string;
  level: 'x' | 'y';
}

/** Build X and Y matrix labels from a shelf, restricted to items
 * currently visible in the rail (variant filter applied upstream).
 * Each returned label has start/end positions in the visible list,
 * ready for `left = offsetLeft + start * slotWidth` positioning. */
export function deriveLabelsFromMatrix(
  shelf: Shelf,
  visibleItemIds: string[],
): { xLabels: DerivedLabel[]; yLabels: DerivedLabel[] } {
  const layout = shelf.matrixLayout;
  if (!layout || layout.assignments.length === 0) return { xLabels: [], yLabels: [] };

  const xLabels: DerivedLabel[] = [];
  const yLabels: DerivedLabel[] = [];

  const posMap = new Map(visibleItemIds.map((id, idx) => [id, idx]));
  const visibleAssignments = layout.assignments.filter((a) => posMap.has(a.itemId));

  for (let col = 0; col < layout.xLabels.length; col++) {
    const positions = visibleAssignments
      .filter((a) => a.col === col)
      .map((a) => posMap.get(a.itemId))
      .filter((p): p is number => p !== undefined);
    if (positions.length === 0) continue;
    xLabels.push({
      text: layout.xLabels[col],
      startPosition: Math.min(...positions),
      endPosition: Math.max(...positions),
      color: '#dce6f0',
      level: 'x',
    });
  }

  // Skip y-labels entirely when the matrix only has a single row —
  // a "Subset 1" bar under every card adds no information. 2+ rows
  // means the labels differentiate zones, so we render them.
  if (layout.yLabels.length >= 2) {
    for (let col = 0; col < layout.xLabels.length; col++) {
      for (let row = 0; row < layout.yLabels.length; row++) {
        const positions = visibleAssignments
          .filter((a) => a.col === col && a.row === row)
          .map((a) => posMap.get(a.itemId))
          .filter((p): p is number => p !== undefined);
        if (positions.length === 0) continue;
        yLabels.push({
          text: layout.yLabels[row],
          startPosition: Math.min(...positions),
          endPosition: Math.max(...positions),
          color: '#f0e6d6',
          level: 'y',
        });
      }
    }
  }

  return { xLabels, yLabels };
}

/** Pack derived labels into non-overlapping rows so two sibling
 * labels that share a horizontal span end up on separate rows. */
export function packLabelsIntoRows(labels: DerivedLabel[]): DerivedLabel[][] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.startPosition - b.startPosition);
  const rows: DerivedLabel[][] = [];
  for (const label of sorted) {
    let placed = false;
    for (const row of rows) {
      const overlaps = row.some(
        (existing) =>
          label.startPosition <= existing.endPosition &&
          label.endPosition >= existing.startPosition,
      );
      if (!overlaps) {
        row.push(label);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([label]);
  }
  return rows;
}
