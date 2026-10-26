#!/usr/bin/env node
// tests/oracle/run.mjs — byte-compare this compiler against the real Laravel
// BladeCompiler for every corpus entry.
//
//   node tests/oracle/run.mjs --app <laravel-app-root> [--only <id>] [--verbose]
//
// Requires PHP >= 8.3 and a Laravel app with vendor/. Dev-only: this is the
// proof that the port is byte-faithful, not a runtime dependency.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './corpus.mjs';
import { compile } from '../../src/index.mjs';
import { versionFromComposer, installedVersionFromComposer } from '../../src/versions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const appIndex = args.indexOf('--app');
let appRoot = appIndex >= 0 ? args[appIndex + 1] : process.env.LW_APP_ROOT;
// Git Bash / MSYS pass `/c/Users/...` style paths to native Node on Windows,
// and PHP's `is_file`/`require` reject them - convert to the Windows form the
// underlying tools expect (a no-op on POSIX and for already-Windows paths).
if (process.platform === 'win32') {
  appRoot = String(appRoot).replace(/^\/([a-z])\//i, (_, d) => `${d.toUpperCase()}:\\`);
}
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const verbose = args.includes('--verbose');

if (!appRoot) {
  console.error('usage: node tests/oracle/run.mjs --app <laravel-app-root> [--only <id>] [--verbose]');
  process.exit(2);
}

// The oracle compares against THIS app's BladeCompiler, so compile with THIS
// app's Laravel major — the same thing the build passes (composer's require).
// Without it every non-13 app is compiled as 13.x and the byte diff reports
// false failures (measured: 14 false failures on a Laravel 11.34 app).
let appMajor = process.env.LW_LARAVEL || null;
let appInstalled = null;
try {
  const composerObj = JSON.parse(readFileSync(join(appRoot, 'composer.lock'), 'utf8'));
  appInstalled = installedVersionFromComposer(composerObj);
  if (!appMajor) appMajor = versionFromComposer(composerObj);
} catch { /* no lock: fall back to the default major below */ }

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
    // Component resolution comes from the app itself (static discovery), the
    // same way a real build does it — no hand-maintained map to drift.
    mine = compile(entry.src, {
      ...(entry.components ? { app: appRoot } : {}),
      ...(appMajor ? { laravel: appMajor } : {}),
      ...(appInstalled ? { installed: appInstalled } : {}),
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
  console.log('  blade2php: ' + JSON.stringify(f.got));
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (compiled as Laravel ${appMajor ?? 'unknown'}, oracle = this app's own compiler)`);
process.exit(fail === 0 ? 0 : 1);
