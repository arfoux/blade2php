// tests/discovery.test.mjs — static component resolution.
//
// `ComponentTagCompiler::componentClass()` needs class_exists(), the view finder
// and the provider registrations. All three are derivable from files, which is
// what makes `compile(src, { app })` possible with no PHP runtime.
//
// The expectations here are the answers the REAL resolver gave for this fixture
// (tests/oracle/check-discovery.mjs verifies the same list against PHP).
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/index.mjs';
import {
  discoverComponents, constructorParams, psr4Roots, bladeRegistrations,
} from '../src/discovery.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, 'fixtures', 'app');

test('psr4Roots reads composer.json', () => {
  const roots = psr4Roots(APP);
  assert.deepEqual([...roots.keys()], ['App\\']);
});

test('constructorParams answers the parameter NAMES', () => {
  const src = `<?php
namespace App\\View\\Components;
class Alert {
    public function __construct(public string $type = 'info', ?int $count = null, bool $on = false) {}
}`;
  assert.deepEqual(constructorParams(src), ['type', 'count', 'on']);
});

test('constructorParams answers [] when there is no constructor', () => {
  assert.deepEqual(constructorParams('<?php class X {}'), []);
});

test('constructorParams reads a non-promoted parameter list', () => {
  const src = `<?php
class X { public function __construct(string $a, int $b = 1) {} }`;
  assert.deepEqual(constructorParams(src), ['a', 'b']);
});

test('bladeRegistrations reads Blade::component / componentNamespace', () => {
  const reg = bladeRegistrations(`<?php
namespace App\\Providers;
use App\\View\\Components\\Alert;
use Illuminate\\Support\\Facades\\Blade;
class P {
    public function boot(): void {
        Blade::component('my-alert', Alert::class);
        Blade::componentNamespace('App\\\\View\\\\Components\\\\Nested', 'nested');
    }
}`);
  assert.deepEqual(reg.aliases, { 'my-alert': { classRef: 'Alert' } });
  assert.deepEqual(reg.namespaces, { nested: 'App\\View\\Components\\Nested' });
});

test('bladeRegistrations reports a non-literal registration instead of guessing', () => {
  const reg = bladeRegistrations(`<?php
class P { public function boot(): void { Blade::component($dynamic, Foo::class); } }`);
  assert.equal(Object.keys(reg.aliases).length, 0);
  assert.equal(reg.unresolved.length, 1);
  assert.match(reg.unresolved[0].reason, /non-literal/);
});

test('discoverComponents finds classes, views, aliases and namespaces', () => {
  const d = discoverComponents(APP);
  assert.ok(d.classes.has('App\\View\\Components\\Alert'));
  assert.ok(d.classes.has('App\\View\\Components\\Forms\\Input'));
  assert.ok(d.classes.has('App\\View\\Components\\Nested\\Deep\\Thing'));
  assert.ok(d.views.has('components.alert'));
  assert.ok(d.views.has('components.ui.card'));
  assert.ok(d.views.has('components.card.index'));
  assert.equal(d.aliases.get('my-alert'), 'App\\View\\Components\\Alert');
  assert.equal(d.namespaces.get('nested'), 'App\\View\\Components\\Nested');
  assert.deepEqual(d.unresolved, []);
});

test('componentClass matches the real resolver for every shape', () => {
  const d = discoverComponents(APP);
  const cases = {
    // conventional class
    alert: 'App\\View\\Components\\Alert',
    // class in a sub-namespace
    'forms.input': 'App\\View\\Components\\Forms\\Input',
    // alias registered with Blade::component()
    'my-alert': 'App\\View\\Components\\Alert',
    // componentNamespace()
    'nested::deep.thing': 'App\\View\\Components\\Nested\\Deep\\Thing',
    // anonymous views
    button: 'components.button',
    'ui.card': 'components.ui.card',
    // the `.index` candidate the framework tries second
    card: 'components.card.index',
    // unresolvable → null (Laravel throws)
    missing: null,
    'ui.nope': null,
  };
  for (const [name, expected] of Object.entries(cases)) {
    const got = d.componentClass(name);
    const norm = got == null ? null : (typeof got === 'string' ? got : (got.class ?? got.view));
    assert.equal(norm, expected, `componentClass(${JSON.stringify(name)})`);
  }
});

test('the class answer carries its constructor parameters (for data/attribute split)', () => {
  const d = discoverComponents(APP);
  const alert = d.componentClass('alert');
  assert.equal(alert.class, 'App\\View\\Components\\Alert');
  assert.deepEqual(alert.params, ['type', 'count', 'disabled']);
});

test('compile({ app }) needs no hand-written resolver', () => {
  const out = compile('<x-alert type="danger" id="x" />', { app: APP });
  // `type` is constructor data; `id` stays an attribute.
  assert.match(out, /Alert::resolve\(\['type' => 'danger'\] \+/);
  assert.match(out, /withAttributes\(\['id' => 'x'\]\)/);
});

test('compile({ app }) resolves an anonymous component', () => {
  // `ui.card` has no class, so it resolves to the view — the anonymous path.
  const out = compile('<x-ui.card title="T" />', { app: APP });
  assert.match(out, /AnonymousComponent::resolve\(\['view' => 'components\.ui\.card','data' => \['title' => 'T'\]\]/);
});

test('a class component wins over an anonymous view of the same name', () => {
  // Both `App\View\Components\Forms\Input` and `components.forms.input`
  // exist; Laravel prefers the class (componentClass() checks class_exists
  // before the view finder), and so does the discovery resolver.
  const out = compile('<x-forms.input name="email" />', { app: APP });
  assert.match(out, /App\\View\\Components\\Forms\\Input::resolve/);
});

test('compile({ app }) still fails loud on an unknown component', () => {
  assert.throws(() => compile('<x-nope />', { app: APP }), (e) => e.code === 'BL004');
});

test('a BL004 hint names the registrations that could not be read', () => {
  // A provider that registers with a non-literal argument: the alias exists at
  // runtime, but no static reader can know it. The refusal must say so, or the
  // operator will look for a typo that is not there.
  const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'blade-unresolved-'));
  mkdirSync(join(dir, 'app', 'Providers'), { recursive: true });
  writeFileSync(join(dir, 'composer.json'), JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'app/' } } }));
  writeFileSync(join(dir, 'app', 'Providers', 'P.php'), `<?php
namespace App\\Providers;
use Illuminate\\Support\\Facades\\Blade;
class P { public function boot(): void { Blade::component($name, Foo::class); } }
`);
  assert.throws(
    () => compile('<x-dynamic />', { app: dir }),
    (e) => e.code === 'BL004' && /could not be read statically/.test(e.hint),
  );
});
