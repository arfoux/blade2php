// tests/components.test.mjs — the `<x-…>` attribute pipeline.
//
// The component tag compiler is a separate precompiler with its own string
// transformations. Each one is pinned here because a wrong intermediate string
// still produces *plausible* PHP, which is the failure mode that hides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShortAttributeSyntax,
  parseAttributeBag,
  parseComponentTagClassStatements,
  parseComponentTagStyleStatements,
  parseBindAttributes,
  getAttributesFromAttributeString,
  attributesToString,
  stripQuotes,
  formatClassName,
  guessViewName,
  createComponentResolver,
} from '../src/components.mjs';
import { BladeCompiler } from '../src/compiler.mjs';
import { compile } from '../src/index.mjs';

const blade = () => new BladeCompiler({});

test('parseShortAttributeSyntax expands :$foo', () => {
  assert.equal(parseShortAttributeSyntax(' :$count'), ' :count="$count"');
});

test('parseAttributeBag turns {{ $attributes }} into a binding', () => {
  assert.equal(parseAttributeBag(' {{ $attributes }}'), ' :attributes="$attributes"');
  assert.equal(
    parseAttributeBag(' {{ $attributes->merge(["class" => "x"]) }}'),
    ' :attributes="$attributes->merge(["class" => "x"])"',
  );
});

test('@class / @style become bindings with Arr::toCss*', () => {
  assert.equal(
    parseComponentTagClassStatements(' @class(["a" => true])'),
    " :class=\"\\Illuminate\\Support\\Arr::toCssClasses(['a' => true])\"",
  );
  assert.equal(
    parseComponentTagStyleStatements(" @style(['color: red'])"),
    ' :style="\\Illuminate\\Support\\Arr::toCssStyles([\'color: red\'])"',
  );
});

test('parseBindAttributes prefixes a single colon', () => {
  assert.equal(parseBindAttributes(' :count=1'), ' bind:count=1');
  // `::` (a raw Alpine-style attribute) is left alone.
  assert.equal(parseBindAttributes(' ::class="x"'), ' ::class="x"');
});

test('stripQuotes removes one pair only', () => {
  assert.equal(stripQuotes('"abc"'), 'abc');
  assert.equal(stripQuotes("'abc'"), 'abc');
  assert.equal(stripQuotes('abc'), 'abc');
});

test('an attribute without a value becomes a bound true', () => {
  const bound = {};
  const attrs = getAttributesFromAttributeString(blade(), ' disabled', bound);
  assert.deepEqual(attrs, { disabled: 'true' });
  assert.deepEqual(bound, { disabled: true });
});

test('a literal attribute is single-quoted', () => {
  const attrs = getAttributesFromAttributeString(blade(), ' type="danger"', {});
  assert.deepEqual(attrs, { type: "'danger'" });
});

test('an echoed attribute becomes concatenation', () => {
  const attrs = getAttributesFromAttributeString(blade(), ' title="{{ $t }}"', {});
  assert.deepEqual(attrs, { title: "''.e($t).''" });
});

test('attributesToString wraps a bound value in sanitizeComponentAttribute', () => {
  const bound = { count: true };
  assert.equal(
    attributesToString({ count: '$n' }, bound, true),
    "'count' => \\Illuminate\\View\\Compilers\\BladeCompiler::sanitizeComponentAttribute($n)",
  );
  // `escapeBound: false` is what the data array uses.
  assert.equal(attributesToString({ count: '$n' }, bound, false), "'count' => $n");
});

test('formatClassName follows Str::camel + ucfirst per dot segment', () => {
  assert.equal(formatClassName('alert'), 'Alert');
  assert.equal(formatClassName('alert-box'), 'AlertBox');
  assert.equal(formatClassName('forms.input'), 'Forms\\Input');
});

test('guessViewName prefixes components.', () => {
  assert.equal(guessViewName('alert'), 'components.alert');
  assert.equal(guessViewName('forms.input'), 'components.forms.input');
});

test('createComponentResolver answers a view it can prove exists', () => {
  const resolve = createComponentResolver({
    viewExists: (name) => name === 'components.alert',
  });
  assert.deepEqual(resolve('alert'), 'components.alert');
  assert.equal(resolve('missing'), null);
});

test('a self-closing tag emits the class-opening block', () => {
  const out = compile('<x-alert type="danger" />', {
    componentClass: () => ({ class: 'App\\View\\Components\\Alert', params: ['type'] }),
  });
  assert.match(out, /App\\View\\Components\\Alert::resolve\(\['type' => 'danger'\] \+/);
  assert.match(out, /withAttributes\(\[\]\)/); // `type` is constructor data, not an attribute
});

test('a non-constructor attribute stays on the attribute bag', () => {
  const out = compile('<x-alert type="danger" id="x" />', {
    componentClass: () => ({ class: 'App\\View\\Components\\Alert', params: ['type'] }),
  });
  assert.match(out, /withAttributes\(\['id' => 'x'\]\)/);
});

test('an anonymous component passes view + data', () => {
  const out = compile('<x-forms.input name="email" />', {
    componentClass: () => ({ view: 'components.forms.input' }),
  });
  assert.match(out, /AnonymousComponent::resolve\(\['view' => 'components\.forms\.input','data' => \['name' => 'email'\]\]/);
});

test('component tags are not compiled when disabled', () => {
  const out = compile('<x-alert />', { componentTags: false });
  assert.equal(out, '<x-alert />');
});

test("the name attribute keeps the slot's name (slot('logo'), not slot('slot'))", () => {
  // Found by laravel-workers' byte-compare against a REAL Laravel 11.34 app
  // (Breeze auth views): `<x-slot name="logo">` compiled as slot('slot'),
  // because the name= group of the regex was non-capturing and never reached
  // nameMatch. Laravel's bytes: $__env->slot('logo', null, []).
  const opts = { componentClass: () => ({ class: 'App\\View\\Components\\A', params: [] }) };
  const out = compile('<x-a><x-slot name="logo">X</x-slot></x-a>', opts);
  assert.match(out, /\$__env->slot\('logo', null, \[\]\)/);
  assert.doesNotMatch(out, /\$__env->slot\('slot'/);

  // The shorthand form already worked and must keep working.
  const short = compile('<x-a><x-slot:heading>X</x-slot:heading></x-a>', opts);
  assert.match(short, /\$__env->slot\('heading', null, \[\]\)/);

  // A default slot (no name) still falls back to 'slot'.
  const plain = compile('<x-a>plain</x-a>', opts);
  assert.doesNotMatch(plain, /\$__env->slot\(/);
});

test('a non-self-closing component tag never swallows content as attributes', () => {
  // Real-app shape (Laravel 11.34 + Breeze-style views): the self-closing
  // pattern used a lazy `[\s\S]*?` with no `>` guard, so `<x-textarea>…</x-textarea>`
  // matched any LATER `/>` in the file and turned every line in between — a
  // body expression, a closing tag, a following @error/span — into attributes
  // (data gained `old`, `body`, `@error`, `span => true` and a class from
  // three lines below).
  const opts = { componentClass: () => ({ view: 'components.textarea' }) };
  const src =
    '<x-textarea id="body" class="block mt-1 w-full" rows="8">{{ old(\'body\') }}</x-textarea>\n' +
    "        @error('body') <span class=\"text-red-500\">{{ $message }}</span> @enderror\n" +
    '        <x-markdown-editor :draft_id="$draft" />\n';
  const out = compile(src, opts);
  assert.match(out, /'class' => 'block mt-1 w-full'/);
  assert.doesNotMatch(out, /'text-red-500'/, 'the span three lines down must not become an attribute');
  assert.doesNotMatch(out, /'@error'\s*=>\s*true/, 'a following directive must not become an attribute');
  assert.match(out, /echo e\(old\('body'\)\)/, 'the body expression survives');
  // The genuinely self-closing tag afterwards still compiles (the stub
  // resolver answers the same view for both components, so the name is the
  // stable signal).
  assert.match(out, /withName\('markdown-editor'\)/);
});

test('raw PHP between attributes leaves the tag byte-identical (oracle: Laravel 11.34.2)', () => {
  // The real compiler does NOT compile a component tag whose attribute region
  // holds an unquoted PHP tag — it passes the whole tag through. Compiling it
  // anyway diverged AND silently dropped the PHP region from the output
  // (measured against blogkit's own framework with tests/oracle/compile.php).
  const opts = { componentClass: () => ({ class: 'App\\View\\Components\\Alert', params: ['id'] }) };
  const cases = [
    '<x-alert id="x" <?php echo $y; ?> />',
    '<x-alert id="x" <?php echo 1; ?> title="t" />',
    '<x-alert id="x" <?= $y ?> />',
  ];
  for (const src of cases) assert.equal(compile(src, opts), src, `byte-identical passthrough: ${src}`);
});
