import type { Product, ShelfItem, SankeyLink } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { CloseIcon } from './Icons';
import './LinkPanel.css';

interface LinkPanelProps {
  sourceItem: ShelfItem;
  sourceProduct: Product | undefined;
  links: SankeyLink[];
  futureItems: ShelfItem[];
  catalogue: Product[];
}

export function LinkPanel({ sourceItem, sourceProduct, links, futureItems, catalogue }: LinkPanelProps) {
  const { updateLink, removeLink, setLinkMode, setLinkSource } = useProjectStore();

  const sourceVolume = sourceProduct?.volume || 0;
  const sourceRevenue = sourceProduct?.revenue || 0;

  const outgoingLinks = links.filter((l) => l.sourceItemId === sourceItem.id);
  const totalAllocated = outgoingLinks.reduce((sum, l) => sum + (l.percent ?? 100), 0);
  const unallocated = 100 - totalAllocated;

  const handlePercentChange = (targetId: string, newPercent: number) => {
    const clamped = Math.max(0, Math.min(newPercent, 160));
    const volume = Math.round(sourceVolume * clamped / 100);
    updateLink(sourceItem.id, targetId, { percent: clamped, volume });
  };

  const handleDone = () => {
    setLinkMode(false);
    setLinkSource(null);
  };

  return (
    <div className="link-panel">
      <div className="link-panel-header">
        <div className="link-panel-product">
          <div className="link-panel-name">{sourceProduct?.name || sourceItem.placeholderName || 'Unknown'}</div>
          <div className="link-panel-sku">{sourceProduct?.sku || ''}</div>
        </div>
        <div className="link-panel-stats">
          <div className="link-stat">
            <span className="link-stat-label">Volume</span>
            <span className="link-stat-value">{sourceVolume.toLocaleString()}</span>
          </div>
          <div className="link-stat">
            <span className="link-stat-label">Revenue</span>
            <span className="link-stat-value">{sourceRevenue.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {outgoingLinks.length === 0 ? (
        <div className="link-panel-empty">
          Click a product in the Future Range to create a connection.
        </div>
      ) : (
        <div className="link-panel-allocations">
          {outgoingLinks.map((link) => {
            const targetItem = futureItems.find((fi) => fi.id === link.targetItemId);
            const targetProduct = targetItem ? catalogue.find((p) => p.id === targetItem.productId) : null;
            const targetName = targetItem?.isPlaceholder
              ? targetItem.placeholderName
              : targetProduct?.name || 'Unknown';
            const pct = link.percent ?? 100;

            return (
              <div key={link.targetItemId} className="link-alloc-row">
                <span className="link-alloc-name" title={targetName}>{targetName}</span>
                <div className="link-alloc-slider-group">
                  <input
                    type="range"
                    className="link-alloc-slider"
                    min={0}
                    max={160}
                    value={pct}
                    onChange={(e) => handlePercentChange(link.targetItemId, Number(e.target.value))}
                  />
                </div>
                <span className={`link-alloc-percent-value ${pct > 100 ? 'growth' : ''}`}>{pct}%</span>
                <button
                  className="link-alloc-remove"
                  onClick={() => removeLink(sourceItem.id, link.targetItemId)}
                  title="Remove connection"
                >
                  <CloseIcon size={8} color="currentColor" />
                </button>
                <span className="link-alloc-volume">{link.volume.toLocaleString()}</span>
              </div>
            );
          })}

          <div className="link-alloc-summary">
            <span>Total allocated</span>
            <span className={`summary-pct ${totalAllocated > 100 ? 'over-allocated' : ''}`}>
              {totalAllocated}% · {Math.round(sourceVolume * totalAllocated / 100).toLocaleString()}
            </span>
          </div>
          {unallocated > 0 && (
            <div className="link-alloc-unallocated">
              <span>Unallocated (lost)</span>
              <span className="lost">
                {unallocated}% · {Math.round(sourceVolume * unallocated / 100).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="link-panel-footer">
        <span className="link-panel-hint">Click future range products to add connections.</span>
        <button className="link-panel-done" onClick={handleDone}>Done</button>
      </div>
    </div>
  );
}
