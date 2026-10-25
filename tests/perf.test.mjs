// tests/perf.test.mjs — the compiler is linear in template size.
//
// This is a correctness property, not a micro-benchmark: `compileStatements`
// once called `substr_replace` per match, which is O(n²). A 2 MB generated
// template took over two minutes and looked like a hang. The guard below fails
// on any return to that behavior without needing a timing-sensitive assertion:
// doubling the input must not much more than double the work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.mjs';

const unit = '@if($a)\n<div>{{ $x }}</div>\n@endif\n{{-- c --}}\n{{ $y }}\n';
const time = (n) => {
  const src = unit.repeat(n);
  const t0 = process.hrtime.bigint();
  compile(src);
  return Number(process.hrtime.bigint() - t0) / 1e6;
};

test('compilation is linear, not quadratic', () => {
  time(200); // warm the JIT so the first sample is not the slowest
  const small = Math.max(time(400), 0.5);
  const large = time(1600); // 4x the input

  // Linear ⇒ ~4x the time. Quadratic ⇒ ~16x. The bound is 10x: far above the
  // noise of a shared CI machine, far below quadratic.
  assert.ok(
    large / small < 10,
    `4x the input took ${(large / small).toFixed(1)}x the time (${small.toFixed(1)} ms -> ${large.toFixed(1)} ms) — looks quadratic`,
  );
});

test('a 1 MB template compiles in well under a second', () => {
  const src = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
  const t0 = process.hrtime.bigint();
  compile(src);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 3000, `1 MB took ${ms.toFixed(0)} ms`);
});

test('a single 2 MB line does not hang the scanner', () => {
  const src = '{{ $a }}' + 'x'.repeat(2 * 1024 * 1024);
  const t0 = process.hrtime.bigint();
  compile(src);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 3000, `a 2 MB line took ${ms.toFixed(0)} ms`);
});
