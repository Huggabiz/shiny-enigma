import type { Project, Product } from '../types';

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
  const usedProductIds = new Set<string>();
  for (const plan of project.plans) {
    for (const item of [...plan.currentShelf.items, ...plan.futureShelf.items]) {
      if (item.productId) usedProductIds.add(item.productId);
    }
  }

  const productSnapshots = project.catalogue
    .filter((p) => usedProductIds.has(p.id))
    .map((p) => ({ id: p.id, sku: p.sku, name: p.name, volume: p.volume, revenue: p.revenue, rrp: p.rrp }));

  const structure = {
    type: 'range-structure',
    name: project.name,
    plans: project.plans,
    activePlanId: project.activePlanId,
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

        if (data.type === 'range-structure') {
          const catalogue: Product[] = (data.productSnapshots || []).map((s: Record<string, unknown>) => ({
            id: s.id as string, sku: s.sku as string, name: s.name as string,
            category: '', subCategory: '', function: '', productFamily: '',
            volume: s.volume as number, rrp: s.rrp as number, revenue: s.revenue as number,
          }));
          resolve({
            name: data.name,
            plans: data.plans || [],
            activePlanId: data.activePlanId || data.plans?.[0]?.id || '',
            catalogue,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } else {
          // The store's loadProject handles migration from old format
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
