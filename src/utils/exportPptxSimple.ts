// Simplified PowerPoint export — captures the canvas as a full-page
// screenshot via html2canvas and places it on a 16:9 slide. No
// card-by-card rendering, no shape building — just a pixel-perfect
// image of what the user sees on screen.

import html2canvas from 'html2canvas';
import PptxGenJS from 'pptxgenjs';
import { useProjectStore } from '../store/useProjectStore';
import type { Project } from '../types';
import { getStages } from '../types';

const SLIDE_W = 13.333; // 16:9 at 96dpi
const SLIDE_H = 7.5;

async function captureElement(selector: string): Promise<string | null> {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;

  // Temporarily remove CSS transforms (zoom/scale) that confuse
  // html2canvas, then restore after capture.
  const ancestors: Array<{ el: HTMLElement; transform: string }> = [];
  let parent = el.closest('.slide-canvas-wrapper') as HTMLElement | null;
  if (!parent) parent = el;
  // Walk up and strip transforms
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
      scale: 2,
      useCORS: true,
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('html2canvas capture failed:', err);
    return null;
  } finally {
    // Restore transforms
    for (const a of ancestors) a.el.style.transform = a.transform;
  }
}

export interface ExportOptions {
  includeRange: boolean;
  includeTransform: boolean;
  planIds: string[];
}

export async function exportToPptx(
  project: Project,
  options: ExportOptions,
  onProgress?: (msg: string) => void,
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
    for (const planId of options.planIds) {
      const plan = project.plans.find((p) => p.id === planId);
      if (!plan) continue;
      store.setActivePlan(planId);

      const stages = getStages(plan, project);

      if (options.includeRange) {
        for (const stage of stages) {
          onProgress?.(`Capturing ${plan.name} — ${stage.name} (Range)…`);
          store.setActiveView('range-design');
          store.setDesignShelfId(stage.key);
          // Wait for React to render + layout to settle
          await waitForRender();
          const dataUrl = await captureElement('.matrix-16-9');
          if (dataUrl) {
            const slide = pptx.addSlide();
            slide.addImage({ data: dataUrl, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, sizing: { type: 'contain', w: SLIDE_W, h: SLIDE_H } });
            slide.addText(`${plan.name} — ${stage.name}`, { x: 0.2, y: 0.1, fontSize: 10, color: '888888' });
          }
        }
      }

      if (options.includeTransform) {
        // Capture transform view for each adjacent stage pair
        for (let i = 0; i < stages.length - 1; i++) {
          const from = stages[i];
          const to = stages[i + 1];
          onProgress?.(`Capturing ${plan.name} — ${from.name} → ${to.name} (Transform)…`);
          store.setActiveView('transform');
          store.setTransformStages(from.key, to.key);
          await waitForRender();
          const dataUrl = await captureElement('.transform-16-9');
          if (dataUrl) {
            const slide = pptx.addSlide();
            slide.addImage({ data: dataUrl, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, sizing: { type: 'contain', w: SLIDE_W, h: SLIDE_H } });
            slide.addText(`${plan.name} — ${from.name} → ${to.name}`, { x: 0.2, y: 0.1, fontSize: 10, color: '888888' });
          }
        }
      }
    }
  } finally {
    // Restore original state
    store.setActivePlan(originalActivePlan);
    store.setActiveView(originalActiveView);
    store.setDesignShelfId(originalDesignShelfId);
    store.setTransformStages(originalTransformFrom, originalTransformTo);
  }

  onProgress?.('Writing PowerPoint file…');
  const fileName = `${project.name.replace(/\s+/g, '_')}_export.pptx`;
  await pptx.writeFile({ fileName });
  onProgress?.(null as unknown as string);
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 120);
      });
    });
  });
}
