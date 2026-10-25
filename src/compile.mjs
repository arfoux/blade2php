// src/compile.mjs — the one-shot API.
//
// `compile(source, options)` builds a fresh compiler, compiles, and answers the
// PHP string. The compiler is stateful per template (footers, raw blocks, the
// @switch/@forelse counters), so reusing an instance across templates needs
// `createCompiler()` + `compileString()`; the default path is the safe one.

import { BladeCompiler } from './compiler.mjs';
import { BladeCompileError } from './errors.mjs';

/**
 * @param {string} source the .blade.php contents
 * @param {object} [options] see BladeCompiler
 * @returns {string} compiled PHP
 * @throws {BladeCompileError}
 */
export function compile(source, options = {}) {
  const compiler = new BladeCompiler(options);
  return compiler.compileString(source, { path: options.path ?? null });
}

/**
 * A reusable compiler. Call `compileString()` once per template; the instance
 * resets its per-template state (`footer`, `rawBlocks`, counters) at the start
 * of every call, exactly like the framework's `compileString()` does.
 */
export function createCompiler(options = {}) {
  const compiler = new BladeCompiler(options);
  return {
    compileString: (source, meta = {}) => compiler.compileString(source, meta),
    compiler,
  };
}

export { BladeCompileError };
