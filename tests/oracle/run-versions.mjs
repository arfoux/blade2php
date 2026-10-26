#!/usr/bin/env node
// tests/oracle/run-versions.mjs — compile the corpus at EVERY Laravel major and
// compare against that major's real BladeCompiler.
//
//   node tests/oracle/run-versions.mjs [--only <id>] [--verbose]
//
// Oracle installs live in tests/oracle/versions/l10|l11|l12 (composer projects
// whose only requirement is laravel/framework); 13.x is the app passed via
// --app13 (or LW_APP_ROOT).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './corpus.mjs';
import { compile } from '../../src/index.mjs';
import { VERSIONS } from '../../src/versions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = get('--only', null);
const verbose = args.includes('--verbose');
const app13 = get('--app13', process.env.LW_APP_ROOT);

const ORACLES = {
  '10.x': join(here, 'versions', 'l10'),
  '11.x': join(here, 'versions', 'l11'),
  '12.x': join(here, 'versions', 'l12'),
};
if (app13) ORACLES['13.x'] = app13;

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const norm = (s) => String(s).replace(uuid, '<UUID>');

const tmp = mkdtempSync(join(tmpdir(), 'blade-vers-'));
let totalPass = 0, totalFail = 0;
const failures = [];
const versionInfo = {};

for (const [version, dir] of Object.entries(ORACLES)) {
  if (!existsSync(join(dir, 'vendor', 'autoload.php'))) {
    console.log(`SKIP ${version}: no oracle at ${dir}`);
    continue;
  }
  // One batch process per version.
  const entries = CORPUS.filter((e) => (!only || e.id === only) && !e.components);
  for (const e of entries) writeFileSync(join(tmp, `${e.id}.blade.php`), e.src);

  const raw = execFileSync('php', [join(here, 'batch-version.php'), dir, tmp], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const oracle = JSON.parse(raw);

  let pass = 0, fail = 0;
  for (const e of entries) {
    const res = oracle[`${e.id}.blade.php`];
    if (!res) continue;
    if (!res.ok) {
      // Laravel threw: our compiler must throw too, for the same template.
      try {
        compile(e.src, { laravel: version });
        fail++;
        failures.push({ version, id: e.id, why: 'Laravel threw but blade2js compiled', expected: res.error, got: '(compiled)' });
      } catch { pass++; }
      continue;
    }
    let mine;
    try {
      mine = compile(e.src, { laravel: version });
    } catch (err) {
      fail++;
      failures.push({ version, id: e.id, why: `blade2js threw: ${err.code ?? err.name}`, expected: res.compiled, got: null });
      continue;
    }
    if (norm(res.compiled) === norm(mine)) pass++;
    else {
      fail++;
      failures.push({ version, id: e.id, why: 'byte mismatch', expected: res.compiled, got: mine });
    }
  }

  // Read the version the oracle actually installed.
  const ver = execFileSync('php', ['-r', `require "${dir.replace(/\\/g, '/')}/vendor/autoload.php"; echo Illuminate\\Foundation\\Application::VERSION;`], { encoding: 'utf8' });
  versionInfo[version] = ver.trim();
  totalPass += pass;
  totalFail += fail;
  console.log(`${version} (${ver.trim()}): ${pass} passed, ${fail} failed`);
  for (const f of entries) rmSync(join(tmp, `${f.id}.blade.php`), { force: true });
}

rmSync(tmp, { recursive: true, force: true });

for (const f of failures.slice(0, verbose ? 40 : 8)) {
  console.log(`\nFAIL [${f.version}] ${f.id} — ${f.why}`);
  console.log('  laravel:  ' + JSON.stringify(f.expected));
  console.log('  blade2js: ' + JSON.stringify(f.got));
}

console.log(`\nTOTAL ${totalPass} passed, ${totalFail} failed`);
console.log('oracle versions: ' + JSON.stringify(versionInfo));
process.exit(totalFail === 0 ? 0 : 1);
