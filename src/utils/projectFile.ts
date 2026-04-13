import type { Project, Product } from '../types';

// File System Access API types — not yet in all TS lib targets so we
// declare the minimum shape we care about and feature-detect at runtime.
interface FsFileHandle {
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}
interface FsSaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}
interface FsSaveFileWindow extends Window {
  showSaveFilePicker?: (options?: FsSaveFilePickerOptions) => Promise<FsFileHandle>;
}

/**
 * Save JSON to disk. Uses the File System Access API's native save dialog
 * where supported (Chrome/Edge on desktop) so the user picks the folder.
 * Falls back to a download anchor on other browsers (Firefox, Safari).
 *
 * Returns true if the file was saved, false if the user cancelled.
 */
async function saveJsonFile(content: string, suggestedName: string): Promise<boolean> {
  const w = window as unknown as FsSaveFileWindow;
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'JSON file',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (err) {
      // AbortError = user cancelled the picker — that's fine, don't fall back.
      if (err instanceof Error && err.name === 'AbortError') return false;
      // Any other failure (e.g. security error in a sandboxed iframe) falls
      // through to the download path below so the user still gets the file.
      console.warn('showSaveFilePicker failed, falling back to download', err);
    }
  }

  // Fallback: traditional download-anchor pattern.
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function saveProject(project: Project): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  const suggestedName = `${project.name.replace(/\s+/g, '_')}_project.json`;
  await saveJsonFile(json, suggestedName);
}

export async function saveRangeStructure(project: Project): Promise<void> {
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
    folders: project.folders,
    productSnapshots,
  };

  const json = JSON.stringify(structure, null, 2);
  const suggestedName = `${project.name.replace(/\s+/g, '_')}_range_structure.json`;
  await saveJsonFile(json, suggestedName);
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
            category: '', subCategory: '', productFamily: '',
            volume: s.volume as number,
            forecastVolume: (s.forecastVolume as number | undefined) ?? 0,
            rrp: s.rrp as number, revenue: s.revenue as number,
          }));
          resolve({
            name: data.name,
            plans: data.plans || [],
            activePlanId: data.activePlanId || data.plans?.[0]?.id || '',
            folders: data.folders,
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
