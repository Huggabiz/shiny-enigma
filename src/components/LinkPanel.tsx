import type { Product, ShelfItem, SankeyLink } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import './LinkPanel.css';

interface LinkPanelProps {
  sourceItem: ShelfItem;
  sourceProduct: Product | undefined;
  links: SankeyLink[];
  futureItems: ShelfItem[];
  catalogue: Product[];
}

export function LinkPanel({ sourceItem, sourceProduct, links, futureItems, catalogue }: LinkPanelProps) {
  const { updateLink, removeLink, addLink } = useProjectStore();

  const sourceVolume = sourceProduct?.volume || 0;
  const sourceRevenue = sourceProduct?.revenue || 0;

  // Links from this source
  const outgoingLinks = links.filter((l) => l.sourceItemId === sourceItem.id);
  const totalAllocated = outgoingLinks.reduce((sum, l) => sum + (l.percent ?? 100), 0);
  const unallocated = 100 - totalAllocated;

  const handlePercentChange = (targetId: string, newPercent: number) => {
    const clamped = Math.max(0, Math.min(newPercent, 100));
    const volume = Math.round(sourceVolume * clamped / 100);
    updateLink(sourceItem.id, targetId, { percent: clamped, volume });
  };

  const handleAddConnection = (targetItemId: string) => {
    const defaultPercent = Math.min(Math.max(unallocated, 0), 100);
    addLink({
      sourceItemId: sourceItem.id,
      targetItemId,
      percent: defaultPercent,
      volume: Math.round(sourceVolume * defaultPercent / 100),
      type: 'transfer',
    });
  };

  // Future items not yet linked from this source
  const linkedTargetIds = new Set(outgoingLinks.map((l) => l.targetItemId));
  const availableTargets = futureItems.filter((fi) => !linkedTargetIds.has(fi.id));

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

      {/* Allocation table with sliders */}
      <div className="link-panel-allocations">
        <div className="link-alloc-header">
          <span>Allocated to</span>
          <span>%</span>
          <span>Volume</span>
          <span></span>
        </div>
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
                  max={100}
                  value={pct}
                  onChange={(e) => handlePercentChange(link.targetItemId, Number(e.target.value))}
                />
                <span className="link-alloc-percent-value">{pct}%</span>
              </div>
              <span className="link-alloc-volume">{link.volume.toLocaleString()}</span>
              <button
                className="link-alloc-remove"
                onClick={() => removeLink(sourceItem.id, link.targetItemId)}
                title="Remove connection"
              >
                ×
              </button>
            </div>
          );
        })}

        {/* Summary */}
        <div className="link-alloc-summary">
          <span>Total allocated</span>
          <span className={totalAllocated > 100 ? 'over-allocated' : ''}>{totalAllocated}%</span>
          <span>{Math.round(sourceVolume * totalAllocated / 100).toLocaleString()}</span>
          <span></span>
        </div>
        {unallocated > 0 && (
          <div className="link-alloc-unallocated">
            <span>Unallocated (lost)</span>
            <span className="lost">{unallocated}%</span>
            <span className="lost">{Math.round(sourceVolume * unallocated / 100).toLocaleString()}</span>
            <span></span>
          </div>
        )}
      </div>

      {/* Add connection to future SKU */}
      {availableTargets.length > 0 && (
        <div className="link-panel-add">
          <span className="link-panel-add-label">Connect to:</span>
          <div className="link-panel-add-targets">
            {availableTargets.map((target) => {
              const targetProduct = catalogue.find((p) => p.id === target.productId);
              const name = target.isPlaceholder
                ? target.placeholderName
                : targetProduct?.name || 'Unknown';
              return (
                <button
                  key={target.id}
                  className="link-add-btn"
                  onClick={() => handleAddConnection(target.id)}
                  title={`Connect to ${name}`}
                >
                  + {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="link-panel-hint">
        Click a future range product to connect, or use the buttons above. Adjust sliders to set volume allocation.
      </div>
    </div>
  );
}
