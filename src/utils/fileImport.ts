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

  // Collect headers from ALL rows, not just the first — xlsx omits
  // keys for blank cells in a given row, so a column that happens to
  // be empty in row 0 would otherwise be invisible to the mapper.
  const headerSet = new Set<string>();
  for (const row of json) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);

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

    // Per-warehouse volume breakdown. When at least one warehouse
    // column is present, the total `volume` is the sum of the
    // populated warehouse values. When no warehouse columns are
    // present the legacy single "Volume" column drives the total
    // and warehouseVolumes is left undefined.
    const whUk = numOrUndef(row[mapping.volumeUk]);
    const whEu = numOrUndef(row[mapping.volumeEu]);
    const whAus = numOrUndef(row[mapping.volumeAus]);
    const whUs = numOrUndef(row[mapping.volumeUs]);
    const whCn = numOrUndef(row[mapping.volumeCn]);
    const hasWarehouseData = whUk !== undefined || whEu !== undefined || whAus !== undefined || whUs !== undefined || whCn !== undefined;

    let warehouseVolumes: import('../types').WarehouseVolumes | undefined;
    let volume: number;

    if (hasWarehouseData) {
      warehouseVolumes = {};
      if (whUk !== undefined) warehouseVolumes.uk = whUk;
      if (whEu !== undefined) warehouseVolumes.eu = whEu;
      if (whAus !== undefined) warehouseVolumes.aus = whAus;
      if (whUs !== undefined) warehouseVolumes.us = whUs;
      if (whCn !== undefined) warehouseVolumes.cn = whCn;
      volume = (whUk ?? 0) + (whEu ?? 0) + (whAus ?? 0) + (whUs ?? 0) + (whCn ?? 0);
    } else {
      volume = Number(row[mapping.volume]) || 0;
    }

    return {
      id: `product-${index}-${String(row[mapping.sku] ?? index)}`,
      sku: str(row[mapping.sku]),
      name: str(row[mapping.name]),
      category: str(row[mapping.category]),
      subCategory: str(row[mapping.subCategory]),
      productFamily: str(row[mapping.productFamily]),
      sapCollection: normaliseSapCollection(row[mapping.sapCollection]),
      volume,
      warehouseVolumes,
      // forecastVolume is no longer imported from the catalogue — the
      // tool builds its own forecast via the Forecast Lab pipeline.
      // The field stays on the Product type so existing data loads
      // cleanly, but new imports don't populate it.
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
