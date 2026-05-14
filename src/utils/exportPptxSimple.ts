// Simplified PowerPoint export — captures the canvas as a full-page
// screenshot via html2canvas and places it on a 16:9 slide.

import html2canvas from 'html2canvas';
import PptxGenJS from 'pptxgenjs';
import { useProjectStore } from '../store/useProjectStore';
import type { Project } from '../types';
import { getStages } from '../types';

const SLIDE_W = 13.333; // 16:9 at 96dpi
const SLIDE_H = 7.5;
// Scale 4 ≈ 3840×2160 for a 960px-wide canvas — matches 4K/UHD.
const CAPTURE_SCALE = 4;

async function captureElement(selector: string): Promise<string | null> {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;

  // Temporarily remove CSS transforms (zoom/scale) that confuse
  // html2canvas, then restore after capture.
  const ancestors: Array<{ el: HTMLElement; transform: string }> = [];
  let parent = el.closest('.slide-canvas-wrapper') as HTMLElement | null;
  if (!parent) parent = el;
  let walk: HTMLElement | null = parent;
  while (walk && walk !== document.body) {
    const t = walk.style.transform;
    if (t) {
      ancestors.push({ el: walk, transform: t });
      walk.style.transform = 'none';
    }
    walk = walk.parentElement;
  }

  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: CAPTURE_SCALE,
      useCORS: true,
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('html2canvas capture failed:', err);
    return null;
  } finally {
    for (const a of ancestors) a.el.style.transform = a.transform;
  }
}

export interface PlanExportConfig {
  planId: string;
  includeRange: boolean;
  includeTransform: boolean;
  /** Which stage keys to export in range view. */
  rangeStageKeys: string[];
  /** Transform from/to stage keys. */
  transformFromKey: string;
  transformToKey: string;
}

export async function exportToPptx(
  project: Project,
  configs: PlanExportConfig[],
  onProgress?: (msg: string | null) => void,
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'WIDE';

  const store = useProjectStore.getState();
  const originalActiveView = store.activeView;
  const originalActivePlan = project.activePlanId;
  const originalDesignShelfId = store.designShelfId;
  const originalTransformFrom = store.transformFromKey;
  const originalTransformTo = store.transformToKey;

  try {
    for (const config of configs) {
      const plan = project.plans.find((p) => p.id === config.planId);
      if (!plan) continue;
      store.setActivePlan(config.planId);

      const stages = getStages(plan, project);

      // Range view slides — one per selected stage
      if (config.includeRange) {
        for (const stageKey of config.rangeStageKeys) {
          const stage = stages.find((s) => s.key === stageKey);
          if (!stage) continue;
          onProgress?.(`Capturing ${plan.name} — ${stage.name} (Range)…`);
          store.setActiveView('range-design');
          store.setDesignShelfId(stage.key);
          await waitForRender();
          const dataUrl = await captureElement('.matrix-16-9');
          if (dataUrl) {
            const slide = pptx.addSlide();
            slide.addImage({
              data: dataUrl, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
              sizing: { type: 'contain', w: SLIDE_W, h: SLIDE_H },
            });
            slide.addText(`${plan.name} — ${stage.name}`, {
              x: 0.2, y: 0.1, fontSize: 10, color: '888888',
            });
          }
        }
      }

      // Transform view slide — single capture for the selected from→to
      if (config.includeTransform) {
        const from = stages.find((s) => s.key === config.transformFromKey);
        const to = stages.find((s) => s.key === config.transformToKey);
        if (from && to) {
          onProgress?.(`Capturing ${plan.name} — ${from.name} → ${to.name} (Transform)…`);
          store.setActiveView('transform');
          store.setTransformStages(from.key, to.key);
          await waitForRender();
          const dataUrl = await captureElement('.transform-16-9');
          if (dataUrl) {
            const slide = pptx.addSlide();
            slide.addImage({
              data: dataUrl, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
              sizing: { type: 'contain', w: SLIDE_W, h: SLIDE_H },
            });
            slide.addText(`${plan.name} — ${from.name} → ${to.name}`, {
              x: 0.2, y: 0.1, fontSize: 10, color: '888888',
            });
          }
        }
      }
    }
  } finally {
    store.setActivePlan(originalActivePlan);
    store.setActiveView(originalActiveView);
    store.setDesignShelfId(originalDesignShelfId);
    store.setTransformStages(originalTransformFrom, originalTransformTo);
  }

  onProgress?.('Writing PowerPoint file…');
  const fileName = `${project.name.replace(/\s+/g, '_')}_export.pptx`;
  await pptx.writeFile({ fileName });
  onProgress?.(null);
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 150);
      });
    });
  });
}
