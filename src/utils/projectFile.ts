import type { Project, Product } from '../types';

// Range structure: everything except the catalogue data (volume, revenue etc)
// Keeps SKU references so it can be matched against a catalogue later
interface RangeStructure {
  type: 'range-structure';
  name: string;
  currentShelf: Project['currentShelf'];
  futureShelf: Project['futureShelf'];
  sankeyLinks: Project['sankeyLinks'];
  // Snapshot of product basics for display when no catalogue is loaded
  productSnapshots: { id: string; sku: string; name: string; volume: number; revenue: number; rrp: number }[];
}

export function saveProject(project: Project): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/\s+/g, '_')}_project.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function saveRangeStructure(project: Project): void {
  // Create lightweight snapshots of products used in shelves
  const usedProductIds = new Set([
    ...project.currentShelf.items.map((i) => i.productId),
    ...project.futureShelf.items.map((i) => i.productId),
  ].filter(Boolean));

  const productSnapshots = project.catalogue
    .filter((p) => usedProductIds.has(p.id))
    .map((p) => ({ id: p.id, sku: p.sku, name: p.name, volume: p.volume, revenue: p.revenue, rrp: p.rrp }));

  const structure: RangeStructure = {
    type: 'range-structure',
    name: project.name,
    currentShelf: project.currentShelf,
    futureShelf: project.futureShelf,
    sankeyLinks: project.sankeyLinks,
    productSnapshots,
  };

  const json = JSON.stringify(structure, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/\s+/g, '_')}_range_structure.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadProjectFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target!.result as string);

        // Check if this is a range structure file
        if (data.type === 'range-structure') {
          const structure = data as RangeStructure;
          // Convert snapshots to minimal Product objects
          const catalogue: Product[] = structure.productSnapshots.map((s) => ({
            id: s.id,
            sku: s.sku,
            name: s.name,
            category: '',
            subCategory: '',
            function: '',
            productFamily: '',
            volume: s.volume,
            rrp: s.rrp,
            revenue: s.revenue,
          }));

          const project: Project = {
            name: structure.name,
            currentShelf: structure.currentShelf,
            futureShelf: structure.futureShelf,
            sankeyLinks: structure.sankeyLinks,
            catalogue,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          resolve(project);
        } else {
          resolve(data as Project);
        }
      } catch {
        reject(new Error('Invalid project file'));
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
