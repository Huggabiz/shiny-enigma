// Set board list export — nested cell → set/bundle → component rows,
// written with exceljs (not SheetJS) because it can embed the product
// images into the sheet. Images are fetched at export time; any that
// fail (offline, CORS) fall back to showing the URL text instead.

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Product, SetBoard, SetBoardItem } from '../types';

export interface SetBoardCellGroup {
  row: number;
  col: number;
  label: string;
  items: SetBoardItem[];
}

/** Nested view of a board: one group per occupied matrix cell, in
 * row-major order. The label follows the "only name the axis that
 * varies" rule: both axes multi → "X · Y"; single row → just the
 * column label; single column → just the row label. */
export function groupSetBoardByCell(board: SetBoard): SetBoardCellGroup[] {
  const layout = board.matrixLayout;
  if (!layout || layout.xLabels.length === 0 || layout.yLabels.length === 0) {
    return board.items.length ? [{ row: 0, col: 0, label: 'All', items: board.items }] : [];
  }
  const multiX = layout.xLabels.length > 1;
  const multiY = layout.yLabels.length > 1;
  const cellLabel = (row: number, col: number) => {
    const x = layout.xLabels[col] ?? '';
    const y = layout.yLabels[row] ?? '';
    if (multiX && multiY) return `${x} · ${y}`;
    if (multiX) return x;
    if (multiY) return y;
    return x || y || 'All';
  };
  const groups: SetBoardCellGroup[] = [];
  for (let row = 0; row < layout.yLabels.length; row++) {
    for (let col = 0; col < layout.xLabels.length; col++) {
      const ids = layout.assignments.filter((a) => a.row === row && a.col === col).map((a) => a.itemId);
      const items = ids
        .map((id) => board.items.find((i) => i.id === id))
        .filter((i): i is SetBoardItem => !!i);
      if (items.length) groups.push({ row, col, label: cellLabel(row, col), items });
    }
  }
  // Items missing an assignment should never be silently dropped.
  const assigned = new Set(layout.assignments.map((a) => a.itemId));
  const orphans = board.items.filter((i) => !assigned.has(i.id));
  if (orphans.length) groups.push({ row: -1, col: -1, label: 'Unplaced', items: orphans });
  return groups;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImage(url: string): Promise<{ base64: string; extension: 'png' | 'jpeg' | 'gif' } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const ct = res.headers.get('content-type') ?? '';
    const extension: 'png' | 'jpeg' | 'gif' =
      ct.includes('png') || /\.png(\?|$)/i.test(url) ? 'png'
        : ct.includes('gif') || /\.gif(\?|$)/i.test(url) ? 'gif'
        : 'jpeg';
    return { base64: arrayBufferToBase64(buffer), extension };
  } catch {
    return null;
  }
}

export async function exportSetBoardToExcel(board: SetBoard, catalogue: Product[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((board.name || 'Set Board').slice(0, 31));
  ws.columns = [
    { header: 'Cell', key: 'cell', width: 26 },
    { header: 'Set / Bundle', key: 'set', width: 28 },
    { header: 'Kind', key: 'kind', width: 9 },
    { header: 'Image', key: 'img', width: 9 },
    { header: 'SKU', key: 'sku', width: 12 },
    { header: 'Product', key: 'product', width: 42 },
    { header: 'Qty', key: 'qty', width: 6 },
    { header: 'Unit RRP', key: 'rrp', width: 11 },
    { header: 'Line RRP', key: 'line', width: 11 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const groups = groupSetBoardByCell(board);

  // Fetch each distinct image once, up front.
  const urls = new Set<string>();
  for (const gr of groups) {
    for (const it of gr.items) {
      for (const c of it.components) {
        const p = catalogue.find((x) => x.id === c.productId);
        if (p?.imageUrl) urls.add(p.imageUrl);
      }
    }
  }
  const imageIds = new Map<string, number>();
  await Promise.all(Array.from(urls).map(async (url) => {
    const img = await fetchImage(url);
    if (img) imageIds.set(url, wb.addImage({ base64: img.base64, extension: img.extension }));
  }));

  for (const gr of groups) {
    const cellRow = ws.addRow({ cell: gr.label });
    cellRow.font = { bold: true, size: 12 };
    cellRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    for (const it of gr.items) {
      const totalQty = it.components.reduce((s, c) => s + c.quantity, 0);
      const totalRrp = it.components.reduce((s, c) => {
        const p = catalogue.find((x) => x.id === c.productId);
        return s + (p?.rrp ?? 0) * c.quantity;
      }, 0);
      const setRow = ws.addRow({
        set: it.name,
        kind: it.kind === 'set' ? 'Set' : 'Bundle',
        qty: totalQty,
        line: totalRrp,
      });
      setRow.font = { bold: true };
      setRow.getCell('line').numFmt = '£#,##0.00';
      for (const c of it.components) {
        const p = catalogue.find((x) => x.id === c.productId);
        if (!p) continue;
        const hasImage = !!p.imageUrl && imageIds.has(p.imageUrl);
        const r = ws.addRow({
          sku: p.sku,
          product: p.name,
          qty: c.quantity,
          rrp: p.rrp || '',
          line: (p.rrp || 0) * c.quantity,
          // Un-embeddable image: leave the URL so nothing is lost.
          img: p.imageUrl && !hasImage ? p.imageUrl : '',
        });
        r.getCell('rrp').numFmt = '£#,##0.00';
        r.getCell('line').numFmt = '£#,##0.00';
        r.alignment = { vertical: 'middle' };
        if (hasImage) {
          r.height = 40; // points ≈ 53px, clears the 48px image
          ws.addImage(imageIds.get(p.imageUrl!)!, {
            tl: { col: 3.08, row: r.number - 1 + 0.05 },
            ext: { width: 48, height: 48 },
            editAs: 'oneCell',
          });
        }
      }
    }
    ws.addRow({});
  }

  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${board.name || 'set-board'}.xlsx`,
  );
}
