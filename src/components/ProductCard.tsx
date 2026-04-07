import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Product, ShelfItem } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import './ProductCard.css';

interface ProductCardProps {
  item: ShelfItem;
  product?: Product;
  isSelected?: boolean;
  isLinkMode?: boolean;
  isLinkSource?: boolean;
  isDimmed?: boolean;
  isLinkHighlight?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onRemove?: () => void;
  overlay?: boolean;
  cardWidth?: number;
}

export function ProductCard({
  item,
  product,
  isSelected,
  isLinkMode,
  isLinkSource,
  isDimmed,
  isLinkHighlight,
  onClick,
  onDoubleClick,
  onRemove,
  overlay,
  cardWidth,
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

  const name = item.isPlaceholder
    ? item.placeholderName || 'New SKU'
    : product?.name || 'Unknown';

  const isCompact = cardWidth !== undefined && cardWidth < 75;

  const cardClass = [
    'product-card',
    item.isPlaceholder ? 'placeholder' : '',
    isSelected ? 'selected' : '',
    isLinkMode ? 'link-mode' : '',
    isLinkSource ? 'link-source' : '',
    isDimmed ? 'dimmed' : '',
    isLinkHighlight ? 'link-highlight' : '',
    overlay ? 'overlay' : '',
    isCompact ? 'compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
      {onRemove && !isDimmed && (
        <button className="card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
      )}
      {cardFormat.showImage && (
        <div className="card-image" style={isCompact ? { width: 36, height: 32 } : undefined}>
          {product?.imageUrl ? (
            <img src={product.imageUrl} alt={name} />
          ) : (
            <div className={`card-image-placeholder ${item.isPlaceholder ? 'new-product' : ''}`}>
              {item.isPlaceholder ? '＋' : name.charAt(0)}
            </div>
          )}
        </div>
      )}
      {cardFormat.showName && (
        <div className="card-name" title={name} style={isCompact ? { fontSize: 8 } : undefined}>
          {name}
        </div>
      )}
      {product && !isCompact && (
        <div className="card-stats">
          {cardFormat.showSku && <span className="card-sku">{product.sku}</span>}
          {cardFormat.showVolume && <span className="card-volume">Vol: {product.volume.toLocaleString()}</span>}
          {cardFormat.showRrp && product.rrp > 0 && <span className="card-rrp">RRP: {product.rrp}</span>}
          {cardFormat.showRevenue && product.revenue > 0 && <span className="card-revenue">Rev: {product.revenue.toLocaleString()}</span>}
          {cardFormat.showCategory && product.category && <span className="card-category">{product.category}</span>}
        </div>
      )}
      {product && isCompact && (
        <div className="card-stats">
          {cardFormat.showVolume && <span className="card-volume">{product.volume.toLocaleString()}</span>}
          {cardFormat.showRrp && product.rrp > 0 && <span className="card-rrp">{product.rrp}</span>}
        </div>
      )}
      {item.isPlaceholder && !isCompact && (
        <div className="card-stats">
          <span className="card-placeholder-tag">Planned</span>
        </div>
      )}
    </div>
  );
}
