// Overlay colours of the views (context.md §7.MU "Design tokens"), for canvas and WebGL drawing.
// They mirror the --ov-* custom properties in app.css (a unit test keeps the two equal) and are
// independent of the burgundy accent, so a detector never reads as an error or a selection.
export const OVERLAY = {
  fov: '#2563eb',
  grid: '#6b7280',
  probe: '#d97706',
  bf: '#16a34a',
  abf: '#0d9488',
  adf: '#7c3aed',
  haadf: '#ea580c',
  limit: '#6b7280',
} as const;

export type OverlayName = keyof typeof OVERLAY;

/** A detector's colour by its name (BF, ABF, ADF, HAADF); other names get the ADF colour. */
export function detectorColour(name: string): string {
  const key = name.toLowerCase();
  return key === 'bf' || key === 'abf' || key === 'haadf' ? OVERLAY[key] : OVERLAY.adf;
}

/** '#rrggbb' as a number for three.js. */
export const hexNumber = (hex: string): number => parseInt(hex.slice(1), 16);
