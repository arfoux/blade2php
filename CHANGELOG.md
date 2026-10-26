# Changelog

All notable changes to **blade2php** will be documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-10-27

Verified against a **real Laravel 11.34.2 project** (Breeze/Livewire/Sanctum) through its live oracle, byte-for-byte.

### Fixed
- **`<x-slot name="…">` lost the slot name**: the `name=`/`:name=` attributes sat in *non-capturing* regex groups, so `compileSlots` never saw them and compiled `<x-slot name="logo">` as `slot('slot')` — real Laravel emits `slot('logo')`. Found by the byte-compare seam on the audited app's Breeze views (the shorthand `<x-slot:logo>` was unaffected). Regression test added; the oracle went from 139 passed / 14 failed to **147 / 0** on that app once both fixes below were in.
- **Mid-major version switches**: Laravel changed the include/layout view-data filter in **v11.43.0** (`Arr::except(…)` → `array_diff_key(…)`, verified against the tags themselves), so a major-only table was wrong for every 11.0–11.42 app (measured: 8 of 147 byte failures on a real 11.34.2 project). `compile()` accepts `installed` (the exact version from composer.lock — no vendor, no boot) and `varsFor()` uses it; without it the major default stands.
- **The live oracle mis-reported every non-13 app**: `tests/oracle/run.mjs` never passed a `laravel:` version, compiling everything as 13.x (14 false failures on an 11.34 app). It now reads composer.lock and prints `compiled as Laravel 11.x`.

### Added
- `installed` option (documented in the README options table) and the `installedVersionFromComposer()` export.
- Regression tests: the slot-name case and the 11.42-vs-11.43 view-data split.

### Docs
- README: the version table shows the `< 11.43` / `≥ 11.43` split, the Status section reflects the published package.

## [0.1.1] - 2026-10-26

- First npm release, driven by a tag push through CI.

## [0.1.0] - 2026-10-26
> **Renamed** from `blade-js` → `blade2php` (npm name conflict with the existing
> `bladejs` package). The library is unchanged; only the published name, the
> import specifier, and package metadata changed.

First public release.

### Added
- `compile(blade, { laravel, app, path, strict })` — the public API.
  Laravel's BladeCompiler output byte-for-byte (including `e()`, `p()`, echo,
  raw echo, comments, `@verbatim`, directives, class components, anonymous
  components, and `@php`/`@endphp` blocks).
- `BladeCompiler` class mirroring the Laravel compiler's public surface
  (`compileString`, `compileEchos` disabled for parity, the `compileX`
  methods, and the compiler instance the directive substitutions happen on).
- Directives API: `DIRECTIVES`, `hasDirective()`.
- `tokenize()` and `php()` helpers (the PHP tokenizer is independent).
- Component discovery from an app's `resources/views/components` and
  `app/` directories.
- Laravel **10–13** version support via `laravel:` option.
- `xxh3_128`/`componentHash` — xxH128 port used for class component names.
- `setUuidGenerator()` for reproducible UUIDs.
- `BladeCompileError` and `locate()` for precise, code-labelled errors
  (BL001 unknown directive, BL005 unclosed block, etc.).
- Byte-identical verified against real Laravel 13.38.0 via the oracle suite:
  **154/154 cases pass, 0 divergence**.

### Fixed
- Oracle runner accepts MSYS-style paths on Windows (normalizes `/c/...` to
  `C:\...`), so the oracle suite runs from Git Bash too.

### Security
- No runtime code executes user templates: `compile()` is compile-only and
  returns PHP source. Rendering is the consumer's responsibility.

### Deps
- `php-parser` 3.7.0 (used by the PHP tokenizer, not the Blade parser).

### Interop (dev)
- `upstream/` holds the vendored BladeCompiler sources and XXHash v0.8.2 the
  port is derived from — reference material, not build inputs.
- `npm run oracle --app <app>` compares against a real Laravel install.
