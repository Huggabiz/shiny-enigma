import type { Product } from '../types';
import { useProjectStore } from '../store/useProjectStore';

export interface AnonDisplay {
  name: string;
  imageUrl: string | undefined;
}

const indexCache = new Map<string, number>();
let lastCatalogueRef: Product[] | null = null;

function getDevIndex(product: Product, catalogue: Product[]): number {
  if (catalogue !== lastCatalogueRef) {
    indexCache.clear();
    lastCatalogueRef = catalogue;
    let idx = 1;
    for (const p of catalogue) {
      if (p.source === 'dev') {
        indexCache.set(p.id, idx++);
      }
    }
  }
  return indexCache.get(product.id) ?? 0;
}

export function shouldAnonymise(): boolean {
  const { project, isUnlocked } = useProjectStore.getState();
  return !!project?.lockHash && !isUnlocked && !!project.anonymiseDev;
}

export function anonDisplay(product: Product, catalogue: Product[]): AnonDisplay {
  if (product.source !== 'dev' || !shouldAnonymise()) {
    return { name: product.name, imageUrl: product.imageUrl };
  }
  const idx = getDevIndex(product, catalogue);
  return {
    name: `Dev Product ${String(idx).padStart(3, '0')}`,
    imageUrl: undefined,
  };
}
