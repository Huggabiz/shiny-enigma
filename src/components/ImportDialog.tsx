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

export function ImportDialog({ onImport, onClose }: ImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ ...DEFAULT_COLUMN_MAPPING });
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Product[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const data = await readFile(file);
    setFileData(data);

    const { products, headers: hdrs } = parseSpreadsheet(data, mapping);
    setHeaders(hdrs);
    setPreview(products.slice(0, 5));
  };

  const handleMappingChange = (field: keyof ColumnMapping, value: string) => {
    const newMapping = { ...mapping, [field]: value };
    setMapping(newMapping);

    if (fileData) {
      const { products } = parseSpreadsheet(fileData, newMapping);
      setPreview(products.slice(0, 5));
    }
  };

  const handleImport = () => {
    if (!fileData) return;
    const { products } = parseSpreadsheet(fileData, mapping);
    onImport(products);
    onClose();
  };

  const mappingFields: { key: keyof ColumnMapping; label: string }[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'subCategory', label: 'Sub-Category' },
    { key: 'function', label: 'Function' },
    { key: 'productFamily', label: 'Product Family' },
    { key: 'volume', label: 'Volume' },
    { key: 'rrp', label: 'RRP' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'imageUrl', label: 'Image URL' },
  ];

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
              <h4>Column Mapping</h4>
              <p className="mapping-hint">
                Map your file columns to the required fields. Select the column header that
                matches each field.
              </p>
              <div className="mapping-grid">
                {mappingFields.map(({ key, label }) => (
                  <div key={key} className="mapping-row">
                    <label>{label}</label>
                    <select
                      value={mapping[key]}
                      onChange={(e) => handleMappingChange(key, e.target.value)}
                    >
                      <option value="">-- Not mapped --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {preview.length > 0 && (
                <>
                  <h4>Preview (first 5 rows)</h4>
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
                            <td>{p.sku}</td>
                            <td>{p.name}</td>
                            <td>{p.category}</td>
                            <td>{p.volume.toLocaleString()}</td>
                            <td>{p.rrp}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleImport} disabled={!fileData}>
            Import {preview.length > 0 ? `(${preview.length}+ products)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
