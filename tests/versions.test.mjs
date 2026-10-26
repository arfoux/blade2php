// tests/versions.test.mjs — the compiler answers each Laravel major the way
// THAT major's BladeCompiler does.
//
// The golden file was recorded from four real installs (10.50.3, 11.57.0,
// 12.70.1, 13.38.0). A template Laravel refuses is recorded as null: the
// compiler must throw there too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/index.mjs';
import { VERSIONS, normalizeVersion, requireVersion, versionFromComposer } from '../src/versions.mjs';
import { CORPUS } from './oracle/corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden-versions.json'), 'utf8'));
const byId = new Map(CORPUS.map((c) => [c.id, c]));

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const norm = (s) => String(s).replace(uuid, '<UUID>');

for (const version of VERSIONS) {
  const cases = golden.versions[version];
  assert.ok(cases, `no golden data for ${version}`);

  test(`laravel ${version}: every corpus template`, () => {
    const failures = [];
    for (const [id, expected] of Object.entries(cases)) {
      const entry = byId.get(id);
      if (!entry) continue;

      if (expected === null) {
        // Laravel threw; we must throw.
        assert.throws(
          () => compile(entry.src, { laravel: version }),
          `expected ${version} to refuse ${id}`,
        );
        continue;
      }

      const actual = compile(entry.src, { laravel: version });
      if (norm(actual) !== norm(expected)) failures.push(id);
    }
    assert.deepEqual(failures, [], `mismatched at ${version}`);
  });
}

test('version normalisation', () => {
  assert.equal(normalizeVersion('13'), '13.x');
  assert.equal(normalizeVersion('^12.0'), '12.x');
  assert.equal(normalizeVersion('v11.2.1'), '11.x');
  assert.equal(normalizeVersion('10.50.3'), '10.x');
  assert.equal(normalizeVersion(null), '13.x');
  assert.equal(normalizeVersion('7.0'), '13.x'); // out of range → default
});

test('an explicitly unsupported major is refused, not silently defaulted', () => {
  // The compiler's whole premise is "no silently-wrong output"; picking the
  // 13.x table for a 9.x template would violate it.
  assert.equal(requireVersion(undefined), '13.x');
  assert.equal(requireVersion('12'), '12.x');
  assert.throws(() => requireVersion('9'), /9\.x is not supported/);
  assert.throws(() => requireVersion('14'), /not supported/);
  assert.throws(() => requireVersion('banana'), /cannot read a major/);
  assert.throws(() => compile('{{ $x }}', { laravel: '9' }), /not supported/);
});

test('versionFromComposer reads a lock file', () => {
  assert.equal(versionFromComposer({ packages: [{ name: 'laravel/framework', version: 'v11.57.0' }] }), '11.x');
  assert.equal(versionFromComposer({ require: { 'laravel/framework': '^10.0' } }), '10.x');
  assert.equal(versionFromComposer({}), null);
});

// The four behaviours that actually differ, pinned individually so a regression
// names the directive instead of just "the corpus failed".
test('10.x uses Arr::except for view data; 11+ uses array_diff_key', () => {
  const src = '@include("p")';
  assert.match(compile(src, { laravel: '10' }), /Arr::except\(get_defined_vars\(\), \['__data', '__path'\]\)/);
  assert.match(compile(src, { laravel: '11' }), /array_diff_key\(get_defined_vars\(\), \['__data' => 1, '__path' => 1\]\)/);
});

test('10.x @props uses onlyProps/exceptProps; 11+ uses extractPropNames', () => {
  const src = '@props(["a" => 1])';
  assert.match(compile(src, { laravel: '10' }), /onlyProps/);
  assert.match(compile(src, { laravel: '11' }), /extractPropNames/);
  // 11 unsets only $__defined_vars; 12+ also the loop temporaries.
  assert.match(compile(src, { laravel: '11' }), /unset\(\$__defined_vars\); \?>/);
  assert.match(compile(src, { laravel: '12' }), /unset\(\$__defined_vars, \$__key, \$__value\); \?>/);
});

test('11.x @use has no function/const modifier support; 12+ does', () => {
  assert.equal(compile('@use("App\\Models\\Post")', { laravel: '11' }), '<?php use \\App\\Models\\Post; ?>');
  assert.equal(compile('@use("App\\Models\\Post")', { laravel: '12' }), '<?php use \\App\\Models\\Post; ?>');
  assert.equal(compile('@use("function Foo\\bar")', { laravel: '11' }), '<?php use \\function Foo\\bar; ?>');
  assert.equal(compile('@use("function Foo\\bar")', { laravel: '12' }), '<?php use function \\Foo\\bar; ?>');
});

test('@fonts exists only from 13.x', () => {
  assert.equal(compile('@fonts', { laravel: '12' }), '@fonts'); // literal, like Laravel 12
  assert.match(compile('@fonts', { laravel: '13' }), /Vite'\)->fonts\(\)/);
});

test('@bool exists only from 11.x', () => {
  assert.equal(compile('@bool($a)', { laravel: '10' }), '@bool($a)');
  assert.match(compile('@bool($a)', { laravel: '11' }), /'true' : 'false'/);
});

test('@context / @includeIsolated exist only from 12.x', () => {
  assert.equal(compile('@includeIsolated("p")', { laravel: '11' }), '@includeIsolated("p")');
  assert.match(compile('@includeIsolated("p")', { laravel: '12' }), /\$__env->make\("p"\)->render\(\)/);
});

test('installed version refines 11.x: the view-data filter switched at v11.43.0', () => {
  // Verified against the tags themselves: v11.42.0 compiles Arr::except(),
  // v11.43.0 compiles array_diff_key(). Without the exact version from
  // composer.lock every app pinned below 11.43 gets the wrong bytes on
  // extends + the whole include family (measured: 8 byte failures on a real
  // Laravel 11.34.2 project).
  const before = compile('@include("p")', { laravel: '11', installed: '11.34.2' });
  const atSwitch = compile('@include("p")', { laravel: '11', installed: '11.43.0' });
  const withoutInfo = compile('@include("p")', { laravel: '11' });
  assert.match(before, /Arr::except\(get_defined_vars\(\), \['__data', '__path'\]\)/);
  assert.match(atSwitch, /array_diff_key\(get_defined_vars\(\), \['__data' => 1, '__path' => 1\]\)/);
  assert.equal(atSwitch, withoutInfo); // no exact version -> the major default stands
  assert.match(compile('@extends("layout")', { laravel: '11', installed: '11.42.0' }), /Arr::except/);
  assert.match(compile('@extends("layout")', { laravel: '11', installed: '11.43.0' }), /array_diff_key/);
  // 10.x and 12.x are unaffected by the switch.
  assert.match(compile('@include("p")', { laravel: '10', installed: '10.50.3' }), /Arr::except/);
  assert.match(compile('@include("p")', { laravel: '12', installed: '12.0.0' }), /array_diff_key/);
});
