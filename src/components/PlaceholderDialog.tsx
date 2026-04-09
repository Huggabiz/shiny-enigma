import { useState } from 'react';
import type { PlaceholderData } from '../types';
import { CloseIcon } from './Icons';
import './PlaceholderDialog.css';

interface PlaceholderDialogProps {
  mode: 'create' | 'edit';
  initialData?: Partial<PlaceholderData>;
  existingSkus: Set<string>; // SKUs to exclude (catalogue + other placeholders), excluding own original
  onSave: (data: PlaceholderData) => void;
  onClose: () => void;
}

const EMPTY_DATA: PlaceholderData = {
  sku: '',
  name: '',
  category: '',
  subCategory: '',
  productFamily: '',
  volume: 0,
  forecastVolume: undefined,
  forecastRevenue: undefined,
  rrp: 0,
  usRrp: undefined,
  euRrp: undefined,
  ausRrp: undefined,
  revenue: 0,
  imageUrl: undefined,
  source: 'live',
};

export function PlaceholderDialog({ mode, initialData, existingSkus, onSave, onClose }: PlaceholderDialogProps) {
  const [data, setData] = useState<PlaceholderData>({ ...EMPTY_DATA, ...initialData });
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof PlaceholderData>(key: K, value: PlaceholderData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const sku = data.sku.trim();
    const name = data.name.trim();
    if (!name) { setError('Product Name is required'); return; }
    // SKU is optional; only enforce uniqueness when a non-blank value is given.
    if (sku && existingSkus.has(sku)) { setError(`SKU "${sku}" already exists in this project`); return; }
    onSave({ ...data, sku, name });
  };

  const numberInput = (val: number | undefined) => (val === undefined || val === 0 ? '' : String(val));
  const toNumOrUndef = (s: string): number | undefined => {
    if (s === '') return undefined;
    const n = Number(s);
    return isNaN(n) ? undefined : n;
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog placeholder-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{mode === 'create' ? 'New Placeholder SKU' : 'Edit Placeholder SKU'}</h2>
          <button className="dialog-close-btn" onClick={onClose}><CloseIcon size={12} color="#999" /></button>
        </div>

        <div className="dialog-body">
          <div className="ph-field-grid">
            <label className="ph-field full">
              <span className="ph-label">SKU <span className="optional">(optional)</span></span>
              <input type="text" value={data.sku} onChange={(e) => update('sku', e.target.value)} placeholder="e.g. NEW-001 — leave blank if not yet assigned" />
            </label>
            <label className="ph-field full">
              <span className="ph-label">Product Name <span className="req">*</span></span>
              <input type="text" value={data.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. Premium Storage Basket" />
            </label>

            <label className="ph-field">
              <span className="ph-label">Category</span>
              <input type="text" value={data.category} onChange={(e) => update('category', e.target.value)} />
            </label>
            <label className="ph-field">
              <span className="ph-label">Sub-Category</span>
              <input type="text" value={data.subCategory} onChange={(e) => update('subCategory', e.target.value)} />
            </label>

            <label className="ph-field full">
              <span className="ph-label">Product Family</span>
              <input type="text" value={data.productFamily} onChange={(e) => update('productFamily', e.target.value)} />
            </label>

            <label className="ph-field">
              <span className="ph-label">Volume <span className="optional">(last year)</span></span>
              <input type="number" value={numberInput(data.volume)} onChange={(e) => update('volume', Number(e.target.value) || 0)} />
            </label>
            <label className="ph-field">
              <span className="ph-label">Forecast Volume <span className="optional">(next year)</span></span>
              <input type="number" value={numberInput(data.forecastVolume)} onChange={(e) => update('forecastVolume', toNumOrUndef(e.target.value))} />
            </label>

            <label className="ph-field">
              <span className="ph-label">Revenue <span className="optional">(last year)</span></span>
              <input type="number" value={numberInput(data.revenue)} onChange={(e) => update('revenue', Number(e.target.value) || 0)} />
            </label>
            <label className="ph-field">
              <span className="ph-label">Forecast Revenue <span className="optional">(next year)</span></span>
              <input type="number" value={numberInput(data.forecastRevenue)} onChange={(e) => update('forecastRevenue', toNumOrUndef(e.target.value))} />
            </label>

            <label className="ph-field">
              <span className="ph-label">UK RRP</span>
              <input type="number" step="0.01" value={numberInput(data.rrp)} onChange={(e) => update('rrp', Number(e.target.value) || 0)} />
            </label>
            <label className="ph-field">
              <span className="ph-label">US RRP</span>
              <input type="number" step="0.01" value={numberInput(data.usRrp)} onChange={(e) => update('usRrp', toNumOrUndef(e.target.value))} />
            </label>

            <label className="ph-field">
              <span className="ph-label">EU RRP</span>
              <input type="number" step="0.01" value={numberInput(data.euRrp)} onChange={(e) => update('euRrp', toNumOrUndef(e.target.value))} />
            </label>
            <label className="ph-field">
              <span className="ph-label">AUS RRP</span>
              <input type="number" step="0.01" value={numberInput(data.ausRrp)} onChange={(e) => update('ausRrp', toNumOrUndef(e.target.value))} />
            </label>

            <label className="ph-field full">
              <span className="ph-label">Image URL</span>
              <input type="text" value={data.imageUrl || ''} onChange={(e) => update('imageUrl', e.target.value || undefined)} placeholder="https://..." />
            </label>

            <div className="ph-field full">
              <span className="ph-label">Source</span>
              <div className="ph-radio-group">
                <label className="ph-radio">
                  <input type="radio" name="source" checked={data.source === 'live'} onChange={() => update('source', 'live')} />
                  <span>Live</span>
                </label>
                <label className="ph-radio">
                  <input type="radio" name="source" checked={data.source === 'dev'} onChange={() => update('source', 'dev')} />
                  <span>Development</span>
                </label>
              </div>
            </div>
          </div>

          {error && <div className="ph-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>{mode === 'create' ? 'Create' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
