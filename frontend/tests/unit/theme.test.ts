import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectorColour, hexNumber, OVERLAY } from '../../src/core/overlayColours';

const css = readFileSync(new URL('../../src/app.css', import.meta.url), 'utf8');
/** The light-theme block (the first :root). */
const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
const token = (name: string) => light.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme', () => {
  it('the overlay colours in TS equal the --ov-* tokens in app.css', () => {
    for (const [name, hex] of Object.entries(OVERLAY)) expect(token(`ov-${name}`)).toBe(hex);
  });

  it('the accent is burgundy, not strFac_app indigo', () => {
    expect(token('accent')).toBe('#8c2438');
    expect(css).not.toMatch(/#5b5bd6|#4f46e5/i);
  });

  it('white text is readable on the accent and on both gradient stops (WCAG AA, 4.5:1)', () => {
    for (const name of ['accent', 'accent-grad-a', 'accent-grad-b'])
      expect(contrast(token(name)!, '#ffffff')).toBeGreaterThan(4.5);
  });

  it('overlay colours stand out on the white viewer (3:1 for graphics)', () => {
    for (const hex of Object.values(OVERLAY)) expect(contrast(hex, '#ffffff')).toBeGreaterThan(3);
  });

  it('detectors get their own colours', () => {
    expect(detectorColour('HAADF')).toBe(OVERLAY.haadf);
    expect(detectorColour('bf')).toBe(OVERLAY.bf);
    expect(detectorColour('segment 3')).toBe(OVERLAY.adf);
    expect(hexNumber('#2563eb')).toBe(0x2563eb);
  });
});
