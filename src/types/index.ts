// Future pricing — supports multiple time horizons via the keyed object
export interface FuturePricing {
  ukRrp?: number;
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
}

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
  rrp: number;        // UK RRP
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
  revenue: number;
  imageUrl?: string;
  source?: 'live' | 'dev';
  // Keyed by horizon — 'default' for the immediate next future range.
  // Future-proofed for multiple horizons (e.g. 'h1-2026', 'h2-2026').
  futurePricing?: { [horizon: string]: FuturePricing };
  // Extensible for future attributes
  [key: string]: unknown;
}

// Data carried by a placeholder shelf item — mirrors Product fields
export interface PlaceholderData {
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  function: string;
  productFamily: string;
  volume: number;
  rrp: number;
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
  revenue: number;
  imageUrl?: string;
  source: 'live' | 'dev';
}

// A product placed on a shelf, with position info
export interface ShelfItem {
  id: string; // unique placement id
  productId: string;
  position: number;
  isPlaceholder: boolean;
  placeholderName?: string;          // legacy: simple text-only placeholder
  placeholderData?: PlaceholderData; // full data for new placeholders
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

// A range variant — a filtered subset of the Master range
export interface RangeVariant {
  id: string;
  name: string;
  includedCurrentItemIds: string[]; // references ShelfItem.id in currentShelf
  includedFutureItemIds: string[];  // references ShelfItem.id in futureShelf
}

// A single range plan (current + future + sankey links + variants)
export interface RangePlan {
  id: string;
  name: string;
  currentShelf: Shelf;
  futureShelf: Shelf;
  sankeyLinks: SankeyLink[];
  variants: RangeVariant[];
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
  return project.plans.find((p) => p.id === project.activePlanId) || project.plans[0];
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
    variants: [],
  };
}

// Card display format options
export interface CardFormat {
  showImage: boolean;
  showName: boolean;
  showSku: boolean;
  showVolume: boolean;
  showRrp: boolean;       // UK
  showUsRrp: boolean;
  showEuRrp: boolean;
  showAusRrp: boolean;
  showRevenue: boolean;
  showCategory: boolean;
}

export const DEFAULT_CARD_FORMAT: CardFormat = {
  showImage: true,
  showName: true,
  showSku: true,
  showVolume: true,
  showRrp: true,
  showUsRrp: false,
  showEuRrp: false,
  showAusRrp: false,
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
  usRrp: string;
  euRrp: string;
  ausRrp: string;
  revenue: string;
  imageUrl: string;
  source: string;
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
  usRrp: 'US RRP',
  euRrp: 'EU RRP',
  ausRrp: 'AUS RRP',
  revenue: 'Revenue',
  imageUrl: 'Image URL',
  source: 'Source',
};
