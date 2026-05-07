import { useState, useRef } from 'react';
import type { ColumnMapping } from '../types';
import { DEFAULT_COLUMN_MAPPING } from '../types';
import { readFile, parseSpreadsheet } from '../utils/fileImport';
import type { Product } from '../types';
import './ImportDialog.css';

interface ImportDialogProps {
  onImport: (products: Product[]) => void;
  onClose: () => void;
}

const FIELD_DESCRIPTIONS: Record<keyof ColumnMapping, { label: string; hint: string; required: boolean; aliases?: string[] }> = {
  sku: { label: 'SKU', hint: 'Unique product identifier (e.g. "SKU-001")', required: true, aliases: ['product code', 'productcode'] },
  name: { label: 'Product Name', hint: 'Display name of the product', required: true, aliases: ['display name', 'displayname'] },
  category: { label: 'Category', hint: 'Top-level product category (e.g. "Skincare")', required: true },
  subCategory: { label: 'Sub-Category', hint: 'Category subdivision (e.g. "Moisturisers")', required: false, aliases: ['sub category', 'subcategory'] },
  productFamily: { label: 'Product Family', hint: 'Product family grouping', required: false },
  sapCollection: {
    label: 'SAP Collection',
    hint: 'Core or Duo — used as a catalogue filter',
    required: false,
    aliases: ['collection', 'sap collection'],
  },
  volume: {
    label: 'Volume (Total)',
    hint: 'Total last-year volume — used when per-warehouse columns are not present',
    required: false,
    aliases: [
      'units', 'actual volume', 'ly volume', 'last year volume',
      '12m vol q ly', '12m volume ly', 'vol ly', 'volume ly',
      'total volume',
    ],
  },
  volumeUk: {
    label: 'Volume UK',
    hint: 'UK warehouse volume (numeric)',
    required: false,
    aliases: ['volume uk', 'vol uk', 'uk vol', 'uk volume', 'uk units'],
  },
  volumeEu: {
    label: 'Volume EU',
    hint: 'EU warehouse volume (numeric)',
    required: false,
    aliases: ['volume eu', 'vol eu', 'eu vol', 'eu volume', 'eu units', 'europe volume'],
  },
  volumeAus: {
    label: 'Volume AUS',
    hint: 'Australia warehouse volume (numeric)',
    required: false,
    aliases: ['volume aus', 'vol aus', 'aus vol', 'aus volume', 'aus units', 'australia volume'],
  },
  volumeUs: {
    label: 'Volume US',
    hint: 'US warehouse volume (numeric)',
    required: false,
    aliases: ['volume us', 'vol us', 'us vol', 'us volume', 'us units', 'usa volume'],
  },
  volumeCn: {
    label: 'Volume CN',
    hint: 'CN (China/distribution) warehouse volume (numeric)',
    required: false,
    aliases: ['volume cn', 'vol cn', 'cn vol', 'cn volume', 'cn units', 'china volume'],
  },
  // forecastVolume removed from import — the tool builds its own
  // forecast via the Forecast Lab. The entry stays for type-compat
  // with Record<keyof ColumnMapping> but `hidden: true` keeps it
  // out of the UI and the parser ignores it.
  forecastVolume: {
    label: 'Forecast Volume',
    hint: '(No longer imported — tool builds its own forecast)',
    required: false,
    aliases: [],
  },
  rrp: { label: 'UK RRP', hint: 'UK recommended retail price (numeric)', required: false, aliases: ['rrp', 'uk rrp', 'rrp uk', 'rrp uk (gbp)', 'rrp (gbp)', 'uk rrp (gbp)', 'gbp rrp'] },
  usRrp: { label: 'US RRP', hint: 'US recommended retail price (numeric)', required: false, aliases: ['us rrp', 'usa rrp', 'rrp us', 'rrp us (usd)', 'rrp (usd)', 'us rrp (usd)', 'usd rrp'] },
  euRrp: { label: 'EU RRP', hint: 'EU recommended retail price (numeric)', required: false, aliases: ['eu rrp', 'europe rrp', 'rrp eu', 'rrp eu (eur)', 'rrp (eur)', 'eu rrp (eur)', 'eur rrp'] },
  ausRrp: { label: 'AUS RRP', hint: 'Australia recommended retail price (numeric)', required: false, aliases: ['aus rrp', 'australia rrp', 'rrp aus', 'rrp aus (aud)', 'rrp (aud)', 'aus rrp (aud)', 'aud rrp'] },
  revenue: {
    label: 'Revenue',
    hint: 'Last year\'s actual revenue (numeric)',
    required: false,
    aliases: [
      'ytd', 'actual revenue', 'ly revenue', 'last year revenue',
      '12m rev \u00a3 ly', '12m rev ly', '12m revenue ly', 'rev ly', 'revenue ly',
    ],
  },
  forecastRevenue: {
    label: 'Forecast Revenue',
    hint: 'Next year\'s forecast revenue (numeric)',
    required: false,
    aliases: [
      'forecast revenue', 'forecasted revenue', 'ny revenue', 'next year revenue', 'projected revenue', 'revenue forecast',
      '12m rev \u00a3 / yr1 fc', '12m rev / yr1 fc', '12m rev yr1 fc', '12m revenue yr1 fc',
      'rev yr1 fc', 'yr1 fc revenue', 'fc revenue',
    ],
  },
  imageUrl: { label: 'Image URL', hint: 'Web URL to product image', required: false, aliases: ['image', 'image url', 'imageurl', 'img', 'picture', 'photo'] },
  source: { label: 'Source', hint: 'Live or Dev — set Dev for in-development products', required: false, aliases: ['status', 'product status'] },
};

export function ImportDialog({ onImport, onClose }: ImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ ...DEFAULT_COLUMN_MAPPING });
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const data = await readFile(file);
    setFileData(data);

    const { products, headers: hdrs } = parseSpreadsheet(data, mapping);
    setHeaders(hdrs);
    setPreview(products.slice(0, 5));
    setTotalCount(products.length);

    // Auto-match headers to fields (label, key, aliases, then substring fallback)
    // Normalise by lowercasing, trimming, and collapsing any whitespace runs
    // (including non-breaking spaces) to a single ASCII space so that
    // spreadsheet quirks around "Foo  Bar" / "Foo\u00a0Bar" still match.
    const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const newMapping = { ...mapping };
    const lowerHeaders = hdrs.map(normalise);
    for (const [key, desc] of Object.entries(FIELD_DESCRIPTIONS)) {
      const label = normalise(desc.label);
      const aliases = (desc.aliases || []).map(normalise);
      // Exact matches first
      let matchIndex = lowerHeaders.findIndex(h =>
        h === label || h === normalise(key) || aliases.includes(h)
      );
      // Substring fallback
      if (matchIndex === -1) {
        matchIndex = lowerHeaders.findIndex(h =>
          h.includes(label) || label.includes(h) || aliases.some(a => h.includes(a) || a.includes(h))
        );
      }
      if (matchIndex !== -1) {
        (newMapping as Record<string, string>)[key] = hdrs[matchIndex];
      }
    }
    setMapping(newMapping);
    const { products: autoProducts } = parseSpreadsheet(data, newMapping);
    setPreview(autoProducts.slice(0, 5));
    setTotalCount(autoProducts.length);
  };

  const handleMappingChange = (field: keyof ColumnMapping, value: string) => {
    const newMapping = { ...mapping, [field]: value };
    setMapping(newMapping);

    if (fileData) {
      const { products } = parseSpreadsheet(fileData, newMapping);
      setPreview(products.slice(0, 5));
      setTotalCount(products.length);
    }
  };

  const handleImport = () => {
    if (!fileData) return;
    const { products } = parseSpreadsheet(fileData, mapping);
    onImport(products);
    onClose();
  };

  const mappingFields = Object.entries(FIELD_DESCRIPTIONS) as [keyof ColumnMapping, typeof FIELD_DESCRIPTIONS[keyof ColumnMapping]][];

  const isMapped = (field: keyof ColumnMapping) => {
    return mapping[field] && headers.includes(mapping[field]);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Import Product Data</h2>
          <button className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="dialog-body">
          {/* Expected format hint */}
          <div className="import-format-hint">
            <h4>Expected Data Format</h4>
            <p>Upload an Excel (.xlsx, .xls) or CSV file with your product catalogue. The tool needs the following columns:</p>
            <div className="expected-fields">
              {mappingFields.map(([key, desc]) => (
                <span key={key} className={`field-tag ${desc.required ? 'required' : 'optional'}`}>
                  {desc.label}
                  {desc.required && <span className="required-star">*</span>}
                </span>
              ))}
            </div>
            <p className="format-note">Fields marked with * are required. You can map your column names to these fields after uploading.</p>
          </div>

          <div className="file-picker">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              hidden
            />
            <button className="file-picker-btn" onClick={() => fileRef.current?.click()}>
              Choose File
            </button>
            <span className="file-name">{fileName || 'No file selected'}</span>
          </div>

          {headers.length > 0 && (
            <>
              <div className="mapping-section">
                <h4>Column Mapping</h4>
                <p className="mapping-hint">
                  We've auto-matched what we can. Review and adjust the mappings below — match each field to the corresponding column in your file.
                </p>
                <div className="mapping-grid">
                  {mappingFields.map(([key, desc]) => (
                    <div key={key} className={`mapping-row ${!isMapped(key) && desc.required ? 'unmapped-required' : ''}`}>
                      <div className="mapping-label">
                        <label>
                          {desc.label}
                          {desc.required && <span className="required-star">*</span>}
                        </label>
                        <span className="mapping-field-hint">{desc.hint}</span>
                      </div>
                      <div className="mapping-select-wrapper">
                        <select
                          value={mapping[key]}
                          onChange={(e) => handleMappingChange(key, e.target.value)}
                          className={isMapped(key) ? 'mapped' : ''}
                        >
                          <option value="">-- Not mapped --</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        {isMapped(key) && <span className="mapping-check">✓</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {preview.length > 0 && (
                <div className="preview-section">
                  <h4>Preview ({totalCount} products found, showing first 5)</h4>
                  <div className="preview-table-container">
                    <table className="preview-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Volume</th>
                          <th>RRP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((p, i) => (
                          <tr key={i}>
                            <td>{p.sku || <span className="empty-cell">—</span>}</td>
                            <td>{p.name || <span className="empty-cell">—</span>}</td>
                            <td>{p.category || <span className="empty-cell">—</span>}</td>
                            <td>{p.volume ? p.volume.toLocaleString() : <span className="empty-cell">—</span>}</td>
                            <td>{p.rrp || <span className="empty-cell">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleImport} disabled={!fileData}>
            Import {totalCount > 0 ? `${totalCount} Products` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
