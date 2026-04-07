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

// Matrix layout for design view — stored per shelf
export interface MatrixCellAssignment {
  itemId: string; // references ShelfItem.id
  row: number;
  col: number;
}

export interface MatrixLayout {
  title: string;
  xLabels: string[];
  yLabels: string[];
  assignments: MatrixCellAssignment[];
}

// A shelf (either current or future range)
export interface Shelf {
  id: string;
  name: string;
  items: ShelfItem[];
  labels: ShelfLabel[];
  matrixLayout?: MatrixLayout;
}

// A flow link between current and future items — percentage-based
export interface SankeyLink {
  sourceItemId: string;
  targetItemId: string;
  percent: number; // percentage of source volume allocated to this target
  volume: number;  // computed: source volume * percent / 100
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

// Card display format options
export interface CardFormat {
  showImage: boolean;
  showName: boolean;
  showSku: boolean;
  showVolume: boolean;
  showRrp: boolean;
  showRevenue: boolean;
  showCategory: boolean;
}

export const DEFAULT_CARD_FORMAT: CardFormat = {
  showImage: true,
  showName: true,
  showSku: true,
  showVolume: true,
  showRrp: true,
  showRevenue: false,
  showCategory: false,
};

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
