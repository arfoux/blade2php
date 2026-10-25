#!/usr/bin/env node
// tests/oracle/record.mjs — run the PHP oracle and write tests/golden.json.
//
// The golden file is what the unit tests compare against, so `npm test` needs
// no PHP. Re-record only when the corpus or the target Laravel changes:
//
//   node tests/oracle/record.mjs --app <laravel-app-root>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const appIndex = args.indexOf('--app');
const appRoot = appIndex >= 0 ? args[appIndex + 1] : process.env.LW_APP_ROOT;
if (!appRoot) { console.error('usage: node record.mjs --app <app-root>'); process.exit(2); }

const tmp = mkdtempSync(join(tmpdir(), 'blade-record-'));
const out = { meta: {}, cases: {} };

for (const entry of CORPUS) {
  const file = join(tmp, `${entry.id}.blade.php`);
  writeFileSync(file, entry.src);
  const argv = [join(here, 'compile.php'), appRoot, file];
  if (entry.components) argv.push('--components');
  let res;
  try {
    res = JSON.parse(execFileSync('php', argv, { encoding: 'utf8' }));
  } catch (e) {
    console.error(`skip ${entry.id}: ${String(e.stderr || e.message).slice(0, 120)}`);
    continue;
  }
  if (!res.ok) { console.error(`skip ${entry.id}: ${res.error}`); continue; }
  out.meta = { laravel: res.laravel, php: res.php, recorded: new Date().toISOString() };
  out.cases[entry.id] = res.compiled;
}

rmSync(tmp, { recursive: true, force: true });
const target = join(here, '..', 'golden.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${target} (${Object.keys(out.cases).length} cases, Laravel ${out.meta.laravel}, PHP ${out.meta.php})`);
