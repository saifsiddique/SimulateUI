/**
 * CIF document structure: data blocks holding single items and loops (tables). This layer knows
 * nothing about crystallography; `structure.ts` maps a block to a crystal description.
 */
import { CifError } from '../errors';
import { tokenize, type CifWarning, type Token } from './tokenizer';

export type { CifWarning };

export interface CifValue {
  text: string;
  /** Written as a quoted string or text field (never the `?` / `.` placeholders). */
  quoted: boolean;
}

export interface CifLoop {
  /** Lower-cased tags, one per column. */
  tags: string[];
  rows: CifValue[][];
}

export interface CifBlock {
  name: string;
  /** Non-loop items, keyed by lower-cased tag. */
  items: Map<string, CifValue>;
  loops: CifLoop[];
  warnings: CifWarning[];
}

export interface CifDocument {
  blocks: CifBlock[];
  /** Warnings from before the first data block and from tokenizing. */
  warnings: CifWarning[];
}

/** Parse CIF text into data blocks. Never throws on malformed input; it reports warnings. */
export function parseCifDocument(input: string): CifDocument {
  const { tokens, warnings: tokenWarnings } = tokenize(input);
  const doc: CifDocument = { blocks: [], warnings: [...tokenWarnings] };
  let block: CifBlock | undefined;
  let skippingSave = false;
  const warn = (line: number, message: string) =>
    (block?.warnings ?? doc.warnings).push({ line, message });

  const asValue = (t: Token): CifValue => ({ text: t.text, quoted: t.quoted });
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'data') {
      block = { name: t.text, items: new Map(), loops: [], warnings: [] };
      doc.blocks.push(block);
      skippingSave = false;
      i++;
      continue;
    }
    if (t.kind === 'save') {
      // Dictionary save frames carry no structure data. `save_` alone closes a frame.
      skippingSave = t.text !== '';
      i++;
      continue;
    }
    if (skippingSave || t.kind === 'global' || t.kind === 'stop') {
      i++;
      continue;
    }
    if (!block) {
      if (t.kind !== 'value' || tokens[i - 1]?.kind !== 'tag')
        warn(t.line, 'Content before the first data_ block ignored.');
      i++;
      continue;
    }

    if (t.kind === 'loop') {
      i++;
      const tags: string[] = [];
      while (i < tokens.length && tokens[i].kind === 'tag') tags.push(tokens[i++].text);
      const cells: CifValue[] = [];
      while (i < tokens.length && tokens[i].kind === 'value') cells.push(asValue(tokens[i++]));
      if (tags.length === 0) {
        warn(t.line, 'loop_ without tags ignored.');
        continue;
      }
      const rows: CifValue[][] = [];
      const full = Math.floor(cells.length / tags.length);
      for (let r = 0; r < full; r++) rows.push(cells.slice(r * tags.length, (r + 1) * tags.length));
      if (cells.length % tags.length !== 0) {
        warn(
          t.line,
          `loop_ with ${tags.length} tags has ${cells.length} values; dropped the incomplete last row.`,
        );
      }
      block.loops.push({ tags, rows });
      continue;
    }

    if (t.kind === 'tag') {
      const next = tokens[i + 1];
      if (next?.kind === 'value') {
        if (block.items.has(t.text)) warn(t.line, `Duplicate item ${t.text}; kept the first.`);
        else block.items.set(t.text, asValue(next));
        i += 2;
      } else {
        warn(t.line, `Item ${t.text} has no value.`);
        i++;
      }
      continue;
    }

    // A value with no tag in front of it.
    warn(t.line, `Unexpected value "${t.text.slice(0, 30)}" ignored.`);
    i++;
  }
  return doc;
}

// ---- block access ------------------------------------------------------------------------------

/** A value that carries data: not missing, and not the `?` / `.` placeholders. */
export const isKnown = (v: CifValue | undefined): v is CifValue =>
  v !== undefined && (v.quoted || (v.text !== '?' && v.text !== '.'));

/** First of the alternative tags (current name first, deprecated names after) that has a value. */
export function item(block: CifBlock, ...tags: string[]): CifValue | undefined {
  for (const tag of tags) {
    const v = block.items.get(tag);
    if (isKnown(v)) return v;
  }
  return undefined;
}

/** The loop containing `tag`, or undefined. */
export const findLoop = (block: CifBlock, tag: string): CifLoop | undefined =>
  block.loops.find((l) => l.tags.includes(tag));

export function columnIndex(loop: CifLoop, ...tags: string[]): number {
  for (const tag of tags) {
    const idx = loop.tags.indexOf(tag);
    if (idx !== -1) return idx;
  }
  return -1;
}

// ---- numbers -----------------------------------------------------------------------------------

export interface Numeric {
  value: number;
  /** Standard uncertainty from `1.234(5)`, in the units of the value; 0 if absent. */
  su: number;
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:\((\d+)\))?$/;
const FRACTION = /^([+-]?\d+)\/(\d+)$/;

/**
 * Parse a CIF number with an optional uncertainty: `0.9344(13)` -> value 0.9344, su 0.0013.
 * Also accepts `1/3`. Returns undefined for `?`, `.`, and anything that is not a number.
 */
export function parseNumeric(v: CifValue | string | undefined): Numeric | undefined {
  const text = (typeof v === 'string' ? v : v?.text)?.trim();
  if (!text) return undefined;
  const m = NUMBER.exec(text);
  if (m) {
    const value = Number(m[1]) + 0; // + 0 turns -0 (as in "-0.000") into 0
    if (!Number.isFinite(value)) return undefined;
    let su = 0;
    if (m[2] !== undefined) {
      const mantissa = m[1].replace(/[eE].*$/, '');
      const dot = mantissa.indexOf('.');
      const decimals = dot === -1 ? 0 : mantissa.length - dot - 1;
      const exp = /[eE]([+-]?\d+)$/.exec(m[1]);
      su = Number(m[2]) * 10 ** (-decimals + (exp ? Number(exp[1]) : 0));
    }
    return { value, su };
  }
  const f = FRACTION.exec(text);
  if (f && Number(f[2]) !== 0) return { value: Number(f[1]) / Number(f[2]), su: 0 };
  return undefined;
}

/** Plain number of a value, ignoring uncertainty. */
export const num = (v: CifValue | string | undefined): number | undefined => parseNumeric(v)?.value;

/** Parse text, throwing `CifError` if it holds no data block at all. */
export function parseCifBlocks(input: string): CifDocument {
  const doc = parseCifDocument(input);
  if (doc.blocks.length === 0)
    throw new CifError('No data_ block found: this does not look like a CIF.');
  return doc;
}
