// src/components.mjs — ComponentTagCompiler, ported from
// Illuminate\View\Compilers\ComponentTagCompiler (Laravel 13.x).
//
// `<x-alert type="danger">…</x-alert>` is not a Blade directive: it is rewritten
// into `@component(...)` BEFORE the statement compiler runs, by a separate
// precompiler with its own attribute pipeline. That pipeline is what this module
// reproduces, in the framework's order:
//
//   compileSlots           <x-slot:name …> → @slot(name, null, [...])
//   compileSelfClosingTags <x-foo … />     → @component(…) + @endComponentClass
//   compileOpeningTags     <x-foo …>       → @component(…)
//   compileClosingTags     </x-foo>        → @endComponentClass
//
// Each attribute goes through:
//   parseShortAttributeSyntax  :$foo        → :foo="$foo"
//   parseAttributeBag          {{ $attributes }} → :attributes="$attributes"
//   parseComponentTagClass…    @class(...)  → :class="\…Arr::toCssClasses(…)"
//   parseComponentTagStyle…    @style(...)  → :style="\…Arr::toCssStyles(…)"
//   parseBindAttributes        :foo=        → bind:foo=
// then the attribute/value regex, then `attributesToString`.
//
// `componentClass()` needs `class_exists` + the view finder in PHP. A pure-JS
// compiler cannot have either, so the caller supplies `componentClass(name)`.
// When it cannot answer, this module refuses (BL004) instead of guessing —
// Laravel itself throws `InvalidArgumentException` in that situation.

import { tokenize } from './php.mjs';
import {
  startsWith, contains, camel, after, afterLast, start, replaceFirst, explode,
} from './str.mjs';

const ANONYMOUS_COMPONENT = 'Illuminate\\View\\AnonymousComponent';
const DYNAMIC_COMPONENT = 'Illuminate\\View\\DynamicComponent';
const HINT_PATH_DELIMITER = '::';

/** `Str::stripQuotes` — drop one leading and one trailing quote. */
export function stripQuotes(value) {
  const v = String(value);
  return startsWith(v, ['"', "'"]) ? v.slice(1, -1) : v;
}

// ---------------------------------------------------------------------------
// attribute-string preprocessing (each is a straight port)
// ---------------------------------------------------------------------------

/** `:$foo` → `:foo="$foo"`. */
export function parseShortAttributeSyntax(value) {
  return String(value).replace(/(\s):\$(\w+)/g, (_m, ws, name) => `${ws}:${name}="$${name}"`);
}

/** `{{ $attributes }}` / `{{ $attributes->merge(...) }}` → `:attributes="…"`. */
export function parseAttributeBag(attributeString) {
  return String(attributeString).replace(
    /(?:^|\s+)\{\{\s*(\$attributes(?:[^}]+?(?<!\s))?)\s*\}\}/g,
    (_m, expr) => ` :attributes="${expr}"`,
  );
}

/** `@class([...])` → `:class="\Illuminate\Support\Arr::toCssClasses([...])"`. */
export function parseComponentTagClassStatements(attributeString) {
  return replaceBalancedDirective(attributeString, 'class', 'toCssClasses');
}

/** `@style([...])` → `:style="\Illuminate\Support\Arr::toCssStyles([...])"`. */
export function parseComponentTagStyleStatements(attributeString) {
  return replaceBalancedDirective(attributeString, 'style', 'toCssStyles');
}

/**
 * The framework uses the recursive PCRE `@(class)(\( ( (?>[^()]+) | (?2) )* \))`.
 * JavaScript has no recursion, so the balanced parentheses are scanned here.
 */
function replaceBalancedDirective(input, name, method) {
  const s = String(input);
  const needle = `@${name}(`;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf(needle, i);
    if (at === -1) { out += s.slice(i); break; }
    out += s.slice(i, at);
    const open = at + needle.length - 1;
    const body = readBalanced(s, open);
    if (body === null) { out += s.slice(at); break; }
    const args = body.inner.replaceAll('"', "'");
    out += `:${name}="\\Illuminate\\Support\\Arr::${method}(${args})"`;
    i = body.end;
  }
  return out;
}

/** `:foo=` → `bind:foo=` (a single colon, not `::`). */
export function parseBindAttributes(attributeString) {
  return String(attributeString).replace(/(?:^|\s+):(?!:)([\w\-:.@]+)=/gm, (_m, name) => ` bind:${name}=`);
}

/**
 * `compileAttributeEchos`: compile the `{{ }}` in an attribute value into string
 * concatenation, escaping single quotes only in inline HTML.
 */
export function compileAttributeEchos(blade, attributeString) {
  let value = blade.compileEchos(String(attributeString));
  value = escapeSingleQuotesOutsideOfPhpBlocks(value);
  value = value.replaceAll('<?php echo ', "'.");
  value = value.replaceAll('; ?>', ".'");
  return value;
}

/** Escape `'` in T_INLINE_HTML segments only. */
export function escapeSingleQuotesOutsideOfPhpBlocks(value) {
  return tokenize(String(value))
    .map((t) => (t.kind === 'inline' ? t.text.replaceAll("'", "\\'") : t.text))
    .join('');
}

/**
 * `getAttributesFromAttributeString` — the attribute map, with the framework's
 * `{ name, value }` shape and its `boundAttributes` bookkeeping.
 */
export function getAttributesFromAttributeString(blade, attributeString, boundAttributes) {
  let s = parseShortAttributeSyntax(attributeString);
  s = parseAttributeBag(s);
  s = parseComponentTagClassStatements(s);
  s = parseComponentTagStyleStatements(s);
  s = parseBindAttributes(s);

  const out = {};
  const re = /([\w\-:.@%]+)(?:=("([^"]+)"|'([^']+)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let attribute = m[1];
    let value = m[2] === undefined ? null : (m[3] ?? m[4] ?? m[5]);

    if (value === null) {
      value = 'true';
      attribute = start(attribute, 'bind:');
    }

    value = stripQuotes(value);

    if (startsWith(attribute, 'bind:')) {
      attribute = after(attribute, 'bind:');
      boundAttributes[attribute] = true;
    } else {
      value = `'${compileAttributeEchos(blade, value)}'`;
    }

    if (startsWith(attribute, '::')) attribute = attribute.slice(1);

    out[attribute] = value;
  }
  return out;
}

/** `attributesToString` — `'a' => 1,'b' => 2`, with the bound-attribute sanitizer. */
export function attributesToString(attributes, boundAttributes, escapeBound = true) {
  return Object.entries(attributes)
    .map(([attribute, value]) => {
      const sanitize = escapeBound
        && Object.prototype.hasOwnProperty.call(boundAttributes, attribute)
        && value !== 'true'
        && !isNumeric(value);
      return sanitize
        ? `'${attribute}' => \\Illuminate\\View\\Compilers\\BladeCompiler::sanitizeComponentAttribute(${value})`
        : `'${attribute}' => ${value}`;
    })
    .join(',');
}

const isNumeric = (v) => {
  const s = String(v).trim();
  return s !== '' && !Number.isNaN(Number(s));
};

/** `Str::camel` over the attribute keys, as `componentString` does for data. */
function camelKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[camel(k)] = v;
  return out;
}

// ---------------------------------------------------------------------------
// componentClass resolution
// ---------------------------------------------------------------------------

/** `formatClassName`: `alert-box` → `AlertBox`, `forms.input` → `Forms\Input`. */
export function formatClassName(component) {
  return explode('.', String(component))
    .map((piece) => {
      const c = camel(piece);
      return c.charAt(0).toUpperCase() + c.slice(1);
    })
    .join('\\');
}

/** `guessViewName`: `alert` → `components.alert`. */
export function guessViewName(name, prefix = 'components.') {
  let p = prefix.endsWith('.') ? prefix : prefix + '.';
  if (contains(name, HINT_PATH_DELIMITER)) return replaceFirst(HINT_PATH_DELIMITER, HINT_PATH_DELIMITER + p, name);
  return p + name;
}

/**
 * Build the default `componentClass(name)` resolver from the facts a pure-JS
 * build can actually know: the app namespace, the registered aliases and
 * namespaces, and a `viewExists(name)` predicate backed by the view finder.
 */
export function createComponentResolver({ namespace = 'App\\', aliases = {}, namespaces = {}, viewExists = () => false } = {}) {
  return (component) => {
    const name = String(component);

    if (Object.prototype.hasOwnProperty.call(aliases, name)) {
      return aliases[name];
    }

    // `prefix::name` registered namespace
    const segments = explode(HINT_PATH_DELIMITER, name);
    const prefix = segments[0];
    if (Object.prototype.hasOwnProperty.call(namespaces, prefix) && segments[1]) {
      const cls = `${namespaces[prefix]}\\${formatClassName(segments[1])}`;
      return cls;
    }

    // `App\View\Components\AlertBox` — unverifiable here (no class_exists).
    const guessedClass = `${namespace}View\\Components\\${formatClassName(name)}`;

    // Anonymous: `components.alert`, `components.alert.index`, `components.alert.alert`
    const candidates = [];
    const base = guessViewName(name);
    candidates.push(base, `${base}.index`, `${base}.${afterLast(afterLast(name, '.'), ':')}`);
    for (const c of candidates) if (viewExists(c)) return c;

    if (startsWith(name, 'mail::')) return name;

    // The class guess cannot be confirmed without `class_exists`, and the
    // resolver's contract is "answer only what you can prove".
    void guessedClass;
    return null;
  };
}

// ---------------------------------------------------------------------------
// the compiler itself
// ---------------------------------------------------------------------------

/**
 * Compile the component and slot tags in `value`.
 *
 * @param {string} value
 * @param {object} ctx
 * @param {import('./compiler.mjs').BladeCompiler} ctx.blade the Blade compiler (for compileEchos)
 * @param {(name: string) => string|null} ctx.componentClass
 * @param {(code: string, message: string, hint: string) => Error} ctx.error
 * @returns {string}
 */
export function compileComponentTags(value, ctx) {
  let v = compileSlots(value, ctx);
  v = compileSelfClosingTags(v, ctx);
  v = compileOpeningTags(v, ctx);
  v = compileClosingTags(v);
  return v;
}

function compileSlots(value, ctx) {
  const pattern = /<\s*x[-:]slot(?::([\w-]+))?(?:\s+name=(?:"[^"]+"|'[^']+'|[^\s>]+))?(?:\s+:name=(?:"[^"]+"|'[^']+'|[^\s>]+))?((?:\s+[\s\S]*?)?)(?<![\/=\-])>/g;

  let out = value.replace(pattern, (full, inlineName, attrs) => {
    const nameMatch = /\s+name=("([^"]+)"|'([^']+)'|([^\s>]+))/.exec(attrs || '');
    const boundMatch = /\s+:name=("([^"]+)"|'([^']+)'|([^\s>]+))/.exec(attrs || '');

    let name = stripQuotes(inlineName || (nameMatch && (nameMatch[2] ?? nameMatch[3] ?? nameMatch[4])) || (boundMatch && (boundMatch[2] ?? boundMatch[3] ?? boundMatch[4])) || '') || "'slot'";

    if (contains(name, '-') && inlineName) name = camel(name);
    if (inlineName || nameMatch) name = `'${name}'`;

    const boundAttributes = {};
    let attributes = getAttributesFromAttributeString(ctx.blade, stripSlotMeta(attrs || ''), boundAttributes);

    if (inlineName && (nameMatch || boundMatch)) {
      const extra = nameMatch
        ? getAttributesFromAttributeString(ctx.blade, `name=${nameMatch[1]}`, boundAttributes)
        : getAttributesFromAttributeString(ctx.blade, `:name=${boundMatch[1]}`, boundAttributes);
      attributes = { ...attributes, ...extra };
    }

    return ` @slot(${name}, null, [${attributesToString(attributes, boundAttributes)}]) `;
  });

  return out.replace(/<\/\s*x[-:]slot[^>]*>/g, ' @endslot');
}

/** Drop the `name=` / `:name=` used for the slot's identity from its attributes. */
function stripSlotMeta(attrs) {
  return attrs.replace(/\s+name=("[^"]+"|'[^']+'|[^\s>]+)/, '').replace(/\s+:name=("[^"]+"|'[^']+'|[^\s>]+)/, '');
}

function compileSelfClosingTags(value, ctx) {
  const pattern = /<\s*x[-:]([\w\-:.]+)((?:\s+[\s\S]*?)?)\s*\/>/g;
  return value.replace(pattern, (_full, name, attrs) => {
    const boundAttributes = {};
    const attributes = getAttributesFromAttributeString(ctx.blade, attrs || '', boundAttributes);
    return componentString(name, attributes, boundAttributes, ctx) + '\n@endComponentClass##END-COMPONENT-CLASS##';
  });
}

function compileOpeningTags(value, ctx) {
  const pattern = /<\s*x[-:]([\w\-:.]+)((?:\s+[\s\S]*?)?)(?<![\/=\-])>/g;
  return value.replace(pattern, (_full, name, attrs) => {
    const boundAttributes = {};
    const attributes = getAttributesFromAttributeString(ctx.blade, attrs || '', boundAttributes);
    return componentString(name, attributes, boundAttributes, ctx);
  });
}

function compileClosingTags(value) {
  return String(value).replace(/<\/\s*x[-:][\w\-:.]*\s*>/g, ' @endComponentClass##END-COMPONENT-CLASS##');
}

/**
 * `componentString` — the exact bytes, including the `withAttributes` tail.
 */
function componentString(component, attributes, boundAttributes, ctx) {
  const resolve = ctx.componentClass;
  const resolved = typeof resolve === 'function' ? resolve(component) : null;

  if (!resolved) {
    throw ctx.error(
      'BL004',
      `cannot resolve the component <x-${component}>`,
      'pass componentClass(name) so the compiler can map it to a class or an anonymous view',
    );
  }

  // A resolver answers one of:
  //   'App\\View\\Components\\Alert'          class FQCN (contains a backslash)
  //   'components.forms.input'          anonymous view name
  //   { class, params }                 class + constructor parameter names
  //   { view }                          anonymous view
  const spec = typeof resolved === 'string' ? { class: resolved } : resolved;
  const classNameResolved = spec.class ?? null;
  const viewName = spec.view ?? (classNameResolved && !classNameResolved.includes('\\') ? classNameResolved : null);
  const isAnonymous = viewName != null;

  let className;
  let parameters;
  let extraAttributes = attributes;

  if (isAnonymous) {
    const view = startsWith(component, 'mail::')
      ? `$__env->getContainer()->make(Illuminate\\View\\Factory::class)->make('${component}')`
      : `'${viewName}'`;
    parameters = {
      view,
      data: `[${attributesToString(camelKeys(attributes), boundAttributes, false)}]`,
    };
    className = ANONYMOUS_COMPONENT;
  } else {
    className = classNameResolved;
    // Illuminate\View\Compilers\ComponentTagCompiler::partitionDataAndAttributes
    const params = spec.params ?? [];
    const data = {};
    const rest = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (params.includes(camel(key))) data[key] = value;
      else rest[key] = value;
    }
    parameters = camelKeys(data);
    extraAttributes = rest;
  }

  const data = attributesToString(parameters, boundAttributes, false);
  const rest = attributesToString(extraAttributes, boundAttributes, className !== DYNAMIC_COMPONENT);

  // The framework emits the `@component(...)` DIRECTIVE here and lets
  // compileStatements expand it (CompilesComponents::compileComponent), so the
  // class-opening block is produced in exactly one place.
  return `##BEGIN-COMPONENT-CLASS##@component('${className}', '${component}', [${data}])
<?php if (isset($attributes) && $attributes instanceof Illuminate\\View\\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\\${className}::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([${rest}]); ?>`;
}

/** Scan a balanced `( … )` starting at `open`. */
function readBalanced(s, open) {
  let depth = 0;
  let i = open;
  let quote = null;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { inner: s.slice(open + 1, i), end: i + 1 };
    }
    i++;
  }
  return null;
}

export default { compileComponentTags, createComponentResolver, formatClassName, guessViewName };
