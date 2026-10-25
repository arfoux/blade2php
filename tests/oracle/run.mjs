#!/usr/bin/env node
// tests/oracle/run.mjs — byte-compare this compiler against the real Laravel
// BladeCompiler for every corpus entry.
//
//   node tests/oracle/run.mjs --app <laravel-app-root> [--only <id>] [--verbose]
//
// Requires PHP >= 8.3 and a Laravel app with vendor/. Dev-only: this is the
// proof that the port is byte-faithful, not a runtime dependency.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './corpus.mjs';
import { compile } from '../../src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const appIndex = args.indexOf('--app');
const appRoot = appIndex >= 0 ? args[appIndex + 1] : process.env.LW_APP_ROOT;
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const verbose = args.includes('--verbose');

if (!appRoot) {
  console.error('usage: node tests/oracle/run.mjs --app <laravel-app-root> [--only <id>] [--verbose]');
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'blade-oracle-'));
const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const normalize = (s) => String(s).replace(uuidRe, '<UUID>');

function phpCompile(id, src, components) {
  const file = join(tmp, `${id}.blade.php`);
  writeFileSync(file, src);
  const argv = [join(here, 'compile.php'), appRoot, file];
  if (components) argv.push('--components');
  const out = execFileSync('php', argv, { encoding: 'utf8' });
  return JSON.parse(out);
}

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

for (const entry of CORPUS) {
  if (only && entry.id !== only) continue;

  let oracle;
  try {
    oracle = phpCompile(entry.id, entry.src, entry.components);
  } catch (e) {
    skip++;
    if (verbose) console.log(`SKIP ${entry.id}: oracle failed — ${String(e.stderr || e.message).slice(0, 200)}`);
    continue;
  }
  if (!oracle.ok) {
    skip++;
    if (verbose) console.log(`SKIP ${entry.id}: Laravel threw — ${oracle.error}`);
    continue;
  }

  let mine;
  try {
    mine = compile(entry.src, {
      componentClass: (name) => {
        // The oracle app's component map, kept in sync with the fixture.
        const map = {
          alert: { class: 'App\\View\\Components\\Alert', params: ['type', 'count', 'disabled'] },
          'forms.input': { view: 'components.forms.input' },
        };
        return map[name] ?? null;
      },
    });
  } catch (e) {
    // An unknown directive is a DELIBERATE refusal (Laravel passes it through).
    if (entry.unknown && e.code === 'BL001') { pass++; continue; }
    fail++;
    failures.push({ id: entry.id, why: `${e.code ?? e.name}: ${e.message}`, expected: oracle.compiled, got: null });
    continue;
  }

  const a = normalize(oracle.compiled);
  const b = normalize(mine);
  if (a === b) { pass++; continue; }

  fail++;
  failures.push({ id: entry.id, why: 'byte mismatch', expected: a, got: b });
}

rmSync(tmp, { recursive: true, force: true });

for (const f of failures) {
  console.log(`\nFAIL ${f.id} — ${f.why}`);
  console.log('  laravel: ' + JSON.stringify(f.expected));
  console.log('  blade-js: ' + JSON.stringify(f.got));
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (Laravel version: ${process.env.LW_LARAVEL ?? 'see oracle'})`);
process.exit(fail === 0 ? 0 : 1);
