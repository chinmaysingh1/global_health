// Measures the design tokens in src/ui/styles.css against WCAG 2.2 AA: 4.5:1 for text,
// 3:1 for meaningful control and state graphics. Reads the real stylesheet, so a token change
// that breaks contrast fails here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'styles.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const tok: Record<string, string> = {};
for (const m of root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) tok[m[1]] = m[2];
const color = (v: string) => (v.startsWith('#') ? v : tok[v]);

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(color(a)), lum(color(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT: [string, string][] = [
  ['ink', 'pearl'], ['ink', 'surface'], ['ink', 'sunken'], ['ink', 'accent-soft'],
  ['ink-2', 'pearl'], ['ink-2', 'surface'], ['ink-2', 'sunken'], ['ink-2', 'pearl-2'],
  ['ink-3', 'surface'], ['ink-3', 'pearl'],
  ['accent', 'surface'], ['accent', 'pearl'], ['accent-press', 'accent-soft'], ['on-accent', 'accent'], ['#ffffff', 'accent-press'],
  ['emergency', 'emergency-bg'], ['urgent', 'urgent-bg'], ['soon', 'soon-bg'], ['refer', 'refer-bg'], ['switch', 'switch-bg'], ['ok', 'ok-bg'], ['attn', 'attn-bg'],
  ['emergency', 'surface'], ['ok', 'pearl'],
  ['#ffffff', 'emergency'], ['#ffffff', 'urgent'], ['#ffffff', 'soon'], ['#ffffff', 'refer'], ['#ffffff', 'switch'],
  ['ink', 'emergency-bg'], ['ink', 'attn-bg'], ['ink', 'ok-bg'], ['ink', 'refer-bg'],
  ['#ffffff', 'ink'], ['#d9dae0', 'ink'], // summary status head
];
const NON_TEXT: [string, string][] = [
  ['line-strong', 'surface'], ['line-strong', 'pearl'], // control borders, radio rings
  ['accent', 'surface'], ['accent', 'pearl'], ['accent', 'accent-soft'], // focus ring, selected state
  ['focus', 'pearl'], ['focus', 'surface'],
  ['ok', 'pearl'], ['attn', 'pearl'], ['emergency', 'pearl'], // stepper and status dots
  ['emergency', 'surface'], ['urgent', 'surface'], ['soon', 'surface'], ['refer', 'surface'], ['switch', 'surface'], // alert borders
];

describe('colour contrast of the design tokens (WCAG AA)', () => {
  it('found the tokens', () => {
    for (const k of ['ink', 'pearl', 'surface', 'accent', 'emergency', 'line-strong']) expect(tok[k], k).toMatch(/^#/);
  });
  it.each(TEXT)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT)('control/state graphic %s against %s is at least 3:1', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
