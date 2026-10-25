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
