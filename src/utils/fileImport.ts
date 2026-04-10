import * as XLSX from 'xlsx';
import type { Product, ColumnMapping, SapCollection } from '../types';
import { DEFAULT_COLUMN_MAPPING } from '../types';

function normaliseSapCollection(raw: unknown): SapCollection | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'core') return 'Core';
  if (v === 'duo') return 'Duo';
  return undefined;
}

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
    // Text fields from spreadsheets often come with leading / trailing
    // whitespace or stray newlines, which otherwise end up as
    // "duplicate" entries in the catalogue category / sub-category
    // dropdowns because Set treats "Foo" and "Foo " as distinct.
    const str = (v: unknown): string => String(v ?? '').trim();
    return {
      id: `product-${index}-${String(row[mapping.sku] ?? index)}`,
      sku: str(row[mapping.sku]),
      name: str(row[mapping.name]),
      category: str(row[mapping.category]),
      subCategory: str(row[mapping.subCategory]),
      productFamily: str(row[mapping.productFamily]),
      sapCollection: normaliseSapCollection(row[mapping.sapCollection]),
      volume: Number(row[mapping.volume]) || 0,
      forecastVolume: numOrUndef(row[mapping.forecastVolume]),
      rrp: Number(row[mapping.rrp]) || 0,
      usRrp: numOrUndef(row[mapping.usRrp]),
      euRrp: numOrUndef(row[mapping.euRrp]),
      ausRrp: numOrUndef(row[mapping.ausRrp]),
      revenue: Number(row[mapping.revenue]) || 0,
      forecastRevenue: numOrUndef(row[mapping.forecastRevenue]),
      imageUrl: row[mapping.imageUrl] ? String(row[mapping.imageUrl]).trim() : undefined,
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
