// Cross-check XXH3-128 against @node-rs/xxhash (Rust, matches published xxhsum
// vectors). Dev-only: installed with --no-save, never a dependency.
import { xxh3 } from '@node-rs/xxhash';
import { xxh3_128 } from './src/xxh128.mjs';

const mine = (buf) => {
  const { high64, low64 } = xxh3_128(buf);
  return (high64 << 64n) | low64;
};

let bad = 0;
const check = (label, buf) => {
  const a = mine(buf);
  const b = xxh3.xxh128(Buffer.from(buf));
  if (a !== b) {
    bad++;
    if (bad <= 5) console.log('MISMATCH', label, a.toString(16), b.toString(16));
  }
};

for (let n = 0; n <= 700; n++) check(`len ${n}`, new Uint8Array(n).fill(0x61));
for (const s of ['', 'a', 'abc', 'message digest', 'The quick brown fox jumps over the lazy dog']) {
  check(JSON.stringify(s), new TextEncoder().encode(s));
}
check('utf8', new TextEncoder().encode('héllo wörld'));
check('nul', new Uint8Array([0, 1, 2, 0, 255]));

console.log(bad === 0 ? 'OK: every length 0..700 and the literals match @node-rs/xxhash' : `${bad} mismatches`);
process.exit(bad === 0 ? 0 : 1);
