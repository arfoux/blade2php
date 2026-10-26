# Changelog

All notable changes to **blade2php** will be documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
