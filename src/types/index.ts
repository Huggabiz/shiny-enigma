// Future pricing — supports multiple time horizons via the keyed object
export interface FuturePricing {
  ukRrp?: number;
  usRrp?: number;
  euRrp?: number;
  ausRrp?: number;
}

export type SapCollection = 'Core' | 'Duo';

/** Per-warehouse volume breakdown. The five warehouses are:
 *   UK  — domestic UK warehouse
 *   EU  — European distribution
 *   AUS — Australia
 *   US  — United States
 *   CN  — China / distribution hub
 * All values are optional; the total `volume` on Product is the sum
 * of whichever warehouses are populated (or the legacy single-value
 * import when warehouse columns aren't present). */
export interface WarehouseVolumes {
  uk?: number;
  eu?: number;
  aus?: number;
  us?: number;
  cn?: number;
}

export const WAREHOUSE_KEYS = ['uk', 'eu', 'aus', 'us', 'cn'] as const;
export type WarehouseKey = typeof WAREHOUSE_KEYS[number];

export const WAREHOUSE_LABELS: Record<WarehouseKey, string> = {
  uk: 'UK',
  eu: 'EU',
  aus: 'AUS',
  us: 'US',
  cn: 'CN',
};

// Core product type matching the data schema
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  subCategory: string;
  productFamily: string;
  sapCollection?: SapCollection;  // "Collection" column from the SAP export
  volume: number;           // last year's volume (actual) — total across all warehouses
  /** Per-warehouse volume breakdown. When populated, `volume` is the
   * sum. When absent (legacy imports), `volume` is the single value
   * from the "Volume" column and no breakdown is available. */
  warehouseVolumes?: WarehouseVolumes;
  forecastVolume?: number;  // next year's volume (forecast) — legacy; tool builds its own now
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
  warehouseVolumes?: WarehouseVolumes;
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
  /** Set when this shelf item was appended via the "Append project"
   * import and its product SKU wasn't found in the master catalogue.
   * The card renders as "(Not in catalogue)" + the SKU until the
   * user loads a catalogue that contains this SKU, at which point
   * `setCatalogue` auto-relinks the item and clears `orphanSku`. */
  orphanSku?: string;
  /** Forecast adjustments for a future-shelf item. Only meaningful on
   * items in the future shelf — ignored on current-shelf items. The
   * forecast volume is derived from sankey inbound volume multiplied
   * by these factors + organic growth. See ForecastConfig. */
  forecastConfig?: ForecastConfig;
  /** Full forecast pipeline for this future-shelf item. See
   * ForecastPipeline type and utils/forecastCalc.ts. */
  forecastPipeline?: ForecastPipeline;
}

/** Per-item forecast adjustments applied ON TOP of the sankey-derived
 * base volume. All percentage fields default to 100 (= no effect).
 *
 * Forecast volume = base × (distribution/100) × (ramp/100) × (rrpEffect/100) + organicGrowth
 *
 * where `base = Σ(source.volume × link.percent / 100)` across all
 * inbound sankey links. */
export interface ForecastConfig {
  /** % of full channel/customer distribution. 60 = launching in 60%
   * of channels initially. Default 100 = full distribution. */
  distributionPct: number;
  /** % of steady-state volume expected in the first period due to
   * awareness ramp-up. 40 = expecting 40% of full-rate volume
   * while the product builds awareness. Default 100 = no ramp. */
  rampPct: number;
  /** Manual price-effect factor. 95 = expect 5% volume drop from a
   * price increase. Default 100 = no price effect. */
  rrpEffectPct: number;
  /** Absolute incremental units added AFTER the multiplicative
   * factors. Default 0 = no organic uplift. */
  organicGrowth: number;
}

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  distributionPct: 100,
  rampPct: 100,
  rrpEffectPct: 100,
  organicGrowth: 0,
};

// ---------------------------------------------------------------
// Forecast Lab pipeline model
//
// Each future-shelf item can have an optional ForecastPipeline that
// models the full forecast derivation as a left-to-right flow:
//
//   [References] → [Lane modifiers] → merge → [Product modifiers]
//                                             → [Post-launch modifiers]
//                                             → Clean forecast / Year 1 forecast
//
// References are either cannibalization sources (volume the new
// product takes from an existing SKU) or analog references (a
// benchmark product expected to perform similarly). Each reference
// feeds a "lane" with its own modifier chain. Lanes merge at the
// target product via a sum. Product-level modifiers then apply
// (e.g. "hero factor"), giving the clean/steady-state forecast.
// Post-launch modifiers (ramp, distribution limit) give the Year 1
// forecast. See computePipelineForecast() in utils/forecastCalc.ts.
// ---------------------------------------------------------------

export type ForecastModifierType =
  | 'volumeCorrection'
  | 'channelGrowth'
  | 'rrpSensitivity'
  | 'heroFactor'
  | 'takeRate'
  | 'ramp'
  | 'distribution';

export interface ForecastModifier {
  id: string;
  type: ForecastModifierType;
  label: string;
  /** The adjustment value — interpretation depends on the modifier
   * type but all standard types are multiplicative percentages.
   * 100 = no effect, 85 = −15%, 120 = +20%. */
  value: number;
  /** Which warehouse(s) this modifier applies to. 'all' means the
   * modifier multiplies the total volume (all warehouses equally).
   * A specific warehouse key means only that warehouse's volume is
   * modified. Default 'all'. */
  warehouseScope?: 'all' | WarehouseKey;
}

export interface ForecastReference {
  id: string;
  /** Catalogue product id for the reference product. */
  productId: string;
  type: 'cannibalization' | 'analog';
  /** % of the reference product's volume to use as the lane's
   * starting input. 30 = "take 30% of this product's volume". */
  takePercent: number;
}

export interface ForecastLane {
  /** Which ForecastReference this lane belongs to. */
  referenceId: string;
  /** Ordered chain of modifiers in this lane. Applied left-to-right
   * before the lane output merges into the target. */
  modifiers: ForecastModifier[];
}

export interface ForecastPipeline {
  references: ForecastReference[];
  lanes: ForecastLane[];
  /** Modifiers that apply to the merged volume AT the target product
   * (e.g. hero factor, category adjustment). Applied after the lane
   * merge to give the "clean forecast". */
  productModifiers: ForecastModifier[];
  /** Sequential post-launch modifiers (ramp, distribution). Applied
   * after the product modifiers to give the "Year 1 forecast". */
  postModifiers: ForecastModifier[];
}

/** Metadata for each standard modifier type — used by the UI to
 * populate the "add modifier" dropdown and show descriptions. */
export interface ModifierTypeDef {
  type: ForecastModifierType;
  label: string;
  description: string;
  defaultValue: number;
  /** Where this modifier type can be placed in the pipeline. */
  placement: Array<'lane' | 'product' | 'post'>;
}

export const MODIFIER_TYPE_DEFS: ModifierTypeDef[] = [
  { type: 'volumeCorrection', label: 'Volume Correction', description: 'Adjust for one-off events (e.g. a promo that won\'t repeat)', defaultValue: 100, placement: ['lane'] },
  { type: 'channelGrowth', label: 'Channel Growth', description: 'Expected growth from increased sales distribution', defaultValue: 100, placement: ['lane', 'product'] },
  { type: 'rrpSensitivity', label: 'RRP Sensitivity', description: 'Price effect on volume', defaultValue: 100, placement: ['lane', 'product'] },
  { type: 'takeRate', label: 'Take Rate', description: 'Additional % adjustment on the reference take', defaultValue: 100, placement: ['lane'] },
  { type: 'heroFactor', label: 'Hero / Category Factor', description: 'Product-level performance multiplier', defaultValue: 100, placement: ['product'] },
  { type: 'ramp', label: 'Launch Ramp', description: 'First-period volume as % of steady state', defaultValue: 40, placement: ['post'] },
  { type: 'distribution', label: 'Distribution Limit', description: '% of channels / customers launching in', defaultValue: 100, placement: ['post'] },
];

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

// A single range plan (current + future + optional intermediate shelves + sankey links + variants)
export interface RangePlan {
  id: string;
  name: string;
  currentShelf: Shelf;
  futureShelf: Shelf;
  /** Per-stage shelves for intermediate stages. Each entry references
   * a StageDefinition.id from Project.stageDefinitions. When a
   * project-level stage is created, every plan gets a shelf for it
   * seeded from the plan's current shelf + matrix layout. */
  intermediateShelves?: Array<{
    stageId: string;
    shelf: Shelf;
  }>;
  sankeyLinks: SankeyLink[];
  variants: RangeVariant[];
  slideSettings?: PlanSlideSettings;
  cardFormat?: Partial<CardFormat>;
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

/** A named stage in the project timeline. The definition is project-
 * level (shared across all plans); each plan stores its own Shelf
 * content for each stage via RangePlan.intermediateShelves. */
export interface StageDefinition {
  id: string;
  name: string;
}

/** A single row in the Multiplan view — one (plan, variant|master)
 * pair. `variantId === null` means the plan's master range. The user
 * can include both the master AND one or more variants of the same
 * plan in a single multiplan view, because the selection unit is a
 * plan+variant tuple, not just a plan. */
export interface MultiplanEntry {
  planId: string;
  /** null = master range */
  variantId: string | null;
}

/** Project-level state for the Multiplan view. The shelf side toggle
 * is global (one `Current | Future` switch applied to every row), and
 * `entries` is an ordered list of plan+variant tuples that each become
 * a stacked row in the view. */
export interface MultiplanViewState {
  /** Stage key: 'current', 'future', or 'stage-<defId>' for intermediates. */
  shelfSide: string;
  entries: MultiplanEntry[];
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
  /** Project-level stage timeline. Stages are shared across ALL plans
   * in the project — they represent the business timeline (SS26, AW26,
   * etc.), not plan-specific data. Each plan stores its own shelf for
   * each stage via `intermediateShelves`. */
  stageDefinitions?: StageDefinition[];
  /** Label for the "current" baseline stage, e.g. "SS26". */
  currentStageLabel?: string;
  /** Label for the "future" goal stage, e.g. "Goal Range". */
  futureStageLabel?: string;
  /** Per-SKU forecast pipelines. Keyed by SKU string so the pipeline
   * is global (not tied to a specific shelf placement) and survives
   * catalogue reimports. See ForecastPipeline. */
  forecastPipelines?: Record<string, ForecastPipeline>;
  /** SKU → default plan id mapping. Stored by SKU string (not product
   * id) so the mapping survives catalogue reimports. Auto-assigned
   * when a SKU is first added to any range plan; changeable by the
   * user via the SKU details pane. The forecast lab reads launch
   * timing from the default plan. */
  defaultPlanBySku?: Record<string, string>;
  /** Multiplan view state — which plan+variant pairs to show stacked,
   * and which side of the range (current / future) to render. Optional
   * for backwards-compat; the store action lazily initialises it. */
  multiplanView?: MultiplanViewState;
  createdAt: string;
  updatedAt: string;
}

// Helper to get the active plan from a project
export function getActivePlan(project: Project): RangePlan | undefined {
  return project.plans.find((p) => p.id === project.activePlanId) || project.plans[0];
}

/** A stage entry in the ordered stage list — uniform accessor for
 * current, intermediates, and future. `key` is the shelf accessor
 * key used by store actions: 'current', 'future', or 'stage-<id>'
 * for intermediates. */
export interface StageEntry {
  key: string;
  name: string;
  shelf: Shelf;
  position: 'current' | 'intermediate' | 'future';
}

/** Returns the ordered list of stages for a plan, using the project-
 * level stage definitions for names/order and the plan's shelves for
 * content: [current, ...intermediates, future]. */
export function getStages(plan: RangePlan, project: Project): StageEntry[] {
  const stages: StageEntry[] = [];
  const currentLabel = project.currentStageLabel;
  stages.push({
    key: 'current',
    name: currentLabel ? `${currentLabel} (Current)` : 'Current Range',
    shelf: plan.currentShelf,
    position: 'current',
  });
  for (const def of project.stageDefinitions ?? []) {
    const entry = (plan.intermediateShelves ?? []).find((s) => s.stageId === def.id);
    if (entry) {
      stages.push({
        key: `stage-${def.id}`,
        name: def.name,
        shelf: entry.shelf,
        position: 'intermediate',
      });
    }
  }
  stages.push({
    key: 'future',
    name: project.futureStageLabel || 'Future Range',
    shelf: plan.futureShelf,
    position: 'future',
  });
  return stages;
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
  volumeUk: string;
  volumeEu: string;
  volumeAus: string;
  volumeUs: string;
  volumeCn: string;
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
  volumeUk: 'Volume UK',
  volumeEu: 'Volume EU',
  volumeAus: 'Volume AUS',
  volumeUs: 'Volume US',
  volumeCn: 'Volume CN',
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
