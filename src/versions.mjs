// src/versions.mjs — the directive table per Laravel major.
//
// The Blade compiler is not frozen between majors: directives are added, and a
// handful of existing ones change the bytes they emit. This module encodes
// exactly that delta, derived by diffing `Illuminate\View\Compilers\Concerns\*`
// across 10.x / 11.x / 12.x / 13.x (see upstream/versions/).
//
// What actually changed:
//
//   10 → 11   the view-data filter:  Arr::except(get_defined_vars(), [...])
//                                    → array_diff_key(get_defined_vars(), [... => 1])
//             (extends, extendsFirst, include, includeIf, includeWhen,
//              includeUnless, includeFirst)
//             @props rewritten (onlyProps/exceptProps → extractPropNames)
//             @bool added
//   11 → 12   @use rewritten (function/const modifiers, group imports)
//             @pushIf comma handling fixed (explode limit 2 → split-all)
//             @hasStack, @context, @endcontext, @includeIsolated added
//   12 → 13   @elsePushIf comma handling fixed (same change as @pushIf)
//             @fonts added
//
// Everything else is byte-identical across the four majors, so the table shares
// one implementation and only the entries below are swapped.

import * as D from './directives.mjs';

export const VERSIONS = ['10.x', '11.x', '12.x', '13.x'];

/** The default: the newest major this package is written against. */
export const DEFAULT_VERSION = '13.x';

/** Normalise `13`, `13.4`, `^13.0`, `v13.2.1` → `'13.x'`. */
export function normalizeVersion(value) {
  if (value == null) return DEFAULT_VERSION;
  const m = /(\d+)/.exec(String(value));
  if (!m) return DEFAULT_VERSION;
  const major = Number(m[1]);
  if (major < 10 || major > 13) return DEFAULT_VERSION;
  return `${major}.x`;
}

/** The view-data expression passed to make()/first()/renderWhen(). */
const VARS_BY_VERSION = {
  '10.x': "\\Illuminate\\Support\\Arr::except(get_defined_vars(), ['__data', '__path'])",
  '11.x': "array_diff_key(get_defined_vars(), ['__data' => 1, '__path' => 1])",
  '12.x': "array_diff_key(get_defined_vars(), ['__data' => 1, '__path' => 1])",
  '13.x': "array_diff_key(get_defined_vars(), ['__data' => 1, '__path' => 1])",
};

/** Directives that only exist from a given major on. */
const ADDED_IN = {
  '11.x': ['bool'],
  '12.x': ['hasstack', 'context', 'endcontext', 'includeisolated'],
  '13.x': ['fonts'],
};

const BASE_TABLE = D.DIRECTIVES;

/**
 * The directive table for a Laravel major.
 *
 * A directive that does not exist in the requested version is simply absent, so
 * `hasDirective()` answers false and the compiler treats `@fonts` in a Laravel
 * 12 template the way Laravel 12 does: literal text (or `BL001` in strict mode).
 *
 * @param {string} [version]
 * @returns {Map<string, Function>}
 */
export function directivesFor(version = DEFAULT_VERSION) {
  const v = normalizeVersion(version);
  const table = new Map(BASE_TABLE);

  // Remove the directives this version does not have yet.
  for (const [addedIn, names] of Object.entries(ADDED_IN)) {
    if (VERSIONS.indexOf(addedIn) > VERSIONS.indexOf(v)) {
      for (const name of names) table.delete(name);
    }
  }

  // Per-version bodies.
  if (v === '10.x') table.set('props', D.props10);
  if (v === '11.x') table.set('props', D.props11);
  if (v === '10.x' || v === '11.x') {
    // @use gained function/const modifiers and group imports in 12.x.
    table.set('use', D.use_legacy);
  }
  if (v === '10.x' || v === '11.x') {
    // @pushIf / @elsePushIf split the expression with a limit of 2.
    table.set('pushif', (e) => {
      const [cond, stack] = D.pushIfPartsLegacy(e);
      return `<?php if(${cond}): $__env->startPush(${stack}); ?>`;
    });
    table.set('elsepushif', (e) => {
      const [cond, stack] = D.pushIfPartsLegacy(e);
      return `<?php $__env->stopPush(); elseif(${cond}): $__env->startPush(${stack}); ?>`;
    });
  }
  if (v === '12.x') {
    table.set('elsepushif', (e) => {
      const [cond, stack] = D.pushIfPartsLegacy(e);
      return `<?php $__env->stopPush(); elseif(${cond}): $__env->startPush(${stack}); ?>`;
    });
  }

  return table;
}

/** The view-data expression for a version. */
export function varsFor(version = DEFAULT_VERSION) {
  return VARS_BY_VERSION[normalizeVersion(version)];
}

/**
 * Guess the major from a `composer.lock` or `composer.json` object.
 * Answers null when the framework is not pinned there.
 */
export function versionFromComposer(composer) {
  if (!composer || typeof composer !== 'object') return null;
  const packages = [
    ...(Array.isArray(composer.packages) ? composer.packages : []),
    ...(Array.isArray(composer['packages-dev']) ? composer['packages-dev'] : []),
  ];
  const framework = packages.find((p) => p && p.name === 'laravel/framework');
  if (framework) return normalizeVersion(framework.version);

  const req = composer.require?.['laravel/framework'];
  if (typeof req === 'string') return normalizeVersion(req);
  return null;
}

export default { VERSIONS, DEFAULT_VERSION, normalizeVersion, directivesFor, varsFor, versionFromComposer };
