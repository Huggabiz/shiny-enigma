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
  percent: number;
  volume: number;
  type: 'transfer' | 'growth' | 'loss';
}

// A single range plan (current + future + sankey links)
export interface RangePlan {
  id: string;
  name: string;
  currentShelf: Shelf;
  futureShelf: Shelf;
  sankeyLinks: SankeyLink[];
}

// The full project state — now holds multiple range plans
export interface Project {
  name: string;
  plans: RangePlan[];
  activePlanId: string;
  catalogue: Product[];
  createdAt: string;
  updatedAt: string;
}

// Helper to get the active plan from a project
export function getActivePlan(project: Project): RangePlan | undefined {
  return project.plans.find((p) => p.id === project.activePlanId);
}

export const DEFAULT_MATRIX_LAYOUT: MatrixLayout = {
  title: '',
  xLabels: ['Entry', 'Mid', 'Premium'],
  yLabels: ['Subset 1', 'Subset 2'],
  assignments: [],
};

export function createEmptyPlan(name: string): RangePlan {
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    currentShelf: {
      id: 'current',
      name: 'Current Range',
      items: [],
      labels: [],
      matrixLayout: { ...DEFAULT_MATRIX_LAYOUT, title: name },
    },
    futureShelf: {
      id: 'future',
      name: 'Future Range',
      items: [],
      labels: [],
      matrixLayout: { ...DEFAULT_MATRIX_LAYOUT, title: name },
    },
    sankeyLinks: [],
  };
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
