/**
 * Convert a `#rrggbb` hex colour to an `rgba(r, g, b, a)` string. Used
 * by MatrixProductCard / ProductCard / MultiplanView to derive a
 * translucent lens tint from the lens's solid colour without having to
 * store a separate tint value.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
