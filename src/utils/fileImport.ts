import * as XLSX from 'xlsx';
import type { Product, ColumnMapping } from '../types';
import { DEFAULT_COLUMN_MAPPING } from '../types';

export function parseSpreadsheet(
  data: ArrayBuffer,
  mapping: ColumnMapping = DEFAULT_COLUMN_MAPPING
): { products: Product[]; headers: string[] } {
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (json.length === 0) {
    return { products: [], headers: [] };
  }

  const headers = Object.keys(json[0]);

  const numOrUndef = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  };

  const products: Product[] = json.map((row, index) => {
    const sourceRaw = row[mapping.source];
    const source: 'live' | 'dev' = sourceRaw && String(sourceRaw).toLowerCase().startsWith('dev') ? 'dev' : 'live';
    return {
      id: `product-${index}-${String(row[mapping.sku] ?? index)}`,
      sku: String(row[mapping.sku] ?? ''),
      name: String(row[mapping.name] ?? ''),
      category: String(row[mapping.category] ?? ''),
      subCategory: String(row[mapping.subCategory] ?? ''),
      productFamily: String(row[mapping.productFamily] ?? ''),
      volume: Number(row[mapping.volume]) || 0,
      forecastVolume: numOrUndef(row[mapping.forecastVolume]),
      rrp: Number(row[mapping.rrp]) || 0,
      usRrp: numOrUndef(row[mapping.usRrp]),
      euRrp: numOrUndef(row[mapping.euRrp]),
      ausRrp: numOrUndef(row[mapping.ausRrp]),
      revenue: Number(row[mapping.revenue]) || 0,
      forecastRevenue: numOrUndef(row[mapping.forecastRevenue]),
      imageUrl: row[mapping.imageUrl] ? String(row[mapping.imageUrl]) : undefined,
      source,
    };
  });

  return { products, headers };
}

export function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
