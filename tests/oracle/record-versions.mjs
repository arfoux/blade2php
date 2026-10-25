#!/usr/bin/env node
// tests/oracle/record-versions.mjs — record the corpus compiled by each
// Laravel major into tests/golden-versions.json.
//
//   node tests/oracle/record-versions.mjs [--app13 <app-root>]
//
// The oracle installs live in tests/oracle/versions/l10|l11|l12; 13.x uses the
// app passed via --app13 (or LW_APP_ROOT) because it needs a full app for the
// component fixtures.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--app13');
const app13 = i >= 0 ? args[i + 1] : process.env.LW_APP_ROOT;

const ORACLES = {
  '10.x': join(here, 'versions', 'l10'),
  '11.x': join(here, 'versions', 'l11'),
  '12.x': join(here, 'versions', 'l12'),
};
if (app13) ORACLES['13.x'] = app13;

const out = { meta: {}, versions: {} };
const tmp = mkdtempSync(join(tmpdir(), 'blade-recordv-'));

for (const [version, dir] of Object.entries(ORACLES)) {
  if (!existsSync(join(dir, 'vendor', 'autoload.php'))) {
    console.error(`skip ${version}: no oracle at ${dir}`);
    continue;
  }
  const entries = CORPUS.filter((e) => !e.components);
  for (const e of entries) writeFileSync(join(tmp, `${e.id}.blade.php`), e.src);

  const raw = execFileSync('php', [join(here, 'batch-version.php'), dir, tmp], {
    encoding: 'utf8', maxBuffer: 1 << 28,
  });
  const oracle = JSON.parse(raw);

  const cases = {};
  for (const e of entries) {
    const res = oracle[`${e.id}.blade.php`];
    if (!res) continue;
    // A template Laravel refuses is recorded as null: the compiler must throw.
    cases[e.id] = res.ok ? res.compiled : null;
  }

  const ver = execFileSync('php', ['-r', `require "${dir.replace(/\\/g, '/')}/vendor/autoload.php"; echo Illuminate\\Foundation\\Application::VERSION;`], { encoding: 'utf8' }).trim();
  out.versions[version] = cases;
  out.meta[version] = { laravel: ver };
  console.log(`${version} (${ver}): ${Object.keys(cases).length} cases`);

  for (const e of entries) rmSync(join(tmp, `${e.id}.blade.php`), { force: true });
}

rmSync(tmp, { recursive: true, force: true });
out.meta.recorded = new Date().toISOString();
const target = join(here, '..', 'golden-versions.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', target);
