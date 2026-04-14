// Future pricing — supports multiple time horizons via the keyed object
export interface FuturePricing {
  ukRrp?: number;
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
}

export type SapCollection = 'Core' | 'Duo';

// Core product type matching the data schema
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  productFamily: string;
  sapCollection?: SapCollection;  // "Collection" column from the SAP export
  volume: number;           // last year's volume (actual)
  forecastVolume?: number;  // next year's volume (forecast)
  rrp: number;              // UK RRP
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
  revenue: number;          // last year's revenue (actual)
  forecastRevenue?: number; // next year's revenue (forecast)
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
  productFamily: string;
  sapCollection?: SapCollection;
  volume: number;
  forecastVolume?: number;
  rrp: number;
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
  revenue: number;
  forecastRevenue?: number;
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
  /** Optional card-format override — if set, used instead of the
   * parent plan's format (or the global default) when this variant is
   * active. Lets e.g. a "US" variant show USD instead of GBP. */
  cardFormat?: Partial<CardFormat>;
}

// Per-view slide canvas size settings. 'auto' picks a tier from the
// number of items on the relevant shelf(s); 'manual' uses the explicit
// scale the user selected.
export interface SlideViewSize {
  scale: number;              // 1, 1.25, 1.5, 1.75, 2, 2.5, 3
  mode: 'auto' | 'manual';
}

export interface PlanSlideSettings {
  transform?: SlideViewSize;  // used by the transform view
  range?: SlideViewSize;      // shared by current + future range matrix views
}

// A single range plan (current + future + sankey links + variants)
export interface RangePlan {
  id: string;
  name: string;
  currentShelf: Shelf;
  futureShelf: Shelf;
  sankeyLinks: SankeyLink[];
  variants: RangeVariant[];
  slideSettings?: PlanSlideSettings;
  /** Optional card-format override for this plan. Variants within the
   * plan can further override by setting their own cardFormat. */
  cardFormat?: Partial<CardFormat>;
  /** Optional folder membership — plans without a folderId live in the
   * top-level "Unfiled" bucket. Folders are user-defined via PlanTree. */
  folderId?: string;
}

/** A user-defined folder in the plans tree. Pure organisational
 * construct — has no effect on plan data or behaviour beyond grouping
 * in the PlanTree UI. */
export interface PlanFolder {
  id: string;
  name: string;
  /** Order within the folder list. Lower numbers render first. */
  order: number;
}

/** A "Lens" is a tag-like view filter over the catalogue. When a lens
 * is active, every product card in that lens gets a tint of the lens's
 * colour. Built-in 'dev' lens has implicit membership (any product
 * with `source === 'dev'`); custom lenses store explicit `productIds`.
 * The user toggles membership by enabling Edit mode on a lens and
 * clicking SKU cards. */
export interface Lens {
  id: string;
  name: string;
  /** Hex colour used for both the swatch and the card-background tint. */
  color: string;
  /** Catalogue product IDs in this lens. Ignored for the built-in 'dev'
   * lens — its membership is implicit (any catalogue product whose
   * `source === 'dev'`). */
  productIds: string[];
  /** Identifies a built-in lens. Built-ins can't be deleted or renamed
   * and may have implicit membership rules. */
  builtInKind?: 'dev';
}

/** Default Dev lens — auto-added on project load if missing. The blue
 * matches the existing `.matrix-card.dev-product` background. */
export const DEFAULT_DEV_LENS: Lens = {
  id: 'lens-dev',
  name: 'Dev',
  color: '#1565c0',
  productIds: [],
  builtInKind: 'dev',
};

/** Auto-assigned colour palette for new lenses. Rotates through these
 * by `lenses.length % palette.length`, skipping the dev blue. */
export const LENS_PALETTE: string[] = [
  '#7b1fa2', // purple
  '#388e3c', // green
  '#f57c00', // orange
  '#c62828', // red
  '#0097a7', // teal
  '#6a1b9a', // deep purple
  '#5d4037', // brown
  '#455a64', // blue grey
  '#827717', // dark olive
  '#bf360c', // deep orange
];

/** True if a product is "in" a lens. Built-in 'dev' uses implicit
 * membership; custom lenses use explicit productIds. */
export function isProductInLens(lens: Lens, product: Pick<Product, 'id' | 'source'>): boolean {
  if (lens.builtInKind === 'dev') return product.source === 'dev';
  return lens.productIds.includes(product.id);
}

// The full project state — now holds multiple range plans
export interface Project {
  name: string;
  plans: RangePlan[];
  activePlanId: string;
  catalogue: Product[];
  /** User-defined folders for organising plans. Optional so older
   * projects saved without this field still load cleanly. */
  folders?: PlanFolder[];
  /** Catalogue lenses — see Lens type. Optional for backwards-compat;
   * the loader migration ensures the built-in Dev lens is always
   * present at index 0 after load. */
  lenses?: Lens[];
  /** Currently active lens ID (null = no lens applied → cards render
   * with no tint). Project-level so the active lens persists across
   * plan switches. */
  activeLensId?: string | null;
  /** Lens currently in "edit mode" — clicking a SKU card toggles its
   * membership in this lens. Null = no edit mode. Only one lens can be
   * editable at a time. Built-in 'dev' lens can never be in edit mode
   * (implicit membership). */
  editingLensId?: string | null;
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
  showForecastVolume: boolean;
  showRrp: boolean;       // UK
  showUsRrp: boolean;
  showEuRrp: boolean;
  showAusRrp: boolean;
  showRevenue: boolean;
  showForecastRevenue: boolean;
  showCategory: boolean;
}

export const DEFAULT_CARD_FORMAT: CardFormat = {
  showImage: true,
  showName: true,
  showSku: true,
  showVolume: true,
  showForecastVolume: true,
  showRrp: true,
  showUsRrp: false,
  showEuRrp: false,
  showAusRrp: false,
  showRevenue: false,
  showForecastRevenue: false,
  showCategory: false,
};

// Column mapping for import flexibility
export interface ColumnMapping {
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  productFamily: string;
  sapCollection: string;
  volume: string;
  forecastVolume: string;
  rrp: string;
  usRrp: string;
  euRrp: string;
  ausRrp: string;
  revenue: string;
  forecastRevenue: string;
  imageUrl: string;
  source: string;
}

export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  sku: 'SKU',
  name: 'Name',
  category: 'Category',
  subCategory: 'Sub-Category',
  productFamily: 'Product Family',
  sapCollection: 'SAP Collection',
  volume: 'Volume',
  forecastVolume: 'Forecast Volume',
  rrp: 'RRP',
  usRrp: 'US RRP',
  euRrp: 'EU RRP',
  ausRrp: 'AUS RRP',
  revenue: 'Revenue',
  forecastRevenue: 'Forecast Revenue',
  imageUrl: 'Image URL',
  source: 'Source',
};
