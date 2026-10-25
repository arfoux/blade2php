// src/compiler.mjs — the BladeCompiler pipeline, ported.
//
// The framework's `compileString()` is a fixed sequence, not a bag of regexes:
//
//   1. storeUncompiledBlocks   @verbatim and @php blocks → raw placeholders
//   2. compileComments         {{-- … --}} → ''
//   3. compileComponentTags    <x-foo /> → @component(…) tags
//   4. token_get_all           walk tokens; T_INLINE_HTML only → compilers
//   5. restoreRawContent       placeholders → the stored verbatim/PHP bytes
//   6. addFooters              @extends put its echo in the footer
//
// Every step is reproduced in that order. Getting the order wrong is the classic
// Blade-port bug: compiling comments after component tags makes `{{-- <x-btn/> --}}`
// emit a component; compiling echos before statements makes `@if ($a == '}}')`
// end early.

import { tokenize } from './php.mjs';
import { BladeCompileError, locate } from './errors.mjs';
import { DIRECTIVES, hasDirective, stripParentheses } from './directives.mjs';
import { trimChars, endsWith, contains } from './str.mjs';
import { componentHash } from './xxh128.mjs';
import { compileComponentTags, createComponentResolver } from './components.mjs';

const RAW_PLACEHOLDER = '@__raw_block_#__@';
const rawPlaceholder = (i) => RAW_PLACEHOLDER.replace('#', String(i));

// BladeCompiler::compileStatements()'s pattern, verbatim.
const STATEMENT_PATTERN = /\B@(@?\w+(?:::\w+)?)([ \t]*)(\((?:[\s\S]*?)\))?/g;

// The echo patterns, built exactly as the framework builds them
// (sprintf with the tags), including the optional leading `@` escape and the
// duplicated newline when the echo is followed by one.
const echoPattern = (open, close) =>
  new RegExp(`(@)?${escapeRe(open)}\\s*(.+?)\\s*${escapeRe(close)}(\\r?\\n)?`, 'gs');

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class BladeCompiler {
  /**
   * @param {object} [options]
   * @param {(name: string, expression: string) => string|null} [options.customDirective]
   *        `Blade::directive($name, fn)` equivalent. When it answers null the
   *        directive is treated as unregistered (and fails loud).
   * @param {(value: string) => string} [options.prepare] `prepareStringsForCompilationUsing`
   * @param {(value: string) => string} [options.precompiler] `precompiler`
   * @param {boolean} [options.componentTags] compile `<x-…>` tags (default true)
   * @param {(name: string) => string|null} [options.componentClass]
   *        resolves `<x-alert>` to a class FQCN or an anonymous view name.
   *        Without it, class components cannot be resolved (BL004).
   * @param {{vite?: {fonts: string, invoke: string}}} [options.context]
   */
  constructor(options = {}) {
    this.options = options;
    this.contentTags = options.contentTags ?? ['{{', '}}'];
    this.rawTags = options.rawTags ?? ['{!!', '!!}'];
    this.escapedTags = options.escapedTags ?? ['{{{', '}}}'];
    this.echoFormat = options.echoFormat ?? 'e(%s)';
    this.componentTags = options.componentTags !== false;

    this.reset();
  }

  /** Per-compile state: footers, raw blocks, directive counters. */
  reset() {
    this.footer = [];
    this.rawBlocks = [];
    this.firstCaseInSwitch = true;
    this.forElseCounter = 0;
    this.lastSection = null;
    this.lastFragment = null;
    this.componentHashStack = [];
    this.echoHandlers = {};
  }

  /**
   * Compile a Blade template to PHP — byte-identical to
   * `Illuminate\View\Compilers\BladeCompiler::compileString()`.
   *
   * @param {string} value the template source
   * @param {{path?: string}} [meta] only used for error messages
   * @returns {string}
   */
  compileString(value, meta = {}) {
    this.reset();
    this.source = String(value);
    this.path = meta.path ?? null;

    let out = this.source;

    if (typeof this.options.prepare === 'function') {
      out = String(this.options.prepare(out));
    }

    out = this.storeUncompiledBlocks(out);
    out = this.compileComments(out);

    if (this.componentTags) {
      out = this.compileComponentTags(out);
    }
    if (typeof this.options.precompiler === 'function') {
      out = String(this.options.precompiler(out));
    }

    // The framework runs the per-token compilers over T_INLINE_HTML only.
    let result = '';
    for (const token of tokenize(out)) {
      if (token.kind === 'php') {
        result += token.text;
        continue;
      }
      let html = token.text;
      html = this.compileExtensions(html);
      html = this.compileStatements(html);
      html = this.compileEchos(html);
      result += html;
    }

    if (this.rawBlocks.length) result = this.restoreRawContent(result);
    if (this.footer.length) result = this.addFooters(result);

    return result
      .replaceAll('##BEGIN-COMPONENT-CLASS##', '')
      .replaceAll('##END-COMPONENT-CLASS##', '');
  }

  // -------------------------------------------------------------------------
  // step 1 — uncompiled blocks
  // -------------------------------------------------------------------------
  storeUncompiledBlocks(value) {
    let v = value;
    if (contains(v, '@verbatim')) v = this.storeVerbatimBlocks(v);
    if (contains(v, '@php')) v = this.storePhpBlocks(v);
    return v;
  }

  storeVerbatimBlocks(value) {
    return value.replace(/(?<!@)@verbatim(\s*)(.*?)@endverbatim/gs, (_m, ws, body) => ws + this.storeRawBlock(body));
  }

  storePhpBlocks(value) {
    return value.replace(/(?<!@)@php(.*?)@endphp/gs, (_m, body) => this.storeRawBlock(`<?php${body}?>`));
  }

  storeRawBlock(value) {
    this.rawBlocks.push(value);
    return rawPlaceholder(this.rawBlocks.length - 1);
  }

  restoreRawContent(result) {
    const re = new RegExp(rawPlaceholder('(\\d+)'), 'g');
    const restored = result.replace(re, (_m, i) => this.rawBlocks[Number(i)]);
    this.rawBlocks = [];
    return restored;
  }

  // -------------------------------------------------------------------------
  // step 2 — comments
  // -------------------------------------------------------------------------
  compileComments(value) {
    const pattern = new RegExp(`${escapeRe(this.contentTags[0])}--(.*?)--${escapeRe(this.contentTags[1])}`, 'gs');
    return value.replace(pattern, '');
  }

  // -------------------------------------------------------------------------
  // step 3 — component tags
  // -------------------------------------------------------------------------
  compileComponentTags(value) {
    if (!this.componentTags) return value;
    // A template with no `<x-…>` costs one scan and nothing else.
    if (!value.includes('<x-') && !value.includes('<x:')) return value;
    return compileComponentTags(value, {
      blade: this,
      componentClass: this.options.componentClass ?? createComponentResolver(this.options.components ?? {}),
      error: (code, message, hint) => this.error(code, message, 0, hint),
    });
  }

  // -------------------------------------------------------------------------
  // step 4a — extensions
  // -------------------------------------------------------------------------
  compileExtensions(value) {
    return value; // `Blade::extend()` has no equivalent here; hook names it.
  }

  // -------------------------------------------------------------------------
  // step 4b — @statements
  // -------------------------------------------------------------------------
  /**
   * Compile the `@…` statements — a SINGLE linear pass.
   *
   * The framework walks the string with `substr_replace()` per match, which is
   * O(n²) on the template length. That is invisible for a view (a few KB) and
   * fatal for a generated one (a 5 MB template took minutes). This version
   * emits each gap and each compiled statement into an accumulator, so every
   * source byte is visited once.
   *
   * The merge rule is preserved exactly: when the non-greedy regex stops at a
   * `)` that does not balance the expression, the match absorbs text up to the
   * next `)` and repeats. Any match swallowed by that extension is skipped,
   * which is what the framework's `unset($matches[0][$i + 1])` does.
   */
  compileStatements(template) {
    const src = template;
    const matches = [...src.matchAll(STATEMENT_PATTERN)];
    if (matches.length === 0) return src;

    let out = '';
    let cursor = 0;

    for (const m of matches) {
      const start = m.index;
      if (start < cursor) continue; // consumed by a previous merge

      let text = m[0];
      const whitespace = m[2] ?? '';
      let parenthesised = m[3] ?? null;
      let inner = m[3] ? m[3].slice(1, -1) : null;
      let end = start + text.length;

      // Keep appending up to the next `)` until the parentheses balance.
      while (inner != null && endsWith(text, ')') && !hasEvenNumberOfParentheses(text)) {
        const nextClose = src.indexOf(')', end);
        if (nextClose === -1) break;
        const rest = src.slice(end, nextClose);
        text = text + rest + ')';
        parenthesised = parenthesised + rest + ')';
        inner = inner + rest;
        end = nextClose + 1;
      }

      out += src.slice(cursor, start);
      out += this.compileStatement([text, m[1], whitespace, parenthesised, inner], start);
      cursor = end;
    }

    return out + src.slice(cursor);
  }

  compileStatement(match, at = 0) {
    const name = match[1];
    const expression = match[3] ?? null;
    // The directive table raises errors without an offset; `fail()` reads this.
    this.statementOffset = at;

    // A raw block placeholder (`@__raw_block_0__@`) is compiler-internal: it must
    // reach restoreRawContent() intact, not be read as a directive.
    if (name.startsWith('__raw_block_')) return match[0];

    // `@@if` escapes the directive: the leading `@` is dropped, nothing compiled.
    if (contains(name, '@')) {
      return expression != null ? name + expression : name + match[2];
    }

    const custom = this.options.customDirective;
    if (typeof custom === 'function') {
      const out = custom(name, expression == null ? '' : trimExpression(expression));
      if (out != null) {
        return expression != null ? out : out + match[2];
      }
      // A registered custom directive that answered null is a bug in the
      // handler, not an unknown directive: say so instead of silently keeping
      // the source.
      if (this.options.customDirectiveNames?.has?.(name)) {
        throw this.error('BL003', `the custom directive @${name} returned no PHP`, at,
          'the registered handler must return a string');
      }
    }

    if (!hasDirective(name)) {
      // Laravel's compiler leaves an unknown `@foo` untouched (compileStatement's
      // final `return $match[0]`), so parity means passing it through: a stray
      // `@endslothi` from a `<x-slot>` closing tag is legitimate literal text.
      // `strict: true` turns that into a build failure instead, which is what a
      // project that wants typo detection should use.
      if (this.options.strict) {
        throw this.error('BL001', `unknown directive @${name}`, at,
          'Blade has no compile' + name[0].toUpperCase() + name.slice(1) + '(); register it with Blade::directive() or remove it');
      }
      return match[0];
    }

    const fn = DIRECTIVES.get(name.toLowerCase());
    const out = String(fn(expression, this) ?? '');
    return expression != null ? out : out + match[2];
  }

  // -------------------------------------------------------------------------
  // step 4c — echoes
  // -------------------------------------------------------------------------
  compileEchos(value) {
    let v = value;
    v = this.compileRawEchos(v);
    v = this.compileEscapedEchos(v);
    v = this.compileRegularEchos(v);
    return v;
  }

  compileRawEchos(value) {
    const pattern = echoPattern(this.rawTags[0], this.rawTags[1]);
    const handlers = this.echoHandlers;
    return value.replace(pattern, (full, escaped, body, newline) => {
      const ws = newline ? newline + newline : '';
      if (escaped) return full.slice(1);
      return `<?php echo ${wrapInEchoHandler(body, handlers)}; ?>${ws}`;
    });
  }

  compileEscapedEchos(value) {
    const pattern = echoPattern(this.escapedTags[0], this.escapedTags[1]);
    const handlers = this.echoHandlers;
    return value.replace(pattern, (full, escaped, body, newline) => {
      const ws = newline ? newline + newline : '';
      if (escaped) return full;
      return `<?php echo e(${wrapInEchoHandler(body, handlers)}); ?>${ws}`;
    });
  }

  compileRegularEchos(value) {
    const pattern = echoPattern(this.contentTags[0], this.contentTags[1]);
    const handlers = this.echoHandlers;
    return value.replace(pattern, (full, escaped, body, newline) => {
      const ws = newline ? newline + newline : '';
      if (escaped) return full.slice(1);
      const wrapped = this.echoFormat.replace('%s', wrapInEchoHandler(body, handlers));
      return `<?php echo ${wrapped}; ?>${ws}`;
    });
  }

  // -------------------------------------------------------------------------
  // step 6 — footers
  // -------------------------------------------------------------------------
  addFooters(result) {
    const trimmed = result.replace(/^\n+/, '');
    return trimmed + '\n' + [...this.footer].reverse().join('\n');
  }

  // -------------------------------------------------------------------------
  // helpers shared with the directive table
  // -------------------------------------------------------------------------
  newComponentHash(value) {
    const hash = componentHash(value);
    this.componentHashStack.push(hash);
    return hash;
  }

  popComponentHash() {
    return this.componentHashStack.pop();
  }

  /** Raise an error at an explicit offset. */
  error(code, message, at, hint = '') {
    const loc = locate(this.source ?? '', typeof at === 'number' ? at : null);
    return new BladeCompileError(code, message, { ...loc, source: this.path }, hint);
  }

  /** Raise an error at the directive currently being compiled. */
  fail(code, message, hint = '') {
    return this.error(code, message, this.statementOffset ?? null, hint);
  }
}

/** `Str::trim($value)` on an expression handed to a custom directive. */
function trimExpression(expression) {
  let v = stripParentheses(expression);
  return trimChars(v, ' \t\n\r\0\x0B');
}

/**
 * `BladeCompiler::wrapInEchoHandler()`: trim, drop ONE trailing `;`, and (when
 * handlers are registered) wrap. `Stringable::trim()` trims PHP's default set.
 */
function wrapInEchoHandler(value, handlers) {
  let v = trimChars(value, " \t\n\r\0\x0B");
  if (endsWith(v, ';')) v = v.slice(0, -1);
  if (!handlers || Object.keys(handlers).length === 0) return v;
  return `$__bladeCompiler->applyEchoHandler(${v})`;
}

/**
 * `BladeCompiler::hasEvenNumberOfParentheses()`: a `token_get_all()` count.
 * The PHP implementation returns false when the expression does not parse; we
 * cannot parse PHP here, so we count with a small scanner that understands
 * strings, comments and heredocs — which is what the tokenizer would do for the
 * characters that matter (parentheses inside a string are not parentheses).
 */
function hasEvenNumberOfParentheses(expression) {
  const balanced = scanParens(expression);
  if (!balanced) return false;
  let open = 0;
  let close = 0;
  for (const ch of balanced) {
    if (ch === '(') open++;
    else if (ch === ')') close++;
  }
  return open === close;
}

/** `<<<LABEL` / `<<<'LABEL'` / `<<<"LABEL"` — sticky so it costs nothing. */
const HEREDOC = /<<<[ \t]*(["']?)([A-Za-z_]\w*)\1\r?\n/y;

/** Strip strings/comments so only real code characters remain. */
function scanParens(code) {
  let out = '';
  let i = 0;
  const s = String(code);
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let heredoc = null;

  while (i < s.length) {
    const ch = s[i];
    const next = s[i + 1];

    if (heredoc) {
      if (ch === '\n') {
        const lineEnd = s.indexOf('\n', i + 1);
        const line = s.slice(i + 1, lineEnd === -1 ? s.length : lineEnd);
        if (line.trimStart().startsWith(heredoc + ';') || line.trimStart().startsWith(heredoc + ')')) heredoc = null;
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
      if (ch === '\n') lineComment = false;
      i++;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 2; continue; }
    if (ch === '#') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '<' && next === '<' && s[i + 2] === '<') {
      HEREDOC.lastIndex = i;
      const m = HEREDOC.exec(s);
      if (m) { heredoc = m[2]; i += m[0].length; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}
