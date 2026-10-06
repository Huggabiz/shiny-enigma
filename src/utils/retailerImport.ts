// SKU Reach import — parses the customer-sales spreadsheet into the
// compact RetailerSales structure. Deliberately independent of the
// catalogue import: this data lives in its own slot on the project and
// nothing outside the SKU Reach sheet reads it.
//
// Expected headers (matched loosely, so the PowerBI-style names like
// "Product_NS[Product Code]" or "[Qty__Closed_Periods_]" all work):
//   - product code
//   - customer name
//   - qty (closed periods)         — presence signal: qty > 0 = stocked
//   - gross sales (closed periods) — customer ranking only

import * as XLSX from 'xlsx';
import type { RetailerSales } from '../types';

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findHeader(headers: string[], want: (n: string) => boolean): string | null {
  for (const h of headers) {
    if (want(norm(h))) return h;
  }
  return null;
}

export function parseRetailerSales(buffer: ArrayBuffer, fileName?: string): { data: RetailerSales; skipped: number } {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (rows.length === 0) throw new Error('No data rows found in the first sheet.');

  const headers = Object.keys(rows[0]);
  const codeH = findHeader(headers, (n) => n.includes('product code'))
    ?? findHeader(headers, (n) => n.includes('product') && n.includes('code'));
  const custH = findHeader(headers, (n) => n.includes('customer name'))
    ?? findHeader(headers, (n) => n.includes('customer'));
  const qtyH = findHeader(headers, (n) => n.includes('qty') && n.includes('closed'))
    ?? findHeader(headers, (n) => n.includes('qty') && !n.includes('previous'));
  const grossH = findHeader(headers, (n) => n.includes('gross sales') && n.includes('closed'))
    ?? findHeader(headers, (n) => n.includes('gross') && !n.includes('ly'));
  if (!codeH || !custH || !qtyH) {
    throw new Error(
      'Could not find the required columns. Need: Product Code, Customer Name, and a Qty (closed periods) column.\n' +
      `Found headers: ${headers.slice(0, 12).join(', ')}${headers.length > 12 ? ', …' : ''}`);
  }

  // Aggregate: per customer totals, and per (customer, sku) qty.
  const custTotals = new Map<string, { gross: number; qty: number }>();
  const pairQty = new Map<string, number>();
  let skipped = 0;
  for (const row of rows) {
    const sku = String(row[codeH] ?? '').trim().toUpperCase();
    const cust = String(row[custH] ?? '').trim();
    const qty = Number(row[qtyH]) || 0;
    const gross = grossH ? Number(row[grossH]) || 0 : 0;
    if (!sku || !cust) { skipped++; continue; }
    const ct = custTotals.get(cust) ?? { gross: 0, qty: 0 };
    ct.gross += gross; ct.qty += qty; custTotals.set(cust, ct);
    if (qty > 0) {
      const key = `${cust}\u0000${sku}`;
      pairQty.set(key, (pairQty.get(key) ?? 0) + qty);
    }
  }

  const customers = Array.from(custTotals.entries())
    .map(([name, t]) => ({ name, gross: t.gross, qty: t.qty }))
    .sort((a, b) => b.gross - a.gross);
  const custIdx = new Map(customers.map((c, i) => [c.name, i]));

  const bySku: Record<string, [number, number][]> = {};
  for (const [key, qty] of pairQty) {
    const sep = key.indexOf('\u0000');
    const cust = key.slice(0, sep);
    const sku = key.slice(sep + 1);
    (bySku[sku] ??= []).push([custIdx.get(cust)!, qty]);
  }

  return {
    data: { importedAt: new Date().toISOString(), fileName, customers, bySku },
    skipped,
  };
}
