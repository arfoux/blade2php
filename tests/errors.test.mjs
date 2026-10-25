// tests/errors.test.mjs — the refusal surface.
//
// A Blade compiler is only trustworthy if the cases it cannot handle are LOUD.
// These tests pin the refusals, not just the successes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.mjs';
import { BladeCompileError } from '../src/errors.mjs';

test('strict mode refuses an unknown directive', () => {
  assert.throws(
    () => compile('@nope', { strict: true }),
    (e) => e instanceof BladeCompileError && e.code === 'BL001' && /@nope/.test(e.message),
  );
});

test('default mode passes an unknown directive through (Laravel parity)', () => {
  // Laravel's compileStatement ends with `return $match[0]`, so `@nope` is
  // literal text. Parity means we do the same; `strict` is the opt-in that
  // turns a typo into a build failure.
  assert.equal(compile('@nope'), '@nope');
  assert.equal(compile('a @endslothi b'), 'a @endslothi b');
});

test('a malformed @foreach is refused, not guessed', () => {
  assert.throws(
    () => compile('@foreach($items)\n@endforeach'),
    (e) => e instanceof BladeCompileError && e.code === 'BL002',
  );
});

test('a malformed @forelse is refused', () => {
  assert.throws(
    () => compile('@forelse($items)\n@empty\n@endforelse'),
    (e) => e instanceof BladeCompileError && e.code === 'BL002',
  );
});

test('an unresolvable component is refused', () => {
  assert.throws(
    () => compile('<x-unknown />'),
    (e) => e instanceof BladeCompileError && e.code === 'BL004' && /x-unknown/.test(e.message),
  );
});

test('the error carries a location and a hint', () => {
  try {
    compile('line one\n@foreach($items)\n@endforeach', { strict: true });
    assert.fail('expected a throw');
  } catch (e) {
    assert.equal(e.code, 'BL002');
    assert.equal(e.line, 2);
    assert.ok(e.hint.length > 0, 'a refusal must say what would fix it');
    assert.match(e.format('a.blade.php'), /^BL002 a\.blade\.php:2:\d+ — /);
  }
});

test('a custom directive that returns nothing is a bug, not a pass-through', () => {
  const customDirective = () => null;
  const customDirectiveNames = new Set(['mine']);
  assert.throws(
    () => compile('@mine', { customDirective, customDirectiveNames }),
    (e) => e instanceof BladeCompileError && e.code === 'BL003',
  );
});

test('a registered custom directive compiles', () => {
  const out = compile('@datetime($x)', {
    customDirective: (name, expr) => (name === 'datetime' ? `<?php echo ${expr}; ?>` : null),
  });
  assert.equal(out, '<?php echo $x; ?>');
});

test('a custom directive without parentheses keeps the following whitespace', () => {
  const out = compile('@marker tail', {
    customDirective: (name) => (name === 'marker' ? '<?php /* m */ ?>' : null),
  });
  assert.equal(out, '<?php /* m */ ?> tail');
});
