/**
 * CIF 1.1 tokenizer (STAR syntax). Lenient by design: real files are messy, so recoverable
 * problems become warnings and tokenizing continues.
 *
 * Token kinds: `data` (data_NAME), `loop`, `save` (save_NAME / save_), `global`, `stop`, `tag`
 * (_name, lower-cased), and `value` (text plus whether it was quoted or a text field; only
 * unquoted `?` and `.` mean unknown / not applicable).
 *
 * CIF 1.1 rules implemented: `#` comments (only at the start of a token), '...' and "..." strings
 * that end at a matching quote followed by whitespace (so 'P6/mm'm'' is one string), `;` text
 * fields that start with `;` in column 0 and end at the next line starting with `;`, reserved
 * words in any case. CIF2 lists/tables/triple quotes are not supported.
 */

export type TokenKind = 'data' | 'loop' | 'save' | 'global' | 'stop' | 'tag' | 'value';

export interface Token {
  kind: TokenKind;
  /** Name for data/save, lower-cased tag for tag, content for value; empty for loop/global/stop. */
  text: string;
  /** value only: written as a quoted string or text field, so never the `?` / `.` placeholders. */
  quoted: boolean;
  line: number;
}

export interface CifWarning {
  line: number;
  message: string;
}

export interface Tokenized {
  tokens: Token[];
  warnings: CifWarning[];
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

export function tokenize(input: string): Tokenized {
  const tokens: Token[] = [];
  const warnings: CifWarning[] = [];
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const n = text.length;
  let i = 0;
  let line = 1;

  const push = (kind: TokenKind, value: string, quoted: boolean, at: number) =>
    tokens.push({ kind, text: value, quoted, line: at });

  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }

    const atLineStart = i === 0 || text[i - 1] === '\n';

    // Text field.
    if (c === ';' && atLineStart) {
      const startLine = line;
      let j = i + 1;
      let end = -1;
      for (;;) {
        const nl = text.indexOf('\n', j);
        if (nl === -1) break;
        if (text[nl + 1] === ';') {
          end = nl;
          break;
        }
        j = nl + 1;
      }
      let body: string;
      if (end === -1) {
        warnings.push({
          line: startLine,
          message: 'Unterminated ; text field; took the rest of the file.',
        });
        body = text.slice(i + 1);
        i = n;
      } else {
        body = text.slice(i + 1, end);
        i = end + 2;
      }
      for (const ch of body) if (ch === '\n') line++;
      line += end === -1 ? 0 : 1;
      push('value', body.replace(/\r$/, '').replace(/\r\n/g, '\n'), true, startLine);
      continue;
    }

    // Quoted string.
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '\n') {
        if (text[j] === c && (j + 1 >= n || isSpace(text[j + 1]))) break;
        j++;
      }
      if (j < n && text[j] === c) {
        push('value', text.slice(i + 1, j), true, line);
        i = j + 1;
      } else {
        // No closing quote on this line: keep the rest of the line rather than failing the file.
        warnings.push({ line, message: `Unterminated quoted string; took the rest of the line.` });
        push('value', text.slice(i + 1, j).replace(/\r$/, ''), true, line);
        i = j;
      }
      continue;
    }

    // Bare word: tag, reserved word, or unquoted value.
    let j = i;
    while (j < n && !isSpace(text[j])) j++;
    const word = text.slice(i, j);
    i = j;

    if (c === '_') {
      push('tag', word.toLowerCase(), false, line);
      continue;
    }
    const lower = word.toLowerCase();
    if (lower.startsWith('data_')) push('data', word.slice(5), false, line);
    else if (lower === 'loop_') push('loop', '', false, line);
    else if (lower.startsWith('save_')) push('save', word.slice(5), false, line);
    else if (lower === 'global_') push('global', '', false, line);
    else if (lower === 'stop_') push('stop', '', false, line);
    else push('value', word, false, line);
  }
  return { tokens, warnings };
}
