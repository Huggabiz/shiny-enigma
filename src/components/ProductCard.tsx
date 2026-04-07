import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Product, ShelfItem } from '../types';
import './ProductCard.css';

interface ProductCardProps {
  item: ShelfItem;
  product?: Product;
  isSelected?: boolean;
  isLinkMode?: boolean;
  isLinkSource?: boolean;
  onClick?: () => void;
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
  onClick,
  onRemove,
  overlay,
  cardWidth,
}: ProductCardProps) {
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
      {...attributes}
      {...listeners}
    >
      {item.isPlaceholder && (
        <div className={`card-new-badge ${isCompact ? 'compact' : ''}`}>New</div>
      )}
      {onRemove && (
        <button
          className="card-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
      <div className="card-image" style={isCompact ? { width: 36, height: 32 } : undefined}>
        {product?.imageUrl ? (
          <img src={product.imageUrl} alt={name} />
        ) : (
          <div className={`card-image-placeholder ${item.isPlaceholder ? 'new-product' : ''}`}>
            {item.isPlaceholder ? '＋' : name.charAt(0)}
          </div>
        )}
      </div>
      <div className="card-name" title={name} style={isCompact ? { fontSize: 8 } : undefined}>
        {name}
      </div>
      {product && !isCompact && (
        <div className="card-stats">
          <span className="card-sku">{product.sku}</span>
          <span className="card-volume">Vol: {product.volume.toLocaleString()}</span>
        </div>
      )}
      {product && isCompact && (
        <div className="card-stats">
          <span className="card-volume">{product.volume.toLocaleString()}</span>
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
