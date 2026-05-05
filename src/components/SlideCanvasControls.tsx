import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan } from '../types';

interface SlideCanvasControlsProps {
  /** CSS selector for the scroll area whose size drives fit-to-width. */
  scrollAreaSelector?: string;
}

const SLIDE_LOGICAL_WIDTH = 1100;
const SLIDE_LOGICAL_HEIGHT = 619;

/**
 * Fit the slide so the entire canvas is visible without scrolling on
 * either axis. Picks the tighter of width-fit and height-fit so
 * ultra-wide or ultra-tall viewports don't push one dimension off-
 * screen. Called by the toolbar button AND by App.tsx effects whenever
 * the active view or resolution tier changes.
 */
export function fitSlideToWidth(scrollAreaSelector: string): void {
  const el = document.querySelector(scrollAreaSelector) as HTMLElement | null;
  if (!el) return;
  const padding = 40;
  const availW = el.clientWidth - padding;
  const availH = el.clientHeight - padding;
  const scale = useProjectStore.getState().slideBaseScale;
  const canvasWidth = SLIDE_LOGICAL_WIDTH * scale;
  const canvasHeight = SLIDE_LOGICAL_HEIGHT * scale;
  if (canvasWidth <= 0 || canvasHeight <= 0 || availW <= 0 || availH <= 0) return;
  const zoomW = availW / canvasWidth;
  const zoomH = availH / canvasHeight;
  const zoom = Math.max(0.3, Math.min(3, Math.min(zoomW, zoomH)));
  useProjectStore.getState().setSlideZoom(zoom);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    });
  });
}

/**
 * Toolbar controls for the slide canvas — lets the user override the
 * auto-computed resolution tier, nudge the zoom up / down, fit the slide
 * to the viewport width, and reset zoom.
 */
export function SlideCanvasControls({ scrollAreaSelector }: SlideCanvasControlsProps) {
  const {
    slideBaseScale, slideBaseScaleMode,
    slideZoom, setSlideZoom,
    project, activeView, setPlanSlideSize,
  } = useProjectStore();

  // Settings are persisted per plan + view. Transform view writes to
  // plan.slideSettings.transform; current/future range share
  // plan.slideSettings.range.
  const activePlan = project ? getActivePlan(project) : undefined;
  const viewKey: 'transform' | 'range' = activeView === 'transform' ? 'transform' : 'range';

  const onResolutionChange = (value: string) => {
    if (!activePlan) return;
    if (value === 'auto') {
      setPlanSlideSize(activePlan.id, viewKey, { mode: 'auto' });
    } else {
      setPlanSlideSize(activePlan.id, viewKey, { mode: 'manual', scale: Number(value) });
    }
  };

  const resolutionValue = slideBaseScaleMode === 'auto' ? 'auto' : String(slideBaseScale);

  const fitToWidth = () => {
    if (!scrollAreaSelector) return;
    fitSlideToWidth(scrollAreaSelector);
  };

  return (
    <>
      <div className="slide-size-control" title="Slide resolution — bigger canvas fits more cards without shrinking">
        <span>Size</span>
        <select value={resolutionValue} onChange={(e) => onResolutionChange(e.target.value)}>
          <option value="auto">{`Auto (${slideBaseScale}\u00D7)`}</option>
          <option value="1">{'1\u00D7'}</option>
          <option value="1.25">{'1.25\u00D7'}</option>
          <option value="1.5">{'1.5\u00D7'}</option>
          <option value="1.75">{'1.75\u00D7'}</option>
          <option value="2">{'2\u00D7'}</option>
          <option value="2.5">{'2.5\u00D7'}</option>
          <option value="3">{'3\u00D7'}</option>
        </select>
      </div>
      <div className="slide-zoom-control" title="Zoom the slide in or out (Ctrl + scroll at the cursor also works)">
        <button type="button" onClick={() => setSlideZoom(slideZoom - 0.1)} aria-label="Zoom out">{'\u2212'}</button>
        <span className="zoom-value">{Math.round(slideZoom * 100)}%</span>
        <button type="button" onClick={() => setSlideZoom(slideZoom + 0.1)} aria-label="Zoom in">+</button>
        {scrollAreaSelector && (
          <button
            type="button"
            onClick={fitToWidth}
            aria-label="Fit to width"
            title="Fit slide to viewport width"
            style={{ fontSize: 10 }}
          >
            {'\u2194'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSlideZoom(1)}
          aria-label="Reset zoom"
          title="Reset zoom to 100%"
          style={{ fontSize: 10 }}
        >
          {'\u21BB'}
        </button>
      </div>
    </>
  );
}
