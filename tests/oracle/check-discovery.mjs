#!/usr/bin/env node
// tests/oracle/check-discovery.mjs — does static discovery resolve components
// exactly like the real ComponentTagCompiler?
//
//   node tests/oracle/check-discovery.mjs --app <laravel-app-root>
//
// For every name it asks PHP (tests/oracle/resolve.php) and this package
// (src/discovery.mjs) and compares the answer. "Unresolvable" is an answer too:
// both sides must agree that it cannot be located.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverComponents } from '../../src/discovery.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--app');
const appRoot = i >= 0 ? args[i + 1] : process.env.LW_APP_ROOT;
if (!appRoot) { console.error('usage: node check-discovery.mjs --app <app-root>'); process.exit(2); }

const NAMES = [
  'alert', 'forms.input', 'button', 'ui.card', 'card', 'missing',
  'nested::deep.thing', 'my-alert', 'forms.input-x', 'nested::nope',
  'components.alert', 'alert-box', 'ui.nope',
];

const oracle = JSON.parse(execFileSync('php', [join(here, 'resolve.php'), appRoot, ...NAMES], {
  encoding: 'utf8',
}));

const discovery = discoverComponents(appRoot);
let pass = 0, fail = 0;
const failures = [];

for (const name of NAMES) {
  const want = oracle[name];
  const got = discovery.componentClass(name);

  // Normalise both to "a class FQCN" | "a view name" | null.
  const wantNorm = want.error ? null : want.class;
  const gotNorm = got == null ? null : (typeof got === 'string' ? got : (got.class ?? got.view ?? null));

  if (wantNorm === gotNorm) pass++;
  else {
    fail++;
    failures.push({ name, want: wantNorm ?? `(error: ${want.error})`, got: gotNorm ?? '(null)' });
  }
}

for (const f of failures) {
  console.log(`FAIL ${f.name}: oracle=${JSON.stringify(f.want)} discovery=${JSON.stringify(f.got)}`);
}
if (discovery.unresolved.length) {
  console.log(`\nunresolved (reported, not guessed):`);
  for (const u of discovery.unresolved) console.log(`  ${u.file ?? '<app>'}: ${u.reason}`);
}

console.log(`\ndiscovery: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
