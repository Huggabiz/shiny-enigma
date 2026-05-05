import { useMemo } from 'react';
import type { Product, ShelfItem, SankeyLink, ForecastConfig } from '../types';
import { DEFAULT_FORECAST_CONFIG } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { CloseIcon } from './Icons';
import './ForecastPanel.css';

interface ForecastPanelProps {
  /** The future-shelf item we're building the forecast for. */
  targetItem: ShelfItem;
  targetProduct: Product | undefined;
  /** All sankey links in the active plan. */
  links: SankeyLink[];
  /** Current-shelf items (potential sources). */
  currentItems: ShelfItem[];
  catalogue: Product[];
}

export function ForecastPanel({ targetItem, targetProduct, links, currentItems, catalogue }: ForecastPanelProps) {
  const { updateLink, removeLink, setLinkMode, setLinkSource, updateShelfItem } = useProjectStore();

  // Inbound links: links whose TARGET is the selected future item.
  const inboundLinks = useMemo(
    () => links.filter((l) => l.targetItemId === targetItem.id),
    [links, targetItem.id],
  );

  // Base volume: sum of inbound sankey contributions.
  const baseVolume = useMemo(
    () => inboundLinks.reduce((sum, l) => sum + (l.volume ?? 0), 0),
    [inboundLinks],
  );

  // Forecast config with defaults.
  const fc: ForecastConfig = targetItem.forecastConfig ?? DEFAULT_FORECAST_CONFIG;

  // Forecast volume: base × multiplicative factors + organic growth.
  const forecastVolume = Math.round(
    baseVolume * (fc.distributionPct / 100) * (fc.rampPct / 100) * (fc.rrpEffectPct / 100) + fc.organicGrowth,
  );
  const rrp = targetProduct?.futurePricing?.default?.ukRrp ?? targetProduct?.rrp ?? 0;
  const forecastRevenue = Math.round(forecastVolume * rrp);

  const handlePercentChange = (sourceId: string, newPercent: number) => {
    const clamped = Math.max(0, Math.min(100, newPercent));
    const sourceItem = currentItems.find((i) => i.id === sourceId);
    const sourceProduct = sourceItem ? catalogue.find((p) => p.id === sourceItem.productId) : null;
    const sourceVolume = sourceProduct?.volume ?? 0;
    const volume = Math.round(sourceVolume * clamped / 100);
    updateLink(sourceId, targetItem.id, { percent: clamped, volume });
  };

  const handleConfigChange = (patch: Partial<ForecastConfig>) => {
    updateShelfItem('future', targetItem.id, {
      forecastConfig: { ...fc, ...patch },
    });
  };

  const handleDone = () => {
    setLinkMode(false);
    setLinkSource(null);
  };

  // For each inbound source, check the source's total outbound.
  const sourceWarnings = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of links) {
      map.set(l.sourceItemId, (map.get(l.sourceItemId) ?? 0) + (l.percent ?? 100));
    }
    return map;
  }, [links]);

  return (
    <div className="forecast-panel">
      <div className="forecast-panel-header">
        <div className="forecast-panel-badge">Forecast</div>
        <div className="forecast-panel-product">
          <div className="forecast-panel-name">{targetProduct?.name || targetItem.placeholderName || 'Unknown'}</div>
          <div className="forecast-panel-sku">{targetProduct?.sku || ''}</div>
        </div>
        {rrp > 0 && (
          <div className="forecast-panel-rrp">RRP: £{rrp}</div>
        )}
      </div>

      {/* Sources — inbound links from current shelf items */}
      <div className="forecast-panel-section">
        <div className="forecast-panel-section-title">Sources</div>
        {inboundLinks.length === 0 ? (
          <div className="forecast-panel-empty">
            Click a product in the Current Range to add a source.
          </div>
        ) : (
          <div className="forecast-panel-sources">
            {inboundLinks.map((link) => {
              const sourceItem = currentItems.find((i) => i.id === link.sourceItemId);
              const sourceProduct = sourceItem ? catalogue.find((p) => p.id === sourceItem.productId) : null;
              const sourceName = sourceItem?.isPlaceholder
                ? sourceItem.placeholderName
                : sourceProduct?.name || 'Unknown';
              const sourceVol = sourceProduct?.volume ?? 0;
              const pct = link.percent ?? 100;
              const totalOutbound = sourceWarnings.get(link.sourceItemId) ?? 0;

              return (
                <div key={link.sourceItemId} className="forecast-source-row">
                  <div className="forecast-source-name" title={sourceName}>{sourceName}</div>
                  <div className="forecast-source-controls">
                    <input
                      type="range"
                      className="forecast-slider"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => handlePercentChange(link.sourceItemId, Number(e.target.value))}
                    />
                    <span className="forecast-source-pct">{pct}%</span>
                    <button
                      className="forecast-source-remove"
                      onClick={() => removeLink(link.sourceItemId, targetItem.id)}
                      title="Remove source"
                    >
                      <CloseIcon size={7} color="currentColor" />
                    </button>
                  </div>
                  <div className="forecast-source-vol">
                    {link.volume.toLocaleString()} of {sourceVol.toLocaleString()}
                    {totalOutbound > 100 && (
                      <span className="forecast-source-warn" title={`This source has ${totalOutbound}% total outbound — exceeds 100%`}> ⚠</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="forecast-base-volume">
          Base volume: <strong>{baseVolume.toLocaleString()}</strong>
        </div>
      </div>

      {/* Adjustments */}
      <div className="forecast-panel-section">
        <div className="forecast-panel-section-title">Adjustments</div>
        <div className="forecast-adjustments">
          <label className="forecast-adj-row">
            <span className="forecast-adj-label" title="% of full channel/customer distribution">Distribution</span>
            <input
              type="number"
              className="forecast-adj-input"
              min={0}
              max={100}
              value={fc.distributionPct}
              onChange={(e) => handleConfigChange({ distributionPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            />
            <span className="forecast-adj-unit">%</span>
          </label>
          <label className="forecast-adj-row">
            <span className="forecast-adj-label" title="% of steady-state volume in first period (awareness ramp-up)">Ramp</span>
            <input
              type="number"
              className="forecast-adj-input"
              min={0}
              max={100}
              value={fc.rampPct}
              onChange={(e) => handleConfigChange({ rampPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            />
            <span className="forecast-adj-unit">%</span>
          </label>
          <label className="forecast-adj-row">
            <span className="forecast-adj-label" title="Price effect on volume (95 = 5% drop from price increase)">RRP effect</span>
            <input
              type="number"
              className="forecast-adj-input"
              min={0}
              max={200}
              value={fc.rrpEffectPct}
              onChange={(e) => handleConfigChange({ rrpEffectPct: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
            />
            <span className="forecast-adj-unit">%</span>
          </label>
          <label className="forecast-adj-row">
            <span className="forecast-adj-label" title="Incremental units (added after the multiplicative factors)">Organic growth</span>
            <input
              type="number"
              className="forecast-adj-input wide"
              value={fc.organicGrowth}
              onChange={(e) => handleConfigChange({ organicGrowth: Number(e.target.value) || 0 })}
            />
            <span className="forecast-adj-unit">units</span>
          </label>
        </div>
      </div>

      {/* Forecast result */}
      <div className="forecast-panel-result">
        <div className="forecast-result-row">
          <span>Forecast Volume</span>
          <strong>{forecastVolume.toLocaleString()}</strong>
        </div>
        {rrp > 0 && (
          <div className="forecast-result-row revenue">
            <span>Forecast Revenue</span>
            <strong>£{forecastRevenue.toLocaleString()}</strong>
          </div>
        )}
      </div>

      <div className="forecast-panel-footer">
        <span className="forecast-panel-hint">Click current range products to add sources.</span>
        <button className="forecast-panel-done" onClick={handleDone}>Done</button>
      </div>
    </div>
  );
}
