// src/errors.mjs — the compiler's failure surface.
//
// A Blade compiler that answers "the directive I do not know" with the raw text
// is the definition of a silent-wrong-answer: Laravel would have compiled it and
// the page would differ. Every refusal here is loud, carries the source location,
// and names what would make it compile.
//
// Codes:
//   BL001  unknown directive (Laravel's BladeCompiler has no `compile<Name>`)
//   BL002  malformed statement (@forelse / @foreach the regex cannot read)
//   BL003  custom directive encountered with no registered handler
//   BL004  component tag that cannot be resolved without the app's class map
//   BL005  an `@php` block that never closes
//   BL006  a component constructed with a non-literal name (needs class_exists)

export class BladeCompileError extends Error {
  /**
   * @param {string} code BL001…BL006
   * @param {string} message the PHP compiler's own wording when it has one
   * @param {{offset?: number, line?: number, column?: number, source?: string}} loc
   * @param {string} [hint] what would make it compile
   */
  constructor(code, message, loc = {}, hint = '') {
    super(message);
    this.name = 'BladeCompileError';
    this.code = code;
    this.offset = loc.offset ?? null;
    this.line = loc.line ?? null;
    this.column = loc.column ?? null;
    this.source = loc.source ?? null;
    this.hint = hint;
  }

  /** A single-line rendering: `BL001 <path>:12:5 — message (hint)`. */
  format(path = null) {
    const where = path ? String(path) : '<string>';
    const at = this.line == null ? where : `${where}:${this.line}:${this.column ?? 1}`;
    return `${this.code} ${at} — ${this.message}${this.hint ? ` (${this.hint})` : ''}`;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      line: this.line,
      column: this.column,
      offset: this.offset,
      hint: this.hint,
    };
  }
}

/** Offset → 1-based line/column, computed from the template source. */
export function locate(source, offset) {
  if (offset == null || offset < 0) return { offset: null, line: null, column: null };
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') { line++; lastNl = i; }
  }
  return { offset, line, column: offset - lastNl };
}
