import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Product, ShelfItem, FuturePricing } from '../types';
import { useProjectStore } from '../store/useProjectStore';
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

const REGION_LABEL: Record<RrpRegion, string> = {
  ukRrp: 'UK',
  usRrp: 'US',
  euRrp: 'EU',
  ausRrp: 'AUS',
};

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

  const labelText = showLabel ? `${REGION_LABEL[region]}: ` : '';
  const className = `card-rrp ${region === 'ukRrp' ? '' : `card-rrp-${region.replace('Rrp', '')}`}`;

  if (editing && editable) {
    return (
      <span className={className} onClick={(e) => e.stopPropagation()}>
        {labelText}
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
      {labelText}{displayVal !== undefined && displayVal !== 0 ? displayVal : '—'}
      {delta !== null && (
        <span className={`card-rrp-delta ${delta > 0 ? 'up' : 'down'}`}>
          {' '}{delta > 0 ? '↑' : '↓'}{Math.abs(delta).toFixed(2)}
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
        function: phData.function,
        productFamily: phData.productFamily,
        volume: phData.volume,
        rrp: phData.rrp,
        usRrp: phData.usRrp,
        euRrp: phData.euRrp,
        ausRrp: phData.ausRrp,
        revenue: phData.revenue,
        imageUrl: phData.imageUrl,
        source: phData.source,
      }
    : product;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cardClass}
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
      {cardProduct && !isCompact && (
        <div className="card-stats">
          {cardFormat.showSku && <span className="card-sku">{displaySku || '—'}</span>}
          {cardFormat.showVolume && <span className="card-volume">Vol: {cardProduct.volume ? cardProduct.volume.toLocaleString() : '—'}</span>}
          {cardFormat.showRrp && <RrpRow product={cardProduct} region="ukRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={true} />}
          {cardFormat.showUsRrp && <RrpRow product={cardProduct} region="usRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={true} />}
          {cardFormat.showEuRrp && <RrpRow product={cardProduct} region="euRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={true} />}
          {cardFormat.showAusRrp && <RrpRow product={cardProduct} region="ausRrp" editable={!!editableFuturePricing && !item.isPlaceholder} showLabel={true} />}
          {cardFormat.showRevenue && <span className="card-revenue">Rev: {cardProduct.revenue ? cardProduct.revenue.toLocaleString() : '—'}</span>}
          {cardFormat.showCategory && <span className="card-category">{cardProduct.category || '—'}</span>}
        </div>
      )}
      {cardProduct && isCompact && (
        <div className="card-stats">
          {cardFormat.showVolume && <span className="card-volume">{cardProduct.volume ? cardProduct.volume.toLocaleString() : '—'}</span>}
          {cardFormat.showRrp && <span className="card-rrp">{cardProduct.rrp || '—'}</span>}
        </div>
      )}
      {item.isPlaceholder && !cardProduct && !isCompact && (
        <div className="card-stats">
          <span className="card-placeholder-tag">Planned</span>
          {cardFormat.showSku && <span className="card-sku">—</span>}
          {cardFormat.showVolume && <span className="card-volume">Vol: —</span>}
          {cardFormat.showRrp && <span className="card-rrp">RRP: —</span>}
        </div>
      )}
    </div>
  );
}
