// tests/compile.test.mjs — the golden test: every corpus template must compile
// to the bytes Laravel 13.38.0 / PHP 8.3.30 produced (tests/golden.json,
// recorded by tests/oracle/record.mjs against the real BladeCompiler).
//
// This is the package's primary contract. A regression here means the compiler
// emits PHP Laravel would not, which is exactly the class of bug that makes a
// port useless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/index.mjs';
import { CORPUS } from './oracle/corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden.json'), 'utf8'));

// @once / @pushOnce substitute a fresh UUID; the oracle's differs every run.
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const normalize = (s) => String(s).replace(uuid, '<UUID>');

// The component fixtures the oracle app carries (tests/oracle/fixtures/).
const componentClass = (name) => ({
  alert: { class: 'App\\View\\Components\\Alert', params: ['type', 'count', 'disabled'] },
  'forms.input': { view: 'components.forms.input' },
}[name] ?? null);

const byId = new Map(CORPUS.map((c) => [c.id, c]));

for (const [id, expected] of Object.entries(golden.cases)) {
  test(`golden: ${id}`, () => {
    const entry = byId.get(id);
    assert.ok(entry, `corpus entry ${id} is missing`);
    const actual = compile(entry.src, { componentClass });
    assert.equal(normalize(actual), normalize(expected));
  });
}

test('golden file covers the whole corpus', () => {
  const missing = CORPUS.map((c) => c.id).filter((id) => !(id in golden.cases));
  assert.deepEqual(missing, [], `re-record with: node tests/oracle/record.mjs --app <app>`);
});
