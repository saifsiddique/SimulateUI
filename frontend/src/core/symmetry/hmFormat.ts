/**
 * Typesetting of Hermann-Mauguin symbols. The table stores them as plain text, 'P6_3/mmc',
 * 'Fd-3m', 'I4_1/amd'; printed, a screw axis has its translation as a subscript (6₃) and a
 * rotoinversion axis has a bar over the digit (3̄).
 */
export interface HmToken {
  text: string;
  /** Subscript after `text` (the screw component), e.g. '3' in 6_3. */
  sub?: string;
  /** Draw a bar over `text` (rotoinversion). */
  bar?: boolean;
  /** Letters (lattice, glide, mirror) are set in italic; digits and '/' upright. */
  italic: boolean;
}

export function hmTokens(symbol: string): HmToken[] {
  const out: HmToken[] = [];
  const s = symbol.replace(/\s+/g, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '-' && /\d/.test(s[i + 1] ?? '')) {
      out.push({ text: s[i + 1], bar: true, italic: false });
      i++;
    } else if (/\d/.test(ch) && s[i + 1] === '_' && /\d/.test(s[i + 2] ?? '')) {
      out.push({ text: ch, sub: s[i + 2], italic: false });
      i += 2;
    } else if (ch === ':') {
      // Origin or setting choice suffix (':2', ':H'): kept as plain text.
      out.push({ text: s.slice(i), italic: false });
      break;
    } else {
      out.push({ text: ch, italic: /[A-Za-z]/.test(ch) });
    }
  }
  return out;
}

/** Plain-text rendering with Unicode subscripts and combining overlines: 'P6₃/mmc', 'Fd3̄m'. */
export function hmUnicode(symbol: string): string {
  const subs = '₀₁₂₃₄₅₆₇₈₉';
  return hmTokens(symbol)
    .map((t) => (t.bar ? t.text + '̅' : t.text) + (t.sub ? subs[Number(t.sub)] : ''))
    .join('');
}
