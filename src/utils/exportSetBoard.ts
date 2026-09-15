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
  wb.created = new Date();
  const ws = wb.addWorksheet((board.name || 'Set Board').slice(0, 31), {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 15 },
  });
  // Groups collapse from a header ABOVE the detail rows, not a total
  // below them.
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  // Palette — mirrors the app: dark ink, blue sets, orange bundles.
  const INK = 'FF1A1A2E';
  const SLATE = 'FF455A64';
  const SET_BLUE = 'FF1976D2';
  const BUNDLE_ORANGE = 'FFF57C00';
  const BAND = 'FFF5F7FA';
  const HAIRLINE = 'FFE8E8E8';
  const GBP = '£#,##0.00';

  // Column plan: A is a slim indent gutter so nested content reads as
  // indented; the data lives in B–I.
  ws.columns = [
    { key: 'gutter', width: 2.2 },
    { key: 'set', width: 32 },
    { key: 'kind', width: 9.5 },
    { key: 'img', width: 8.5 },
    { key: 'sku', width: 13 },
    { key: 'product', width: 46 },
    { key: 'qty', width: 6.5 },
    { key: 'rrp', width: 11 },
    { key: 'line', width: 12 },
  ];

  const groups = groupSetBoardByCell(board);
  const boardQty = board.items.reduce((s, it) => s + it.components.reduce((q, c) => q + c.quantity, 0), 0);
  const boardRrp = board.items.reduce((s, it) => s + it.components.reduce((q, c) => {
    const p = catalogue.find((x) => x.id === c.productId);
    return q + (p?.rrp ?? 0) * c.quantity;
  }, 0), 0);

  // ---- Title block ----
  const titleRow = ws.addRow([]);
  titleRow.height = 26;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 9);
  const titleCell = titleRow.getCell(1);
  titleCell.value = board.name || 'Set Board';
  titleCell.font = { bold: true, size: 16, color: { argb: INK } };
  titleCell.alignment = { vertical: 'middle' };

  const subRow = ws.addRow([]);
  subRow.height = 14;
  ws.mergeCells(subRow.number, 1, subRow.number, 9);
  const subCell = subRow.getCell(1);
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  subCell.value = `Set & Bundle board · exported ${dateStr} · ${board.items.length} set${board.items.length !== 1 ? 's' : ''} · ${boardQty} item${boardQty !== 1 ? 's' : ''} · total RRP £${boardRrp.toFixed(2)}`;
  subCell.font = { size: 9, color: { argb: 'FF888888' } };

  // Accent rule under the title block.
  const ruleRow = ws.addRow([]);
  ruleRow.height = 4;
  ws.mergeCells(ruleRow.number, 1, ruleRow.number, 9);
  ruleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  ws.addRow([]).height = 6;

  // ---- Column headers ----
  const HEADERS = ['', 'Set / Bundle', 'Kind', 'Image', 'SKU', 'Product', 'Qty', 'Unit RRP', 'Line RRP'];
  const headRow = ws.addRow(HEADERS);
  headRow.height = 18;
  headRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > 9) return;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE } };
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: colNumber >= 7 ? 'right' : 'left' };
  });
  headRow.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.views = [{ state: 'frozen', ySplit: headRow.number, showGridLines: false }];

  // ---- Images (each distinct URL fetched once) ----
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

  // ---- Body: cell band → set band → product rows, with Excel row
  // grouping so sections and sets collapse from their headers ----
  for (const gr of groups) {
    ws.addRow([]).height = 6;
    const cellRow = ws.addRow([]);
    cellRow.height = 19;
    ws.mergeCells(cellRow.number, 1, cellRow.number, 9);
    const cc = cellRow.getCell(1);
    cc.value = gr.label;
    cc.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cc.alignment = { vertical: 'middle', indent: 1 };

    for (const it of gr.items) {
      const totalQty = it.components.reduce((s, c) => s + c.quantity, 0);
      const totalRrp = it.components.reduce((s, c) => {
        const p = catalogue.find((x) => x.id === c.productId);
        return s + (p?.rrp ?? 0) * c.quantity;
      }, 0);
      const kindColor = it.kind === 'set' ? SET_BLUE : BUNDLE_ORANGE;

      const setRow = ws.addRow({ set: it.name, kind: it.kind === 'set' ? 'SET' : 'BUNDLE', qty: totalQty, line: totalRrp });
      setRow.height = 17;
      setRow.outlineLevel = 1;
      setRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > 9) return;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
        cell.border = { bottom: { style: 'thin', color: { argb: HAIRLINE } } };
      });
      setRow.getCell('set').font = { bold: true, size: 10.5, color: { argb: INK } };
      setRow.getCell('set').alignment = { vertical: 'middle' };
      const kindCell = setRow.getCell('kind');
      kindCell.font = { bold: true, size: 7.5, color: { argb: 'FFFFFFFF' } };
      kindCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kindColor } };
      kindCell.alignment = { vertical: 'middle', horizontal: 'center' };
      setRow.getCell('qty').font = { bold: true, size: 10, color: { argb: INK } };
      setRow.getCell('qty').alignment = { vertical: 'middle', horizontal: 'center' };
      setRow.getCell('line').font = { bold: true, size: 10, color: { argb: INK } };
      setRow.getCell('line').numFmt = GBP;
      setRow.getCell('line').alignment = { vertical: 'middle', horizontal: 'right' };

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
          // Un-embeddable image: keep the URL so nothing is lost.
          img: p.imageUrl && !hasImage ? p.imageUrl : '',
        });
        r.outlineLevel = 2;
        r.height = hasImage ? 40 : 16;
        r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber > 9) return;
          cell.border = { bottom: { style: 'hair', color: { argb: HAIRLINE } } };
          cell.alignment = { ...cell.alignment, vertical: 'middle' };
        });
        r.getCell('sku').font = { name: 'Consolas', size: 8.5, color: { argb: 'FF777777' } };
        r.getCell('product').font = { size: 10, color: { argb: 'FF333333' } };
        r.getCell('img').font = { size: 8, color: { argb: 'FF999999' } };
        const qtyCell = r.getCell('qty');
        qtyCell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (c.quantity > 1) qtyCell.font = { bold: true, size: 10, color: { argb: SET_BLUE } };
        r.getCell('rrp').numFmt = GBP;
        r.getCell('rrp').font = { size: 10, color: { argb: 'FF555555' } };
        r.getCell('line').numFmt = GBP;
        r.getCell('line').font = { size: 10, color: { argb: 'FF333333' } };
        if (hasImage) {
          ws.addImage(imageIds.get(p.imageUrl!)!, {
            tl: { col: 3.08, row: r.number - 1 + 0.05 },
            ext: { width: 48, height: 48 },
            editAs: 'oneCell',
          });
        }
      }
      if (it.components.length === 0) {
        const empty = ws.addRow({ product: 'No products yet' });
        empty.outlineLevel = 2;
        empty.getCell('product').font = { italic: true, size: 9, color: { argb: 'FFAAAAAA' } };
      }
    }
  }

  // ---- Board total ----
  ws.addRow([]).height = 6;
  const totalRow = ws.addRow({ set: 'Board total', qty: boardQty, line: boardRrp });
  totalRow.height = 18;
  totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > 9) return;
    cell.border = { top: { style: 'double', color: { argb: INK } } };
  });
  totalRow.getCell('set').font = { bold: true, size: 11, color: { argb: INK } };
  totalRow.getCell('qty').font = { bold: true, size: 10.5, color: { argb: INK } };
  totalRow.getCell('qty').alignment = { horizontal: 'center' };
  totalRow.getCell('line').font = { bold: true, size: 11, color: { argb: INK } };
  totalRow.getCell('line').numFmt = GBP;
  totalRow.getCell('line').alignment = { horizontal: 'right' };

  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${board.name || 'set-board'}.xlsx`,
  );
}
