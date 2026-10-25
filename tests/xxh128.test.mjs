// tests/xxh128.test.mjs — XXH3-128 must be the digest PHP's hash('xxh128')
// returns, because Blade embeds it in compiled variable names.
//
// The expected values are the published xxhsum digests (and, for the longer
// inputs, the digests @node-rs/xxhash produced when the port was cross-checked
// over every length 0..700). A merely-unique hash would pass a round-trip test
// and still break byte-parity, so these are pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xxh3_128, componentHash } from '../src/xxh128.mjs';

const hex = (input) => {
  const { high64, low64 } = xxh3_128(input);
  return high64.toString(16).padStart(16, '0') + low64.toString(16).padStart(16, '0');
};

const VECTORS = [
  ['', '99aa06d3014798d86001c324468d497f'],
  ['a', 'a96faf705af16834e6c632b61e964e1f'],
  ['abc', '06b05ab6733a618578af5f94892f3950'],
  ['message digest', '34ab715d95e3b6490abfabecb8e3a424'],
  ['abcdefghijklmnopqrstuvwxyz', 'db7ca44e84843d67ebe162220154e1e6'],
  ['The quick brown fox jumps over the lazy dog', 'ddd650205ca3e7fa24a1cc2e3a8a7651'],
];

for (const [input, expected] of VECTORS) {
  test(`xxh128: ${JSON.stringify(input)}`, () => {
    assert.equal(hex(input), expected);
  });
}

// One vector per length class, so a regression in any branch is caught:
// 0-3, 4-8, 9-16, 17-128, 129-240, >240.
test('xxh128: each length class', () => {
  assert.equal(hex('a'.repeat(16)), 'ff9f5054066830d0245750ddc4828d15');
  assert.equal(hex('a'.repeat(17)), 'c77749c0e343aac52d27c0235c9dd6e1');
  assert.equal(hex('a'.repeat(128)), '134e2a91815f3105ef354c1b9e35d99d');
  assert.equal(hex('a'.repeat(129)), 'a7758bdd09a0b20fd53a57a017f40a2f');
  assert.equal(hex('a'.repeat(240)), '0163721cdafde206ea57d24533760a39');
  assert.equal(hex('a'.repeat(241)), '3e7bebe4a2c07b0bf6cfef5c5aca1930');
});

test('xxh128: hashes bytes, not code points', () => {
  // PHP's hash() is byte-oriented; the same string as UTF-8 bytes must agree.
  const s = 'héllo';
  assert.equal(hex(s), hex(new TextEncoder().encode(s)));
});

test('componentHash renders PHP order (high half first)', () => {
  // Illuminate\View\Compilers\CompilesComponents::newComponentHash.
  assert.equal(componentHash('App\\View\\Components\\Alert'), 'b5e767ad160784309dfcad41e788743b');
  const { high64, low64 } = xxh3_128('App\\View\\Components\\Alert');
  assert.equal(
    componentHash('App\\View\\Components\\Alert'),
    high64.toString(16).padStart(16, '0') + low64.toString(16).padStart(16, '0'),
  );
});
