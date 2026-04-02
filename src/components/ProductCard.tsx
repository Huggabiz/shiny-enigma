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
}: ProductCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: overlay });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const name = item.isPlaceholder
    ? item.placeholderName || 'New SKU'
    : product?.name || 'Unknown';

  const cardClass = [
    'product-card',
    item.isPlaceholder ? 'placeholder' : '',
    isSelected ? 'selected' : '',
    isLinkMode ? 'link-mode' : '',
    isLinkSource ? 'link-source' : '',
    overlay ? 'overlay' : '',
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
      <div className="card-image">
        {product?.imageUrl ? (
          <img src={product.imageUrl} alt={name} />
        ) : (
          <div className="card-image-placeholder">
            {item.isPlaceholder ? '＋' : name.charAt(0)}
          </div>
        )}
      </div>
      <div className="card-name" title={name}>
        {name}
      </div>
      {product && (
        <div className="card-stats">
          <span className="card-sku">{product.sku}</span>
          <span className="card-volume">Vol: {product.volume.toLocaleString()}</span>
        </div>
      )}
      {item.isPlaceholder && (
        <div className="card-stats">
          <span className="card-placeholder-tag">Placeholder</span>
        </div>
      )}
    </div>
  );
}
