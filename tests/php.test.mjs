// tests/php.test.mjs — the tokenizer split that the whole compiler depends on.
//
// Blade compiles T_INLINE_HTML only; a `{{ }}` inside `<?php ?>` is not an echo
// and an `@if` inside a PHP block is not a directive. That split is the reason
// the compiler is not "a bag of regexes over the whole file".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/php.mjs';

const kinds = (src) => tokenize(src).map((t) => t.kind);

test('plain html is one inline token', () => {
  assert.deepEqual(kinds('<p>hi</p>'), ['inline']);
});

test('a php block splits the html', () => {
  assert.deepEqual(kinds('a<?php echo 1; ?>b'), ['inline', 'php', 'inline']);
});

test('<?= is a php block too', () => {
  assert.deepEqual(kinds('a<?= $x ?>b'), ['inline', 'php', 'inline']);
});

test('?&gt; inside a string does not close the block', () => {
  const src = '<?php $x = "?>"; ?>tail';
  assert.deepEqual(kinds(src), ['php', 'inline']);
  assert.ok(tokenize(src)[0].text.includes('"?>"'));
});

test('?&gt; inside a block comment does not close the block', () => {
  const src = '<?php /* ?> */ $x = 1; ?>tail';
  assert.deepEqual(kinds(src), ['php', 'inline']);
});

test('a php block that never closes runs to the end', () => {
  const src = '<?php echo 1;';
  assert.deepEqual(kinds(src), ['php']);
});

test('`<?phpx` is not an open tag', () => {
  assert.deepEqual(kinds('<?phpx'), ['inline']);
});

test('the compiler does not compile inside a php block', () => {
  // The behavioral consequence, proven end to end in compile.test.mjs.
  assert.deepEqual(kinds('<?php // {{ $x }} ?>'), ['php']);
});
