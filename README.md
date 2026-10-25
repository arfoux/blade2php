# @laravel-workers/blade

A **Laravel Blade compiler written in JavaScript**. Input: a `.blade.php` template.
Output: the **exact PHP bytes** `Illuminate\View\Compilers\BladeCompiler` produces.

No PHP runtime. No Composer. No `vendor/`. The compiler is the package.

```js
import { compile } from '@laravel-workers/blade';

compile('<h1>{{ $title }}</h1>');
// '<h1><?php echo e($title); ?></h1>'
```

## Why

`laravel-workers` compiles a Laravel app to edge JavaScript. Its build used to
boot the real Laravel app through PHP just to get the Blade compiler's output,
which meant every build needed a PHP interpreter and a `vendor/` directory.
This package removes that dependency: the compiler is a pure-JS port of the
framework's own compiler, verified byte-for-byte.

## Fidelity

The contract is **byte-identical output**, not "renders the same HTML". The test
suite pins it:

| Suite | What it proves |
|---|---|
| `tests/compile.test.mjs` | 154 templates compile to the exact bytes Laravel 13.38.0 / PHP 8.3.30 produced |
| `tests/components.test.mjs` | the `<x-…>` attribute pipeline, step by step |
| `tests/errors.test.mjs` | the refusal surface |
| `tests/php.test.mjs` | the `token_get_all` split (what is and is not compiled) |
| `tests/xxh128.test.mjs` | `hash('xxh128')`, which Blade embeds in variable names |

The golden file was recorded by running the **real** Blade compiler:

```bash
node tests/oracle/record.mjs --app /path/to/laravel-app   # needs PHP >= 8.3 + vendor/
node tests/oracle/run.mjs    --app /path/to/laravel-app   # live comparison
```

`npm test` needs neither PHP nor an app: it compares against `tests/golden.json`.

## Coverage

All **125** `compile*` methods of `BladeCompiler` (Laravel 13.x) are ported:

- **conditionals** — `@if @elseif @else @endif @unless @isset @auth @guest @env
  @production @switch @case @default @once @checked @selected @disabled
  @readonly @required @bool @pushIf`
- **loops** — `@foreach @forelse @empty @for @while @break @continue`
- **layouts** — `@extends @extendsFirst @section @yield @parent @show @append
  @overwrite @stop @endsection`
- **stacks** — `@push @prepend @stack @pushOnce @prependOnce`
- **includes** — `@include @includeIf @includeWhen @includeUnless @includeFirst
  @includeIsolated @each`
- **components** — `@component @slot @endComponent @props @aware`, plus the
  `<x-…>` tag precompiler
- **helpers** — `@csrf @method @vite @viteReactRefresh @fonts @json @js @dump @dd`
- **the rest** — `@error @session @context @fragment @lang @choice @inject @use
  @php @unset @verbatim @class @style`

`@verbatim` and `@php … @endphp` are stored as raw blocks, exactly as the
framework does, so their contents are never compiled.

## Refusals

A compiler that quietly passes through what it does not understand ships broken
pages. This one is explicit:

| Code | When |
|---|---|
| `BL001` | unknown directive — **only in `strict` mode** (Laravel passes it through) |
| `BL002` | malformed `@foreach` / `@forelse` |
| `BL003` | a registered custom directive returned nothing |
| `BL004` | a `<x-…>` component that cannot be resolved |

```js
import { compile, BladeCompileError } from '@laravel-workers/blade';

try {
  compile('@foreach($items)\n@endforeach', { strict: true });
} catch (e) {
  if (e instanceof BladeCompileError) console.error(e.format('a.blade.php'));
  // BL002 a.blade.php:1:10 — Malformed @foreach statement. (write `@foreach ($items as $item)`)
}
```

### `strict` and unknown directives

Laravel's `compileStatement()` ends with `return $match[0]`, so an unknown
`@foo` is **literal text**. Parity therefore means passing it through, and that
is the default. `strict: true` turns it into `BL001`, which is what a project
that wants typo detection should enable.

This matters in practice: `</x-slot>` compiles to ` @endslot` with no trailing
space, so `</x-slot>hi` becomes `@endslothi` — literal text Laravel would also
emit. Strict mode would reject that template.

## Components

`<x-alert>` needs `class_exists()` and the view finder in PHP. A pure-JS
compiler has neither, so **the caller supplies the resolution**:

```js
compile('<x-alert type="danger" />', {
  componentClass: (name) => ({
    // a class component: the constructor parameters let the compiler split
    // data from attributes (`partitionDataAndAttributes`)
    alert: { class: 'App\\View\\Components\\Alert', params: ['type', 'count'] },
    // an anonymous component: the view it renders
    'forms.input': { view: 'components.forms.input' },
  }[name] ?? null),
});
```

A string return is also accepted: `'App\\View\\Components\\Alert'` (contains a
backslash → class) or `'components.alert'` (no backslash → anonymous view).

`createComponentResolver()` builds the default resolver from the facts a build
can know:

```js
import { createComponentResolver } from '@laravel-workers/blade/components';

const componentClass = createComponentResolver({
  namespace: 'App\\',
  aliases: { alert: 'App\\View\\Components\\Alert' },
  namespaces: { admin: 'App\\Admin\\View\\Components' },
  viewExists: (name) => /* the build's view finder */ false,
});
```

When it cannot answer, the compiler throws `BL004` — the same situation in
which Laravel throws `InvalidArgumentException`.

## API

### `compile(source, options?) → string`

Compiles one template. Throws `BladeCompileError`.

### `createCompiler(options?) → { compileString, compiler }`

A reusable instance. `compileString()` resets per-template state (footer, raw
blocks, `@switch`/`@forelse` counters) at the start of every call, like the
framework's `compileString()`.

### Options

| Option | Default | Meaning |
|---|---|---|
| `path` | `null` | used in error messages only |
| `strict` | `false` | unknown directives throw `BL001` |
| `componentTags` | `true` | compile `<x-…>` tags |
| `componentClass` | — | `(name) => string \| {class, params} \| {view} \| null` |
| `components` | `{}` | options for the default resolver |
| `customDirective` | — | `(name, expression) => string \| null` (`Blade::directive`) |
| `customDirectiveNames` | — | `Set` of registered names (so a `null` return is `BL003`) |
| `prepare` | — | `prepareStringsForCompilationUsing` |
| `precompiler` | — | `precompiler` |
| `echoFormat` | `'e(%s)'` | the framework's `echoFormat` |
| `contentTags` | `['{{', '}}']` | |
| `rawTags` | `['{!!', '!!}']` | |
| `escapedTags` | `['{{{', '}}}']` | |

### `tokenize(source)`

The `token_get_all` split the compiler is built on: `[{ kind: 'inline' | 'php', text }]`.
Only `inline` tokens are compiled — which is why `{{ }}` inside `<?php ?>` is
not an echo.

## Known limits

These are deliberate, not oversights:

- **Laravel 13.x only.** The directive set moves between majors (`@props`/`@aware`
  are 9+, `@context` is 11+, `@fonts` is 13+). Compiling a Laravel 10 template
  with this compiler is not supported; the 125-method surface is 13.x's.
- **Components need a resolver.** `class_exists()` has no JS equivalent, so
  `<x-alert>` requires `componentClass` (or `createComponentResolver` with a
  real `viewExists`). Unresolvable → `BL004`, like Laravel's own throw.
- **No renderer.** Output is PHP. Rendering is the runtime's job.
- **`@verbatim` is matched non-greedily**, exactly like Laravel: a literal
  `@endverbatim` inside a verbatim block ends it, in both compilers.
- **No performance work.** Compilation is a linear scan plus the framework's own
  passes; huge templates are untested, but the algorithm is the framework's.

## What this is not

- **Not a renderer.** It produces PHP. Rendering is the runtime's job.
- **Not a Blade *formatter*.** It does not preserve or normalise whitespace; it
  reproduces the compiler's output, doubled newlines and all.
- **Not a parser of PHP expressions.** `{{ $a + $b }}` is copied into the echo
  verbatim; the compiler never needs to understand it.

## Design notes

Three decisions shape the port:

1. **The `token_get_all` split is reproduced, not approximated.** Blade compiles
   `T_INLINE_HTML` chunks and copies `<?php ?>` blocks verbatim. Doing this with
   one regex over the whole file breaks on `{{ }}` inside a PHP string.

2. **Directive functions return the framework's exact bytes.** Whitespace,
   `<?php`/`?>` placement and `$__env->` call shapes are part of the output.
   Each function is named after its `compile*` method so it can be diffed
   against `upstream/Compilers/Concerns/*.php`.

3. **`xxh128` is implemented, not stubbed.** Blade embeds `hash('xxh128', …)` in
   the variable names of a class component's compiled PHP. A different hash is
   valid PHP but not byte-identical, so the whole XXH3-128 algorithm is ported
   (all length classes) and pinned to the published digests.

`upstream/` holds the vendored Laravel 13 and xxHash v0.8.2 sources the port was
written against. They are reference material, not build inputs.

## License

MIT. The ported algorithm is Laravel's (MIT) and xxHash's (BSD-2-Clause); both
are compatible and attributed in the source.
