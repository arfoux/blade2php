// src/index.mjs — the public surface.
//
//   import { compile } from 'blade-js';
//   const php = compile(bladeSource, { path: 'welcome.blade.php' });
//
// `compile()` answers the same PHP bytes as
// `Illuminate\View\Compilers\BladeCompiler::compileString()`. It throws a
// `BladeCompileError` for anything it cannot compile with confidence — never a
// silent pass-through.

export { compile, createCompiler } from './compile.mjs';
export { BladeCompiler } from './compiler.mjs';
export { BladeCompileError, locate } from './errors.mjs';
export { tokenize } from './php.mjs';
export { DIRECTIVES as directives, hasDirective } from './directives.mjs';
export { xxh3_128, componentHash } from './xxh128.mjs';
export { setUuidGenerator } from './str.mjs';
export { discoverComponents } from './discovery.mjs';
export { VERSIONS, DEFAULT_VERSION, normalizeVersion, requireVersion, versionFromComposer } from './versions.mjs';
