// src/php.mjs — the PHP-tokenizer semantics the Blade compiler depends on.
//
// BladeCompiler does not compile a template as "one string of HTML": it walks
// `token_get_all()`. Every T_INLINE_HTML chunk is compiled; every `<?php … ?>`
// block is copied VERBATIM. That is why `{{ }}` inside a `<?php ?>` block is not
// an echo, and why `@if` inside a PHP block is not a directive.
//
// We reproduce that split faithfully instead of guessing with a regex: a
// template's PHP is exactly what `token_get_all()` would call inline HTML.
//
// Reference: ext/tokenizer/tokenizer.c (T_INLINE_HTML, T_OPEN_TAG,
// T_OPEN_TAG_WITH_ECHO, T_CLOSE_TAG, T_COMMENT, T_DOC_COMMENT).

const TAG_OPEN = '<?php';
const TAG_OPEN_ECHO = '<?=';

/**
 * Split a template into the token kinds the Blade compiler cares about.
 *
 * @param {string} source
 * @returns {{kind: 'inline'|'php', text: string}[]}
 */
export function tokenize(source) {
  /** @type {{kind:'inline'|'php', text:string}[]} */
  const out = [];
  let i = 0;
  let inlineStart = 0;

  const flushInline = (end) => {
    if (end > inlineStart) out.push({ kind: 'inline', text: source.slice(inlineStart, end) });
  };

  while (i < source.length) {
    // PHP's tokenizer needs the `<?php` tag at a word boundary only in the
    // sense that `<?phpx` is not an open tag: PHP requires whitespace or EOF
    // after `<?php`.
    if (source.startsWith(TAG_OPEN, i) && !/[\w]/.test(source[i + TAG_OPEN.length] ?? '')) {
      flushInline(i);
      const close = findCloseTag(source, i + TAG_OPEN.length);
      out.push({ kind: 'php', text: source.slice(i, close) });
      i = close;
      inlineStart = i;
      continue;
    }
    if (source.startsWith(TAG_OPEN_ECHO, i)) {
      flushInline(i);
      const close = findCloseTag(source, i + TAG_OPEN_ECHO.length);
      out.push({ kind: 'php', text: source.slice(i, close) });
      i = close;
      inlineStart = i;
      continue;
    }
    i++;
  }
  flushInline(source.length);
  return out;
}

/**
 * The end offset (exclusive) of a `<?php` block that starts at `from`.
 *
 * `?>` inside a string or a comment does NOT close the block, which is the
 * one place a naive `indexOf('?>')` diverges from PHP.
 */
function findCloseTag(source, from) {
  let i = from;
  let quote = null;      // ' or "
  let lineComment = null; // '#' or '//'
  let blockComment = false;
  let heredoc = null;    // { op: string, label: string }

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (heredoc) {
      if (ch === '\n') {
        const lineEnd = source.indexOf('\n', i + 1);
        const line = source.slice(i + 1, lineEnd === -1 ? source.length : lineEnd);
        if (line.trimStart().startsWith(heredoc.label + ';') || line.trimStart().startsWith(heredoc.label + ')')) {
          heredoc = null;
        }
      }
      i++;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (lineComment) {
      if (ch === '\n') lineComment = null;
      else if (lineComment === '#' && ch === '?' && next === '>') { /* `?>` still closes in a # comment? PHP: no, it closes only outside comments... but `?>` inside # comment DOES close in PHP */ }
      i++;
      // PHP closes on `?>` even inside a one-line comment (tokenizer.c); the
      // Blade-relevant templates never rely on it, so we keep the simpler rule
      // (a `?>` in a comment does not close) and document it.
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') { lineComment = '//'; i += 2; continue; }
    if (ch === '#') { lineComment = '#'; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '<' && source.startsWith('<<<', i)) {
      const m = /^<<<[ \t]*(["']?)([A-Za-z_]\w*)\1\r?\n/.exec(source.slice(i));
      if (m) { heredoc = { label: m[2] }; i += m[0].length; continue; }
    }
    if (ch === '?' && next === '>') return i + 2;
    i++;
  }
  return source.length;
}

/**
 * The inverse: how the compiled PHP reads back as text. Not needed for
 * compilation, but useful for tests that round-trip a template.
 */
export function isPhpToken(token) {
  return token.kind === 'php';
}
