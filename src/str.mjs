// src/str.mjs — the `Illuminate\Support\Str` helpers Blade's compiler relies on,
// plus the PHP `preg_*` semantics that differ from JavaScript's RegExp.
//
// Every helper here is a port of the PHP/Illuminate implementation, not a
// re-interpretation: `stripParentheses` must drop exactly one leading `(` and
// one trailing `)`, `explode` must answer `['']` for an empty subject, and
// `endsWith` must be an empty-string-safe `substr_compare`, because the compiler
// compares their results (`$expression[1] === '['`, `Arr::last($tokens) !== ')'`).

/**
 * PHP's `Str::startsWith`. Accepts a needle ARRAY like the framework does
 * (`Str::startsWith($value, ['"', "'"])` is how `stripQuotes` is written).
 */
export function startsWith(haystack, needle) {
  const h = String(haystack);
  const needles = Array.isArray(needle) ? needle : [needle];
  return needles.some((n) => {
    const s = String(n);
    return s === '' || (h.length >= s.length && h.startsWith(s));
  });
}

/** PHP's `Str::endsWith`, array-capable like `startsWith`. */
export function endsWith(haystack, needle) {
  const h = String(haystack);
  const needles = Array.isArray(needle) ? needle : [needle];
  return needles.some((n) => {
    const s = String(n);
    return s === '' || (h.length >= s.length && h.endsWith(s));
  });
}

/** PHP's `Str::contains` with a string needle. */
export function contains(haystack, needle) {
  return String(haystack).includes(String(needle));
}

/**
 * `Str::after($subject, $search)` — everything after the FIRST occurrence.
 * When the needle is absent PHP answers the whole subject (Str::after uses
 * `strpos` and returns `$subject` on `false`).
 */
export function after(subject, search) {
  const s = String(subject);
  const p = s.indexOf(String(search));
  return p === -1 ? s : s.slice(p + String(search).length);
}

/** `Str::before($subject, $search)` — everything before the FIRST occurrence. */
export function before(subject, search) {
  const s = String(subject);
  const p = s.indexOf(String(search));
  return p === -1 ? s : s.slice(0, p);
}

/**
 * `Str::substr($subject, $start, $length)` — byte-oriented in PHP; Blade only
 * ever calls it on ASCII expressions, so code-unit slicing is equivalent there.
 */
export function substr(subject, start, length = null) {
  const s = String(subject);
  const len = s.length;
  let from = Number(start);
  if (from < 0) from = Math.max(0, len + from);
  else from = Math.min(from, len);
  if (length === null) return s.slice(from);
  let l = Number(length);
  if (l < 0) l = Math.max(0, len - from + l);
  return s.slice(from, from + l);
}

/**
 * `Str::trim($subject, $characters)` — PHP's `trim()` treats `$characters` as a
 * SET of bytes and understands `a..z` ranges. `Str::trim` adds the `\0` byte.
 */
export function trimChars(subject, characters) {
  const set = charSet(characters);
  const s = String(subject);
  let a = 0;
  let b = s.length;
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}

function charSet(characters) {
  const set = new Set();
  const chars = String(characters);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i + 1] === '.' && chars[i + 2] === '.' && i + 3 < chars.length) {
      const from = chars.charCodeAt(i);
      const to = chars.charCodeAt(i + 3);
      for (let c = from; c <= to; c++) set.add(String.fromCharCode(c));
      i += 3;
      continue;
    }
    set.add(chars[i]);
  }
  return set;
}

/**
 * PHP's `explode($separator, $string)` — an empty subject yields `['']`
 * (not `[]`), which matters because Blade reads `$parts[1] ?? …`.
 */
export function explode(separator, subject, limit = null) {
  const sep = String(separator);
  if (sep === '') throw new Error('explode(): Argument #1 ($separator) cannot be empty');
  if (limit == null) return String(subject).split(sep);
  // PHP's $limit keeps the remainder in the last element.
  const parts = String(subject).split(sep);
  if (limit <= 0 || parts.length <= limit) return parts;
  return [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(sep)];
}



/**
 * `Str::snake` / `Str::camel` / `Str::studly` — used by the component tag
 * compiler to turn `<x-alert-box>` into `Admin\View\Components\AlertBox`.
 * Ported from Illuminate\Support\Str (the ASCII fast path; Blade component
 * names are ASCII by definition).
 */
export function studly(value) {
  const words = String(value).replace(/[-_\s]+/g, ' ').trim().split(' ');
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export function camel(value) {
  const s = studly(value);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function snake(value, delimiter = '_') {
  return String(value)
    .replace(/(.)(?=[A-Z])/g, `$1${delimiter}`)
    .replace(/\s+/g, delimiter)
    .replace(new RegExp(`${delimiter}{2,}`, 'g'), delimiter)
    .toLowerCase();
}


/** `Str::afterLast($subject, $search)`. */
export function afterLast(subject, search) {
  const s = String(subject);
  const p = s.lastIndexOf(String(search));
  return p === -1 ? s : s.slice(p + String(search).length);
}

/** `Str::start($subject, $prefix)` — prefix unless already there. */
export function start(subject, prefix) {
  const s = String(subject);
  const p = String(prefix);
  return s.startsWith(p) ? s : p + s;
}

/** `Str::replaceFirst($search, $replace, $subject)`. */
export function replaceFirst(search, replace, subject) {
  const s = String(subject);
  const i = s.indexOf(String(search));
  return i === -1 ? s : s.slice(0, i) + String(replace) + s.slice(i + String(search).length);
}

/**
 * `Str::uuid()` — the compiler substitutes a fresh id for `@once` without an
 * argument. PHP uses a v4 UUID; any unique v4 string is byte-equivalent for the
 * purpose (the id is only compared with itself) but tests need it to be
 * deterministic, so the caller can install a generator.
 */
let uuidGenerator = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function uuid() {
  return uuidGenerator();
}

/** Test seam: make `@once` reproducible. */
export function setUuidGenerator(fn) {
  const previous = uuidGenerator;
  uuidGenerator = fn;
  return previous;
}
