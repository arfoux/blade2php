import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const VERSIONS = ['10.x', '11.x', '12.x', '13.x'];
const dirFor = (v) => (v === '13.x' ? 'upstream/Compilers' : `upstream/versions/${v}`);
function methods(file) {
  const src = readFileSync(file, 'utf8');
  const out = {};
  const re = /(?:protected|public|private)\s+function\s+(compile\w+)\s*\(([^)]*)\)\s*(?::\s*\w+)?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = re.lastIndex - 1, depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    out[m[1]] = src.slice(m.index, j).replace(/\s+/g, ' ').trim();
  }
  return out;
}
const table = {};
for (const v of VERSIONS) {
  const dir = dirFor(v);
  table[v] = {};
  for (const f of readdirSync(join(dir, 'Concerns'))) Object.assign(table[v], methods(join(dir, 'Concerns', f)));
}
const names = ['compileComponent','compileElsePushIf','compileExtends','compileExtendsFirst','compileForeach','compileForelse','compileInclude','compileIncludeFirst','compileIncludeIf','compileIncludeUnless','compileIncludeWhen','compileProps','compilePushIf','compileUse'];
for (const n of names) {
  console.log('\n=== ' + n + ' ===');
  let prev = null, prevV = null;
  for (const v of VERSIONS) {
    const b = table[v][n];
    if (!b) continue;
    if (prev !== null && b !== prev) {
      console.log(`  --- ${prevV} -> ${v} ---`);
      console.log('  OLD: ' + prev);
      console.log('  NEW: ' + b);
    }
    prev = b; prevV = v;
  }
}
