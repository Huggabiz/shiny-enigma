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
  function: { label: 'Function', hint: 'Product function or purpose', required: false },
  productFamily: { label: 'Product Family', hint: 'Product family grouping', required: false },
  volume: { label: 'Volume', hint: 'Sales volume (numeric)', required: true, aliases: ['units'] },
  rrp: { label: 'UK RRP', hint: 'UK recommended retail price (numeric)', required: false, aliases: ['rrp', 'uk rrp'] },
  usRrp: { label: 'US RRP', hint: 'US recommended retail price (numeric)', required: false, aliases: ['us rrp', 'usa rrp'] },
  euRrp: { label: 'EU RRP', hint: 'EU recommended retail price (numeric)', required: false, aliases: ['eu rrp', 'europe rrp'] },
  ausRrp: { label: 'AUS RRP', hint: 'Australia recommended retail price (numeric)', required: false, aliases: ['aus rrp', 'australia rrp'] },
  revenue: { label: 'Revenue', hint: 'Total revenue (numeric)', required: false, aliases: ['ytd'] },
  imageUrl: { label: 'Image URL', hint: 'Web URL to product image', required: false },
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
    const newMapping = { ...mapping };
    const lowerHeaders = hdrs.map(h => h.toLowerCase().trim());
    for (const [key, desc] of Object.entries(FIELD_DESCRIPTIONS)) {
      const label = desc.label.toLowerCase();
      const aliases = (desc.aliases || []).map(a => a.toLowerCase());
      // Exact matches first
      let matchIndex = lowerHeaders.findIndex(h =>
        h === label || h === key.toLowerCase() || aliases.includes(h)
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
