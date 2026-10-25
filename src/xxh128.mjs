// src/xxh128.mjs — XXH3-128 (a.k.a. XXH128), the hash PHP's
// `hash('xxh128', …)` computes.
//
// Blade embeds this digest in the VARIABLE NAMES of a class component's
// compiled PHP (`$__componentOriginal<32 hex>`), so it must be byte-identical,
// not merely unique.
//
// This is a direct port of xxHash v0.8.2 (upstream/xxhash_v0.8.2.h):
//   XXH3_len_0to16_128b / _1to3 / _4to8 / _9to16
//   XXH3_len_17to128_128b / XXH3_len_129to240_128b
//   XXH3_hashLong_128b_internal (+ accumulate_512, scrambleAcc, mergeAccs)
//
// Every function below keeps the reference's name so a reader can diff it
// against the C. Verified against @node-rs/xxhash (a Rust port that matches the
// published xxhsum vectors) for every input length 0..700 in xxcheck.mjs.

// ---- constants -------------------------------------------------------------
const PRIME32_1 = 0x9E3779B1n;
const PRIME32_2 = 0x85EBCA77n;
const PRIME32_3 = 0xC2B2AE3Dn;

const PRIME64_1 = 0x9E3779B185EBCA87n;
const PRIME64_2 = 0xC2B2AE3D27D4EB4Fn;
const PRIME64_3 = 0x165667B19E3779F9n;
const PRIME64_4 = 0x85EBCA77C2B2AE63n;
const PRIME64_5 = 0x27D4EB2F165667C5n;

const PRIME_MX1 = 0x165667919E3779F9n;
const PRIME_MX2 = 0x9FB21C651E98DF25n;

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const MASK32 = 0xFFFFFFFFn;

// XXH3_kSecret — 192 bytes (XXH_SECRET_DEFAULT_SIZE).
const kSecret = Uint8Array.from([
  0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c,
  0xf7, 0x21, 0xad, 0x1c, 0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb,
  0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f, 0xcb, 0x79, 0xe6, 0x4e,
  0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
  0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6,
  0x81, 0x3a, 0x26, 0x4c, 0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb,
  0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3, 0x71, 0x64, 0x48, 0x97,
  0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
  0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7,
  0xc7, 0x0b, 0x4f, 0x1d, 0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31,
  0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64, 0xea, 0xc5, 0xac, 0x83,
  0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
  0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26,
  0x29, 0xd4, 0x68, 0x9e, 0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc,
  0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce, 0x45, 0xcb, 0x3a, 0x8f,
  0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e,
]);

const SECRET_SIZE = kSecret.length; // 192
const STRIPE_LEN = 64;
const ACC_NB = 8;
const SECRET_CONSUME_RATE = 8;
const SECRET_LASTACC_START = 7;
const SECRET_MERGEACCS_START = 11;
const MIDSIZE_MAX = 240;
const SECRET_SIZE_MIN = 136; // XXH3_SECRET_SIZE_MIN
const MIDSIZE_STARTOFFSET = 3;
const MIDSIZE_LASTOFFSET = 17;

// ---- byte readers (little-endian, like XXH_readLE*) -------------------------
const encoder = new TextEncoder();
const toBytes = (input) => (typeof input === 'string' ? encoder.encode(input) : Uint8Array.from(input));

const readLE32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const readLE64 = (b, i) => {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b[i + k]);
  return v;
};

// ---- 64-bit arithmetic -----------------------------------------------------
const add64 = (a, b) => (a + b) & MASK64;
const sub64 = (a, b) => (a - b) & MASK64;
const mul64 = (a, b) => (a * b) & MASK64;
const xor64 = (a, b) => (a ^ b) & MASK64;
const xorshift64 = (v, shift) => xor64(v, v >> shift);

/** XXH_mult64to128: the low and high halves of the 128-bit product. */
function mult64to128(lhs, rhs) {
  const p = lhs * rhs;
  return { low64: p & MASK64, high64: (p >> 64n) & MASK64 };
}

/** XXH3_mul128_fold64. */
const mul128Fold64 = (lhs, rhs) => {
  const p = mult64to128(lhs, rhs);
  return xor64(p.low64, p.high64);
};

/** XXH_mult32to64: `(x & 0xFFFFFFFF) * (y & 0xFFFFFFFF)`. */
const mult32to64 = (x, y) => ((x & MASK32) * (y & MASK32)) & MASK64;

const swap64 = (v) => {
  let r = 0n;
  for (let k = 0; k < 8; k++) r = (r << 8n) | ((v >> BigInt(8 * k)) & 0xFFn);
  return r;
};

const swap32 = (v) => (((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | (v >>> 24)) >>> 0;
const rotl32 = (v, r) => ((v << r) | (v >>> (32 - r))) >>> 0;

/** XXH3_avalanche. */
function XXH3_avalanche(h) {
  h = xorshift64(h, 37n);
  h = mul64(h, PRIME_MX1);
  return xorshift64(h, 32n);
}

/** XXH64_avalanche. */
function XXH64_avalanche(h) {
  h = xorshift64(h, 33n);
  h = mul64(h, PRIME64_2);
  h = xorshift64(h, 29n);
  h = mul64(h, PRIME64_3);
  return xorshift64(h, 32n);
}

/** XXH3_mix16B. */
function mix16B(input, inputOff, secret, secretOff, seed) {
  const inputLo = readLE64(input, inputOff);
  const inputHi = readLE64(input, inputOff + 8);
  return mul128Fold64(
    xor64(inputLo, add64(readLE64(secret, secretOff), seed)),
    xor64(inputHi, sub64(readLE64(secret, secretOff + 8), seed)),
  );
}

/** XXH128_mix32B — the 128-bit mid-range round (NOT two mix16B adds). */
function mix32B(acc, input, i1, i2, secret, si, seed) {
  acc.low64 = add64(acc.low64, mix16B(input, i1, secret, si, seed));
  acc.low64 = xor64(acc.low64, add64(readLE64(input, i2), readLE64(input, i2 + 8)));
  acc.high64 = add64(acc.high64, mix16B(input, i2, secret, si + 16, seed));
  acc.high64 = xor64(acc.high64, add64(readLE64(input, i1), readLE64(input, i1 + 8)));
  return acc;
}

// ---- 0..16 bytes -----------------------------------------------------------
function len0to16_128b(input, seed) {
  const len = input.length;
  if (len > 8) return len9to16_128b(input, seed);
  if (len >= 4) return len4to8_128b(input, seed);
  if (len) return len1to3_128b(input, seed);

  // XXH3_len_0to16_128b, len == 0
  const bitflipl = xor64(readLE64(kSecret, 64), readLE64(kSecret, 72));
  const bitfliph = xor64(readLE64(kSecret, 80), readLE64(kSecret, 88));
  return {
    low64: XXH64_avalanche(xor64(seed, bitflipl)),
    high64: XXH64_avalanche(xor64(seed, bitfliph)),
  };
}

function len1to3_128b(input, seed) {
  const len = input.length;
  const c1 = input[0];
  const c2 = input[len >> 1];
  const c3 = input[len - 1];
  const combinedl = ((c1 << 16) | (c2 << 24) | (c3 << 0) | (len << 8)) >>> 0;
  const combinedh = rotl32(swap32(combinedl), 13);
  const bitflipl = add64(BigInt(xor32(readLE32(kSecret, 0), readLE32(kSecret, 4))), seed);
  const bitfliph = sub64(BigInt(xor32(readLE32(kSecret, 8), readLE32(kSecret, 12))), seed);
  return {
    low64: XXH64_avalanche(xor64(BigInt(combinedl), bitflipl)),
    high64: XXH64_avalanche(xor64(BigInt(combinedh), bitfliph)),
  };
}

const xor32 = (a, b) => (a ^ b) >>> 0;

function len4to8_128b(input, seed) {
  const len = input.length;
  // seed ^= (xxh_u64)XXH_swap32((xxh_u32)seed) << 32;
  const seed32 = Number(seed & MASK32) >>> 0;
  seed = xor64(seed, BigInt(swap32(seed32)) << 32n);

  const inputLo = BigInt(readLE32(input, 0));
  const inputHi = BigInt(readLE32(input, len - 4));
  const input64 = add64(inputLo, inputHi << 32n);
  const bitflip = add64(xor64(readLE64(kSecret, 16), readLE64(kSecret, 24)), seed);
  const keyed = xor64(input64, bitflip);

  const m = mult64to128(keyed, add64(PRIME64_1, BigInt(len << 2)));
  m.high64 = add64(m.high64, (m.low64 << 1n) & MASK64);
  m.low64 = xor64(m.low64, m.high64 >> 3n);
  m.low64 = xorshift64(m.low64, 35n);
  m.low64 = mul64(m.low64, PRIME_MX2);
  m.low64 = xorshift64(m.low64, 28n);
  m.high64 = XXH3_avalanche(m.high64);
  return { low64: m.low64, high64: m.high64 };
}

function len9to16_128b(input, seed) {
  const len = input.length;
  const bitflipl = sub64(xor64(readLE64(kSecret, 32), readLE64(kSecret, 40)), seed);
  const bitfliph = add64(xor64(readLE64(kSecret, 48), readLE64(kSecret, 56)), seed);

  const inputLo = readLE64(input, 0);
  let inputHi = readLE64(input, len - 8);

  const m = mult64to128(xor64(xor64(inputLo, inputHi), bitflipl), PRIME64_1);
  m.low64 = add64(m.low64, BigInt(len - 1) << 54n);

  inputHi = xor64(inputHi, bitfliph);
  // m128.high64 += input_hi + XXH_mult32to64((xxh_u32)input_hi, XXH_PRIME32_2 - 1);
  m.high64 = add64(m.high64, add64(inputHi, mult32to64(inputHi & MASK32, PRIME32_2 - 1n)));

  m.low64 = xor64(m.low64, swap64(m.high64));

  const h = mult64to128(m.low64, PRIME64_2);
  h.high64 = add64(h.high64, mul64(m.high64, PRIME64_2));
  h.low64 = XXH3_avalanche(h.low64);
  h.high64 = XXH3_avalanche(h.high64);
  return { low64: h.low64, high64: h.high64 };
}

// ---- 17..128 bytes ---------------------------------------------------------
function len17to128_128b(input, seed) {
  const len = input.length;
  const acc = { low64: mul64(BigInt(len), PRIME64_1), high64: 0n };

  if (len > 32) {
    if (len > 64) {
      if (len > 96) {
        mix32B(acc, input, 48, len - 64, kSecret, 96, seed);
      }
      mix32B(acc, input, 32, len - 48, kSecret, 64, seed);
    }
    mix32B(acc, input, 16, len - 32, kSecret, 32, seed);
  }
  mix32B(acc, input, 0, len - 16, kSecret, 0, seed);
  return finalize128(acc, len, seed);
}

/** The shared tail of the 17-128 and 129-240 paths. */
function finalize128(acc, len, seed) {
  let low = add64(acc.low64, acc.high64);
  let high = add64(
    add64(mul64(acc.low64, PRIME64_1), mul64(acc.high64, PRIME64_4)),
    mul64(sub64(BigInt(len), seed), PRIME64_2),
  );
  low = XXH3_avalanche(low);
  high = sub64(0n, XXH3_avalanche(high));
  return { low64: low, high64: high };
}

// ---- 129..240 bytes --------------------------------------------------------
function len129to240_128b(input, seed) {
  const len = input.length;
  const acc = { low64: mul64(BigInt(len), PRIME64_1), high64: 0n };

  for (let i = 32; i < 160; i += 32) {
    mix32B(acc, input, i - 32, i - 16, kSecret, i - 32, seed);
  }
  acc.low64 = XXH3_avalanche(acc.low64);
  acc.high64 = XXH3_avalanche(acc.high64);

  // `i <= len` intentionally duplicates the last 32 bytes when len % 32 == 0.
  for (let i = 160; i <= len; i += 32) {
    mix32B(acc, input, i - 32, i - 16, kSecret, MIDSIZE_STARTOFFSET + i - 160, seed);
  }
  // last bytes
  mix32B(
    acc,
    input,
    len - 16,
    len - 32,
    kSecret,
    SECRET_SIZE_MIN - MIDSIZE_LASTOFFSET - 16,
    sub64(0n, seed),
  );
  return finalize128(acc, len, seed);
}

// ---- >240 bytes ------------------------------------------------------------
const INIT_ACC = () => [
  PRIME32_3, PRIME64_1, PRIME64_2, PRIME64_3,
  PRIME64_4, PRIME32_2, PRIME64_5, PRIME32_1,
];

/** XXH3_accumulate_512_scalar. */
function accumulate512(acc, input, inputOff, secret, secretOff) {
  for (let lane = 0; lane < ACC_NB; lane++) {
    const dataVal = readLE64(input, inputOff + lane * 8);
    const dataKey = xor64(dataVal, readLE64(secret, secretOff + lane * 8));
    acc[lane ^ 1] = add64(acc[lane ^ 1], dataVal);
    acc[lane] = add64(acc[lane], mult32to64(dataKey & MASK32, dataKey >> 32n));
  }
}

/** XXH3_scrambleAcc_scalar. */
function scrambleAcc(acc, secret, secretOff) {
  for (let lane = 0; lane < ACC_NB; lane++) {
    let v = acc[lane];
    v = xorshift64(v, 47n);
    v = xor64(v, readLE64(secret, secretOff + lane * 8));
    acc[lane] = mul64(v, PRIME32_1);
  }
}

/** XXH3_accumulate (n stripes). */
function accumulate(acc, input, inputOff, secret, secretOff, nbStripes) {
  for (let n = 0; n < nbStripes; n++) {
    accumulate512(acc, input, inputOff + n * STRIPE_LEN, secret, secretOff + n * SECRET_CONSUME_RATE);
  }
}

/** XXH3_mix2Accs. */
const mix2Accs = (acc, i, secret, si) =>
  mul128Fold64(xor64(acc[i], readLE64(secret, si)), xor64(acc[i + 1], readLE64(secret, si + 8)));

/** XXH3_mergeAccs. */
function mergeAccs(acc, secretOff, start) {
  let result = start;
  for (let i = 0; i < 4; i++) {
    result = add64(result, mix2Accs(acc, 2 * i, kSecret, secretOff + 16 * i));
  }
  return XXH3_avalanche(result);
}

function hashLong128b(input) {
  const len = input.length;
  const acc = INIT_ACC();
  const nbStripesPerBlock = Math.floor((SECRET_SIZE - STRIPE_LEN) / SECRET_CONSUME_RATE);
  const blockLen = STRIPE_LEN * nbStripesPerBlock;
  const nbBlocks = Math.floor((len - 1) / blockLen);

  for (let n = 0; n < nbBlocks; n++) {
    accumulate(acc, input, n * blockLen, kSecret, 0, nbStripesPerBlock);
    scrambleAcc(acc, kSecret, SECRET_SIZE - STRIPE_LEN);
  }

  const nbStripes = Math.floor((len - 1 - blockLen * nbBlocks) / STRIPE_LEN);
  accumulate(acc, input, nbBlocks * blockLen, kSecret, 0, nbStripes);

  // last stripe
  accumulate512(acc, input, len - STRIPE_LEN, kSecret, SECRET_SIZE - STRIPE_LEN - SECRET_LASTACC_START);

  return {
    low64: mergeAccs(acc, SECRET_MERGEACCS_START, mul64(BigInt(len), PRIME64_1)),
    high64: mergeAccs(
      acc,
      SECRET_SIZE - ACC_NB * 8 - SECRET_MERGEACCS_START,
      (~mul64(BigInt(len), PRIME64_2)) & MASK64,
    ),
  };
}

// ---- public ----------------------------------------------------------------
/**
 * XXH3-128. `{low64, high64}` are the two halves.
 * @param {string|Uint8Array} input
 * @param {number|bigint} [seedValue]
 */
export function xxh3_128(input, seedValue = 0) {
  const bytes = toBytes(input);
  const seed = BigInt(seedValue) & MASK64;
  const len = bytes.length;

  if (len <= 16) return len0to16_128b(bytes, seed);
  if (len <= 128) return len17to128_128b(bytes, seed);
  if (len <= MIDSIZE_MAX) return len129to240_128b(bytes, seed);
  return hashLong128b(bytes);
}

const hex64 = (v) => v.toString(16).padStart(16, '0');

/**
 * `hash('xxh128', value)` as PHP renders it: lowercase hex, HIGH half first.
 */
export function componentHash(value) {
  const { low64, high64 } = xxh3_128(String(value));
  return hex64(high64) + hex64(low64);
}

export default { xxh3_128, componentHash };
