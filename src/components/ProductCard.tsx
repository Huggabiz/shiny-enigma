import { useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Product, ShelfItem, FuturePricing } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { hexToRgba } from '../utils/color';
import { CloseIcon } from './Icons';
import './ProductCard.css';

interface ProductCardProps {
  item: ShelfItem;
  product?: Product;
  isSelected?: boolean;
  isLinkMode?: boolean;
  isLinkSource?: boolean;
  isDimmed?: boolean;
  isGhosted?: boolean;
  isDiscontinued?: boolean;
  isLinkHighlight?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onRemove?: () => void;
  overlay?: boolean;
  cardWidth?: number;
  editableFuturePricing?: boolean;
}

type RrpRegion = 'ukRrp' | 'usRrp' | 'euRrp' | 'ausRrp';

const REGION_SYMBOL: Record<RrpRegion, string> = {
  ukRrp: '\u00A3',   // £
  usRrp: '$',
  euRrp: '\u20AC',   // €
  ausRrp: 'A$',
};

// Format a number with up to 2 decimal places, preserving the symbol
function formatCurrency(symbol: string, value: number): string {
  const str = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${symbol}${str}`;
}

function getCatalogueRrp(product: Product, region: RrpRegion): number | undefined {
  if (region === 'ukRrp') return product.rrp;
  return product[region] as number | undefined;
}

function getFutureRrp(product: Product, region: RrpRegion): number | undefined {
  return product.futurePricing?.default?.[region as keyof FuturePricing];
}

interface RrpRowProps {
  product: Product;
  region: RrpRegion;
  editable: boolean;
  showLabel: boolean;
}

function RrpRow({ product, region, editable, showLabel }: RrpRowProps) {
  const setFuturePricing = useProjectStore((s) => s.setFuturePricing);
  const [editing, setEditing] = useState(false);
  const catVal = getCatalogueRrp(product, region);
  const futVal = getFutureRrp(product, region);
  const displayVal = editable ? (futVal !== undefined ? futVal : catVal) : catVal;

  // Delta calculation for future view: only if override exists and differs
  let delta: number | null = null;
  if (editable && futVal !== undefined && catVal !== undefined && futVal !== catVal) {
    delta = futVal - catVal;
  }

  const symbol = REGION_SYMBOL[region];
  // Matrix view shows the currency symbol only (no "UK " prefix); match it
  // here so both views read the same. showLabel is kept as a prop for API
  // stability but currently unused.
  void showLabel;
  const className = `card-rrp ${region === 'ukRrp' ? '' : `card-rrp-${region.replace('Rrp', '')}`}`;

  if (editing && editable) {
    return (
      <span className={className} onClick={(e) => e.stopPropagation()}>
        {symbol}
        <input
          type="number"
          step="0.01"
          className="card-rrp-input"
          defaultValue={futVal !== undefined ? futVal : (catVal ?? '')}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value);
            // If the new value matches the catalogue exactly, clear the override
            if (v === undefined || v === catVal) {
              setFuturePricing(product.id, region, undefined);
            } else {
              setFuturePricing(product.id, region, v);
            }
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={className}
      title={editable ? 'Click to set future override' : undefined}
      onClick={editable ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
      style={editable ? { cursor: 'pointer' } : undefined}
    >
      {displayVal !== undefined && displayVal !== 0 ? formatCurrency(symbol, displayVal) : '\u2014'}
      {delta !== null && (
        <span className={`card-rrp-delta ${delta > 0 ? 'up' : 'down'}`}>
          {' '}{delta > 0 ? '\u2191' : '\u2193'}{formatCurrency(symbol, Math.abs(delta))}
        </span>
      )}
    </span>
  );
}

export function ProductCard({
  item,
  product,
  isSelected,
  isLinkMode,
  isLinkSource,
  isDimmed,
  isGhosted,
  isDiscontinued,
  isLinkHighlight,
  onClick,
  onDoubleClick,
  onRemove,
  overlay,
  cardWidth,
  editableFuturePricing,
}: ProductCardProps) {
  const cardFormat = useProjectStore((s) => s.cardFormat);
  // Lens tinting — if there's an active custom lens that contains this
  // product, paint the card background in the lens colour. Mirrors the
  // wiring in MatrixProductCard so shelf cards (transform view) and
  // multiplan rows pick up lens visuals the same way matrix cards do.
  const project = useProjectStore((s) => s.project);
  const activeLens = useMemo(() => {
    if (!project?.activeLensId) return null;
    return project.lenses?.find((l) => l.id === project.activeLensId) ?? null;
  }, [project?.activeLensId, project?.lenses]);
  const productInActiveLens = useMemo(() => {
    if (!activeLens || !product) return false;
    // Built-in lenses (Dev) own their styling via existing CSS classes
    // and aren't part of the lens-tint selectable set.
    if (activeLens.builtInKind) return false;
    return activeLens.productIds.includes(product.id);
  }, [activeLens, product]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: overlay });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(cardWidth ? { width: `${cardWidth}px`, minWidth: `${cardWidth}px` } : {}),
    ...(productInActiveLens && activeLens
      ? { backgroundColor: hexToRgba(activeLens.color, 0.22), borderColor: activeLens.color }
      : {}),
  };

  // Pull display data from placeholderData when present
  const phData = item.placeholderData;
  const displayName = item.isPlaceholder
    ? (phData?.name || item.placeholderName || 'New SKU')
    : product?.name || 'Unknown';
  const displaySku = item.isPlaceholder ? phData?.sku || '' : product?.sku || '';
  const displayImageUrl = item.isPlaceholder ? phData?.imageUrl : product?.imageUrl;
  const displaySource: 'live' | 'dev' = item.isPlaceholder
    ? (phData?.source || 'live')
    : (product?.source || 'live');
  const isDev = !item.isPlaceholder && displaySource === 'dev';

  const isCompact = cardWidth !== undefined && cardWidth < 75;

  const cardClass = [
    'product-card',
    item.isPlaceholder ? 'placeholder' : '',
    isDev ? 'dev-product' : '',
    isSelected ? 'selected' : '',
    isLinkMode ? 'link-mode' : '',
    isLinkSource ? 'link-source' : '',
    isDimmed ? 'dimmed' : '',
    isGhosted ? 'ghosted' : '',
    isDiscontinued ? 'ghosted-discontinued' : '',
    isLinkHighlight ? 'link-highlight' : '',
    overlay ? 'overlay' : '',
    isCompact ? 'compact' : '',
    productInActiveLens ? 'lens-tinted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Build a synthetic product for placeholders so RrpRow can render
  const cardProduct: Product | undefined = item.isPlaceholder && phData
    ? {
        id: item.id,
        sku: phData.sku,
        name: phData.name,
        category: phData.category,
        subCategory: phData.subCategory,
        productFamily: phData.productFamily,
        volume: phData.volume,
        forecastVolume: phData.forecastVolume,
        rrp: phData.rrp,
        usRrp: phData.usRrp,
        euRrp: phData.euRrp,
        ausRrp: phData.ausRrp,
        revenue: phData.revenue,
        forecastRevenue: phData.forecastRevenue,
        imageUrl: phData.imageUrl,
        source: phData.source,
      }
    : product;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cardClass}
      data-item-id={item.id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...attributes}
      {...listeners}
    >
      {item.isPlaceholder && (
        <div className={`card-new-badge ${isCompact ? 'compact' : ''}`}>New</div>
      )}
      {isDev && (
        <div className={`card-new-badge dev ${isCompact ? 'compact' : ''}`}>DEV</div>
      )}
      {onRemove && !isDimmed && (
        <button className="card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><CloseIcon size={8} color="#fff" /></button>
      )}
      {cardFormat.showImage && (
        <div className="card-image" style={isCompact ? { width: 36, height: 32 } : undefined}>
          {displayImageUrl ? (
            <img src={displayImageUrl} alt={displayName} />
          ) : (
            <div className={`card-image-placeholder ${item.isPlaceholder || isDev ? 'new-product' : ''}`}>
              {item.isPlaceholder ? '＋' : displayName.charAt(0)}
            </div>
          )}
        </div>
      )}
      {cardFormat.showName && (
        <div className="card-name" title={displayName} style={isCompact ? { fontSize: 8 } : undefined}>
          {displayName}
        </div>
      )}
      {cardProduct && (
        <div className="card-stats">
          {cardFormat.showSku && !isCompact && <span className="card-sku">{displaySku || '\u2014'}</span>}
          {cardFormat.showVolume && (
            <span className="card-volume">{isCompact ? '' : 'Vol: '}{cardProduct.volume ? cardProduct.volume.toLocaleString() : '\u2014'}</span>
          )}
          {cardFormat.showForecastVolume && cardProduct.forecastVolume !== undefined && (
            <span className="card-forecast">{isCompact ? '' : 'Fcst: '}{cardProduct.forecastVolume.toLocaleString()}</span>
          )}
          {cardFormat.showRrp && <RrpRow product={cardProduct} region="ukRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={false} />}
          {cardFormat.showUsRrp && <RrpRow product={cardProduct} region="usRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={false} />}
          {cardFormat.showEuRrp && <RrpRow product={cardProduct} region="euRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={false} />}
          {cardFormat.showAusRrp && <RrpRow product={cardProduct} region="ausRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={false} />}
          {cardFormat.showRevenue && cardProduct.revenue > 0 && (
            <span className="card-revenue">{isCompact ? '' : 'Rev: '}{cardProduct.revenue.toLocaleString()}</span>
          )}
          {cardFormat.showForecastRevenue && cardProduct.forecastRevenue !== undefined && (
            <span className="card-forecast-revenue">{isCompact ? '' : 'Fcst Rev: '}{cardProduct.forecastRevenue.toLocaleString()}</span>
          )}
          {cardFormat.showCategory && !isCompact && <span className="card-category">{cardProduct.category || '\u2014'}</span>}
        </div>
      )}
      {item.isPlaceholder && !cardProduct && !isCompact && (
        <div className="card-stats">
          <span className="card-placeholder-tag">Planned</span>
          {cardFormat.showSku && <span className="card-sku">—</span>}
          {cardFormat.showVolume && <span className="card-volume">Vol: —</span>}
          {cardFormat.showForecastVolume && <span className="card-forecast">Fcst: —</span>}
          {cardFormat.showRrp && <span className="card-rrp">RRP: —</span>}
        </div>
      )}
    </div>
  );
}
