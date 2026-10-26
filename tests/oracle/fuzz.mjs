#!/usr/bin/env node
// tests/oracle/fuzz.mjs — differential fuzzing against the real BladeCompiler.
//
//   node tests/oracle/fuzz.mjs --app <app-root> [--n 1000] [--seed 1]
//
// Generates random templates from the pieces Blade actually has to handle
// (nested directives, echoes inside attributes, PHP blocks, comments, escaped
// directives) and compares every output byte-for-byte. A divergence found here
// is a divergence the hand-written corpus missed.
//
// Deterministic: the PRNG is seeded, so a failure reproduces exactly.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../src/index.mjs';
import { requireVersion } from '../../src/versions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const appRoot = get('--app', process.env.LW_APP_ROOT);
const components = args.includes('--components');
const laravel = requireVersion(get('--laravel', '13.x'));

// Reject unknown flags: a silently ignored `--laravel 11` would fuzz the wrong
// version and report a green that means nothing.
const KNOWN = new Set(['--app', '--n', '--seed', '--components', '--laravel']);
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (KNOWN.has(a)) { if (a !== '--components') k++; continue; }
  console.error(`unknown argument: ${a}`);
  process.exit(2);
}

// Which install answers for this major? The version oracles are composer
// projects with only laravel/framework; 13.x uses the app.
const ORACLE_DIRS = {
  '10.x': join(here, 'versions', 'l10'),
  '11.x': join(here, 'versions', 'l11'),
  '12.x': join(here, 'versions', 'l12'),
};
const oracleDir = laravel === '13.x' ? appRoot : ORACLE_DIRS[laravel];
if (!oracleDir) { console.error(`no oracle for ${laravel}`); process.exit(2); }
if (components && laravel !== '13.x') {
  console.error('--components needs the 13.x app oracle (the standalone installs have no app)');
  process.exit(2);
}
const n = Number(get('--n', 500));
const seed = Number(get('--seed', 1));
if (!appRoot) { console.error('usage: node fuzz.mjs --app <app-root> [--n N] [--seed S]'); process.exit(2); }

// mulberry32 — small, deterministic, good enough for corpus generation.
function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

const EXPRS = [
  '$x', '$a + $b', '$user->name', 'count($items)', '$a ?? "d"',
  "'lit'", '"dq"', '1 + 2', '$m["k"]', 'route("home")', '$a ? "y" : "n"',
  'config("app.name")', 'now()->year', '$x === null',
];

// Component tags only exist in the component run: the standalone oracle has no
// app, so a template with `<x-…>` makes IT throw, not the compiler under test.
const COMPONENT_LEAVES = [
  () => '<x-alert />',
  () => '<x-alert type="danger" />',
  () => '<x-alert :count="$n" />',
  () => '<x-alert>body</x-alert>',
  () => '<x-alert><x-slot:title>T</x-slot:title>body</x-alert>',
  () => '<x-forms.input name="email" />',
];

function fragment(depth = 0) {
  const leaf = [
    () => `text ${Math.floor(rand() * 100)}`,
    () => `<p class="c">${pick(EXPRS)}</p>`,
    () => `{{ ${pick(EXPRS)} }}`,
    () => `{!! ${pick(EXPRS)} !!}`,
    () => `@{{ ${pick(EXPRS)} }}`,
    () => `{{-- note ${Math.floor(rand() * 10)} --}}`,
    () => `<div title="{{ ${pick(EXPRS)} }}">x</div>`,
    () => `<?php $v = 1; ?>`,
    () => `@php($v = ${Math.floor(rand() * 10)})`,
    () => '@csrf',
    () => `@json(${pick(EXPRS)})`,
    () => `@if(${pick(EXPRS)})\nyes\n@endif`,
    () => `@unless(${pick(EXPRS)})\nno\n@endunless`,
    () => `@foreach($items as $i)\n{{ $i }}\n@endforeach`,
    () => `@forelse($items as $i)\n{{ $i }}\n@empty\nnone\n@endforelse`,
    () => `@for($i = 0; $i < 3; $i++)\n{{ $i }}\n@endfor`,
    () => `@section("s")\nx\n@endsection`,
    () => `@yield("s")`,
    () => `@push("p")\nx\n@endpush`,
    () => `@stack("p")`,
    () => `@auth\nin\n@endauth`,
    () => `@guest\nout\n@endguest`,
    () => `@error("e")\n{{ $message }}\n@enderror`,
    () => `@switch($x)\n@case(1)\na\n@break\n@default\nb\n@endswitch`,
    () => `@once\nx\n@endonce`,
    () => `@verbatim\n{{ raw }}\n@endverbatim`,
    () => `@php\n$y = 2;\n@endphp`,
    () => `@isset($x)\ny\n@endisset`,
    () => `@empty($x)\ne\n@endempty`,
    () => `@include("p.x")`,
    () => `@lang("m.k")`,
    () => `@class(["a" => true])`,
    () => `@checked($x)`,
    () => '@@if',
    () => 'mail@example.com',
  ];
  if (depth < 2 && chance(0.25)) {
    // A nested block: a directive wrapping other fragments.
    const inner = fragment(depth + 1) + (chance(0.5) ? '\n' + fragment(depth + 1) : '');
    const wrap = pick([
      ['@if($a)', '@endif'],
      ['@foreach($items as $i)', '@endforeach'],
      ['@unless($b)', '@endunless'],
      ['@section("n")', '@endsection'],
      ['@push("q")', '@endpush'],
    ]);
    return `${wrap[0]}\n${inner}\n${wrap[1]}`;
  }
  const leaves = components ? [...leaf, ...COMPONENT_LEAVES] : leaf;
  return pick(leaves)();
}

const tmp = mkdtempSync(join(tmpdir(), 'blade-fuzz-'));
const sources = new Map();
for (let i = 0; i < n; i++) {
  const parts = [];
  const count = 1 + Math.floor(rand() * 5);
  for (let k = 0; k < count; k++) parts.push(fragment());
  const src = parts.join(chance(0.5) ? '\n' : ' ');
  const file = `f${String(i).padStart(4, '0')}.blade.php`;
  writeFileSync(join(tmp, file), src);
  sources.set(file, src);
}

const batchArgs = laravel === '13.x'
  ? [join(here, 'batch.php'), appRoot, tmp]
  : [join(here, 'batch-version.php'), oracleDir, tmp];
if (components) batchArgs.push('--components');
const oracleRaw = execFileSync('php', batchArgs, {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});
rmSync(tmp, { recursive: true, force: true });
const oracle = JSON.parse(oracleRaw);

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const norm = (s) => String(s).replace(uuid, '<UUID>');

let pass = 0, fail = 0, skipped = 0;
const failures = [];

for (const [file, src] of sources) {
  const res = oracle[file];
  if (!res || !res.ok) { skipped++; continue; }
  let mine;
  try {
    mine = compile(src, {
      laravel,
      ...(components ? { app: appRoot } : {}),
    });
  } catch (e) {
    fail++;
    failures.push({ file, src, why: `${e.code ?? e.name}: ${e.message}`, expected: res.compiled, got: null });
    continue;
  }
  if (norm(res.compiled) === norm(mine)) pass++;
  else {
    fail++;
    failures.push({ file, src, why: 'byte mismatch', expected: res.compiled, got: mine });
  }
}

for (const f of failures.slice(0, 5)) {
  console.log(`\nFAIL ${f.file} — ${f.why}`);
  console.log('  source:  ' + JSON.stringify(f.src));
  console.log('  laravel: ' + JSON.stringify(f.expected));
  console.log('  blade2js:' + JSON.stringify(f.got));
}

console.log(`\nfuzz [${laravel}]: ${pass} passed, ${fail} failed, ${skipped} skipped (n=${n}, seed=${seed})`);
process.exit(fail === 0 ? 0 : 1);
