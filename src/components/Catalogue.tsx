import { useState, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Product } from '../types';
import './Catalogue.css';

interface CatalogueProps {
  products: Product[];
  onImport: () => void;
}

function CatalogueItem({ product }: { product: Product }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `catalogue-${product.id}`,
    data: { product, type: 'catalogue-item' },
  });

  return (
    <div
      ref={setNodeRef}
      className={`catalogue-item ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="catalogue-item-image">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} />
        ) : (
          <div className="catalogue-item-placeholder">{product.name.charAt(0)}</div>
        )}
      </div>
      <div className="catalogue-item-info">
        <div className="catalogue-item-name" title={product.name}>
          {product.name}
        </div>
        <div className="catalogue-item-meta">
          <span>{product.sku}</span>
          <span>Vol: {product.volume.toLocaleString()}</span>
        </div>
        <div className="catalogue-item-meta">
          <span>{product.category}</span>
          {product.subCategory && <span>{product.subCategory}</span>}
        </div>
      </div>
    </div>
  );
}

export function Catalogue({ products, onImport }: CatalogueProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [familyFilter, setFamilyFilter] = useState('');

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );

  const families = useMemo(
    () => [...new Set(products.map((p) => p.productFamily).filter(Boolean))].sort(),
    [products]
  );

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = !categoryFilter || p.category === categoryFilter;
      const matchesFamily = !familyFilter || p.productFamily === familyFilter;
      return matchesSearch && matchesCategory && matchesFamily;
    });
  }, [products, search, categoryFilter, familyFilter]);

  return (
    <div className="catalogue-panel">
      <div className="catalogue-header">
        <h3>Catalogue</h3>
        <button className="import-btn" onClick={onImport}>
          Import Data
        </button>
      </div>

      <div className="catalogue-filters">
        <input
          type="text"
          className="catalogue-search"
          placeholder="Search by name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="catalogue-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="catalogue-select"
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
        >
          <option value="">All Families</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="catalogue-count">{filtered.length} of {products.length} products</div>

      <div className="catalogue-list">
        {filtered.map((product) => (
          <CatalogueItem key={product.id} product={product} />
        ))}
        {filtered.length === 0 && (
          <div className="catalogue-empty">
            {products.length === 0
              ? 'Import a product file to get started'
              : 'No products match your filters'}
          </div>
        )}
      </div>
    </div>
  );
}
