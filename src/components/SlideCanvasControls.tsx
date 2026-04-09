import { useProjectStore } from '../store/useProjectStore';

/**
 * Toolbar controls for the slide canvas — lets the user override the
 * auto-computed resolution tier and nudge the zoom up / down.
 */
export function SlideCanvasControls() {
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
      <div className="slide-zoom-control" title="Zoom the slide in or out (Ctrl + scroll also works)">
        <button type="button" onClick={() => setSlideZoom(slideZoom - 0.1)} aria-label="Zoom out">{'\u2212'}</button>
        <span className="zoom-value">{Math.round(slideZoom * 100)}%</span>
        <button type="button" onClick={() => setSlideZoom(slideZoom + 0.1)} aria-label="Zoom in">+</button>
        <button
          type="button"
          onClick={() => setSlideZoom(1)}
          aria-label="Reset zoom"
          title="Reset zoom"
          style={{ fontSize: 10 }}
        >
          {'\u21BB'}
        </button>
      </div>
    </>
  );
}
