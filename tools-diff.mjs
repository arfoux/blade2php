import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const VERSIONS = ['10.x', '11.x', '12.x', '13.x'];
const dirFor = (v) => (v === '13.x' ? 'upstream/Compilers' : `upstream/versions/${v}`);

// Extract `function compileX(...) { ... }` bodies (brace-balanced).
function methods(file) {
  const src = readFileSync(file, 'utf8');
  const out = {};
  const re = /(?:protected|public|private)\s+function\s+(compile\w+)\s*\(([^)]*)\)\s*(?::\s*\w+)?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = re.lastIndex - 1;
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    out[m[1]] = src.slice(m.index, j).replace(/\s+/g, ' ').trim();
  }
  return out;
}

function allMethods(v) {
  const dir = dirFor(v);
  const out = {};
  for (const f of readdirSync(join(dir, 'Concerns'))) {
    Object.assign(out, methods(join(dir, 'Concerns', f)));
  }
  return out;
}

const table = {};
for (const v of VERSIONS) table[v] = allMethods(v);

const allNames = new Set();
for (const v of VERSIONS) for (const n of Object.keys(table[v])) allNames.add(n);

console.log('method count per version:');
for (const v of VERSIONS) console.log('  ', v, Object.keys(table[v]).length);

console.log('\nmethods ADDED per version (vs previous):');
for (let i = 1; i < VERSIONS.length; i++) {
  const prev = VERSIONS[i - 1], cur = VERSIONS[i];
  const added = Object.keys(table[cur]).filter((n) => !(n in table[prev]));
  console.log(`  ${prev} -> ${cur}: ${added.length ? added.join(', ') : '(none)'}`);
}

console.log('\nmethods REMOVED per version:');
for (let i = 1; i < VERSIONS.length; i++) {
  const prev = VERSIONS[i - 1], cur = VERSIONS[i];
  const removed = Object.keys(table[prev]).filter((n) => !(n in table[cur]));
  console.log(`  ${prev} -> ${cur}: ${removed.length ? removed.join(', ') : '(none)'}`);
}

console.log('\nmethods whose BODY changed across versions:');
let changed = 0;
for (const n of [...allNames].sort()) {
  const bodies = VERSIONS.map((v) => table[v][n]).filter(Boolean);
  if (bodies.length < 2) continue;
  if (new Set(bodies).size > 1) {
    changed++;
    const which = VERSIONS.filter((v) => table[v][n]).map((v) => v).join('/');
    console.log(`  ${n}  [${which}]`);
  }
}
console.log(`\ntotal changed: ${changed} of ${allNames.size}`);
