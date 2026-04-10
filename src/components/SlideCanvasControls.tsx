import { useProjectStore } from '../store/useProjectStore';

interface SlideCanvasControlsProps {
  /** CSS selector for the scroll area whose size drives fit-to-width. */
  scrollAreaSelector?: string;
}

const SLIDE_LOGICAL_WIDTH = 1100;

/**
 * Toolbar controls for the slide canvas — lets the user override the
 * auto-computed resolution tier, nudge the zoom up / down, fit the slide
 * to the viewport width, and reset zoom.
 */
export function SlideCanvasControls({ scrollAreaSelector }: SlideCanvasControlsProps) {
  const {
    slideBaseScale, slideBaseScaleMode, setSlideBaseScale, setSlideBaseScaleMode,
    slideZoom, setSlideZoom,
  } = useProjectStore();

  const onResolutionChange = (value: string) => {
    if (value === 'auto') {
      setSlideBaseScaleMode('auto');
    } else {
      setSlideBaseScaleMode('manual');
      setSlideBaseScale(Number(value));
    }
  };

  const resolutionValue = slideBaseScaleMode === 'auto' ? 'auto' : String(slideBaseScale);

  const fitToWidth = () => {
    if (!scrollAreaSelector) return;
    const el = document.querySelector(scrollAreaSelector) as HTMLElement | null;
    if (!el) return;
    const padding = 40; // breathing room inside the scroll area
    const avail = el.clientWidth - padding;
    const canvasWidth = SLIDE_LOGICAL_WIDTH * slideBaseScale;
    if (canvasWidth <= 0) return;
    const zoom = avail / canvasWidth;
    setSlideZoom(zoom);
    // Centre horizontally after the zoom reflows
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
      });
    });
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
