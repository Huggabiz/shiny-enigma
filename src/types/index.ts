// Core product type matching the data schema
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  function: string;
  productFamily: string;
  volume: number;
  rrp: number;
  revenue: number;
  imageUrl?: string;
  // Extensible for future attributes
  [key: string]: unknown;
}

// A product placed on a shelf, with position info
export interface ShelfItem {
  id: string; // unique placement id
  productId: string;
  position: number;
  isPlaceholder: boolean;
  placeholderName?: string;
}

// A labelled section on a shelf
export interface ShelfLabel {
  id: string;
  text: string;
  startPosition: number;
  endPosition: number;
  color?: string;
}

// A shelf (either current or future range)
export interface Shelf {
  id: string;
  name: string;
  items: ShelfItem[];
  labels: ShelfLabel[];
}

// A flow link between current and future items
export interface SankeyLink {
  sourceItemId: string;
  targetItemId: string;
  volume: number;
  type: 'transfer' | 'growth' | 'loss';
}

// The full project state
export interface Project {
  name: string;
  currentShelf: Shelf;
  futureShelf: Shelf;
  sankeyLinks: SankeyLink[];
  catalogue: Product[];
  createdAt: string;
  updatedAt: string;
}

// Column mapping for import flexibility
export interface ColumnMapping {
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  function: string;
  productFamily: string;
  volume: string;
  rrp: string;
  revenue: string;
  imageUrl: string;
}

export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  sku: 'SKU',
  name: 'Name',
  category: 'Category',
  subCategory: 'Sub-Category',
  function: 'Function',
  productFamily: 'Product Family',
  volume: 'Volume',
  rrp: 'RRP',
  revenue: 'Revenue',
  imageUrl: 'Image URL',
};
