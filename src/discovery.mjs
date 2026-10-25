// src/discovery.mjs — resolve `<x-…>` components by READING the app, not by
// running it.
//
// `ComponentTagCompiler::componentClass()` needs three things PHP gets for free:
// `class_exists()`, the view finder's `exists()`, and the aliases/namespaces
// registered by service providers. All three are derivable from files:
//
//   class_exists('App\View\Components\Alert')
//     ← app/View/Components/Alert.php exists (PSR-4 from composer.json)
//   $viewFactory->exists('components.alert')
//     ← resources/views/components/alert.blade.php exists
//   Blade::component('alert', Alert::class)
//     ← the literal call in a provider's boot()
//
// The result is a `componentClass(name)` the compiler can use with no PHP
// runtime, which is what removes the last "you must supply a resolver" caveat.
//
// Anything that cannot be decided from files is reported, never guessed: a
// component registered inside a loop, or a namespace assembled at runtime, lands
// in `unresolved` so the caller can fail loudly.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import parser from 'php-parser';

const phpParser = new parser({ parser: { extractDoc: false }, ast: { withPositions: true } });

const toPosix = (p) => p.split(sep).join('/');

// ---------------------------------------------------------------------------
// filesystem walk
// ---------------------------------------------------------------------------

/** Every file under `dir` matching `filter`, as absolute paths. */
function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (entry.isFile() && filter(full)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// composer.json → PSR-4 roots
// ---------------------------------------------------------------------------

/**
 * The `namespace prefix → directory` map from composer.json.
 * Both `autoload` and `autoload-dev` are read: an app may ship a component in
 * a dev-only namespace, and Laravel would resolve it all the same.
 */
export function psr4Roots(appRoot) {
  const file = join(appRoot, 'composer.json');
  if (!existsSync(file)) return new Map();
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { return new Map(); }

  const map = new Map();
  for (const section of ['autoload', 'autoload-dev']) {
    const psr4 = json?.[section]?.['psr-4'];
    if (!psr4 || typeof psr4 !== 'object') continue;
    for (const [prefix, dirs] of Object.entries(psr4)) {
      for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
        if (typeof dir !== 'string') continue;
        const abs = join(appRoot, dir);
        if (!map.has(prefix)) map.set(prefix, []);
        map.get(prefix).push(abs);
      }
    }
  }
  return map;
}

/** The namespace prefix that owns `absFile`, and the FQCN it implies. */
function fqcnFor(absFile, roots) {
  const file = toPosix(absFile);
  for (const [prefix, dirs] of roots) {
    for (const dir of dirs) {
      const root = toPosix(dir).replace(/\/+$/, '') + '/';
      if (!file.startsWith(root)) continue;
      const rel = file.slice(root.length).replace(/\.php$/, '');
      return prefix + rel.split('/').join('\\');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// constructor parameters
// ---------------------------------------------------------------------------

/**
 * The parameter names of a class's `__construct`, in order.
 *
 * `partitionDataAndAttributes()` compares `Str::camel($key)` against these, so
 * the NAME is what matters — not the type, the default, or promotion. A class
 * with no constructor answers `[]` (every attribute stays an attribute).
 */
export function constructorParams(source) {
  let ast;
  try { ast = phpParser.parseCode(source); } catch { return null; }

  const classes = [];
  const collect = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'class') classes.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const v of value) collect(v);
      else if (value && typeof value === 'object') collect(value);
    }
  };
  collect(ast);

  // A file may declare several classes; the component is the one whose name
  // matches the file (the PSR-4 rule). With one class, take it.
  const cls = classes.length === 1 ? classes[0] : classes.find((c) => c.name) ?? classes[0];
  if (!cls) return null;

  const ctor = (cls.body || []).find((m) => m.kind === 'method' && (m.name?.name ?? m.name) === '__construct');
  if (!ctor) return [];

  return (ctor.arguments || []).map((arg) => (arg.name?.name ?? arg.name ?? '').replace(/^\$/, '')).filter(Boolean);
}

// ---------------------------------------------------------------------------
// provider registrations
// ---------------------------------------------------------------------------

/**
 * `Blade::component()`, `componentNamespace()`, `anonymousComponentPath()`,
 * `anonymousComponentNamespace()` calls with LITERAL arguments.
 *
 * A registration whose arguments are not literals is reported in `unresolved`:
 * the build must not invent an alias it cannot prove.
 */
export function bladeRegistrations(source, file = null) {
  const out = { aliases: {}, namespaces: {}, anonymousPaths: [], anonymousNamespaces: [], unresolved: [] };

  let ast;
  try { ast = phpParser.parseCode(source); } catch {
    out.unresolved.push({ file, reason: 'could not parse' });
    return out;
  }

  const literal = (node) => {
    if (!node) return null;
    if (node.kind === 'string') return node.value;
    if (node.kind === 'staticlookup') {
      // `Foo::class` → the FQCN is resolved later from the file's `use` map;
      // here we return the raw text so the caller can resolve it.
      const what = node.what?.name;
      const offset = node.offset?.name;
      if (offset === 'class' && what) return { classRef: what };
      return null;
    }
    return null;
  };

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.kind === 'call' && node.what?.kind === 'staticlookup') {
      const cls = node.what.what?.name;
      const method = node.what.offset?.name;
      if (cls === 'Blade' && method) {
        const args = (node.arguments || []).map(literal);
        const allLiteral = args.every((a) => a !== null);
        if (!allLiteral) {
          out.unresolved.push({ file, reason: `Blade::${method}() with a non-literal argument` });
        } else if (method === 'component' && args.length >= 2) {
          const alias = typeof args[0] === 'string' ? args[0] : null;
          const target = args[1];
          if (alias && target) out.aliases[alias] = target;
        } else if (method === 'componentNamespace' && args.length >= 2) {
          out.namespaces[String(args[1])] = String(args[0]);
        } else if (method === 'anonymousComponentPath' && args.length >= 1) {
          out.anonymousPaths.push({ path: String(args[0]), prefix: args[1] ? String(args[1]) : null });
        } else if (method === 'anonymousComponentNamespace' && args.length >= 1) {
          out.anonymousNamespaces.push({ ns: String(args[0]), prefix: args[1] ? String(args[1]) : null });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const v of value) visit(v);
      else if (value && typeof value === 'object') visit(value);
    }
  };

  visit(ast);
  return out;
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

/**
 * Read a Laravel app and build everything `componentClass()` needs.
 *
 * @param {string} appRoot
 * @returns {{
 *   classes: Map<string, {class: string, params: string[], file: string}>,
 *   views: Set<string>,
 *   aliases: Map<string, string>,
 *   namespaces: Map<string, string>,
 *   unresolved: {file: string|null, reason: string}[],
 *   componentClass: (name: string) => string | {class: string, params: string[]} | {view: string} | null,
 * }}
 */
export function discoverComponents(appRoot) {
  const roots = psr4Roots(appRoot);
  const classes = new Map();
  const views = new Set();
  const aliases = new Map();
  const namespaces = new Map();
  const unresolved = [];

  // 1. class components: every PHP file under a PSR-4 root whose FQCN is
  //    `<Ns>\View\Components\…`.
  for (const dir of roots.values()) {
    for (const rootDir of dir) {
      for (const file of walk(rootDir, (f) => f.endsWith('.php'))) {
        const fqcn = fqcnFor(file, roots);
        if (!fqcn || !fqcn.includes('\\View\\Components\\')) continue;
        const params = constructorParams(readFileSync(file, 'utf8'));
        if (params === null) {
          unresolved.push({ file, reason: 'could not parse the class' });
          continue;
        }
        classes.set(fqcn, { class: fqcn, params, file });
      }
    }
  }

  // 2. anonymous components: resources/views/components/**/*.blade.php
  const viewDirs = [join(appRoot, 'resources', 'views')];
  for (const base of viewDirs) {
    const componentDir = join(base, 'components');
    for (const file of walk(componentDir, (f) => f.endsWith('.blade.php'))) {
      const rel = toPosix(relative(componentDir, file)).replace(/\.blade\.php$/, '');
      views.add(`components.${rel.split('/').join('.')}`);
    }
    // Every other view, for `@include`-style existence checks on components
    // that live outside the components/ directory but are still reachable.
    for (const file of walk(base, (f) => f.endsWith('.blade.php'))) {
      const rel = toPosix(relative(base, file)).replace(/\.blade\.php$/, '');
      views.add(rel.split('/').join('.'));
    }
  }

  // 3. provider registrations
  for (const file of walk(join(appRoot, 'app'), (f) => f.endsWith('.php'))) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    if (!source.includes('Blade::')) continue;
    const reg = bladeRegistrations(source, file);
    unresolved.push(...reg.unresolved);

    // Resolve `Foo::class` against the file's own `use` map.
    const uses = useMap(source);
    const resolveRef = (ref) => {
      if (typeof ref === 'string') return ref;
      if (!ref?.classRef) return null;
      const name = ref.classRef;
      if (uses.has(name)) return uses.get(name);
      // A relative reference resolves against the file's namespace.
      const ns = namespaceOf(source);
      return ns ? `${ns}\\${name}` : name;
    };

    for (const [alias, ref] of Object.entries(reg.aliases)) {
      const fqcn = resolveRef(ref);
      if (fqcn) aliases.set(alias, fqcn);
      else unresolved.push({ file, reason: `Blade::component('${alias}', …) target could not be resolved` });
    }
    for (const [prefix, ns] of Object.entries(reg.namespaces)) namespaces.set(prefix, ns);
    for (const p of reg.anonymousPaths) {
      const abs = join(appRoot, p.path);
      for (const file of walk(abs, (f) => f.endsWith('.blade.php'))) {
        const rel = toPosix(relative(abs, file)).replace(/\.blade\.php$/, '');
        views.add(`${p.prefix ? `${p.prefix}::` : ''}${rel.split('/').join('.')}`);
      }
    }
    for (const n of reg.anonymousNamespaces) {
      unresolved.push({ file, reason: `Blade::anonymousComponentNamespace('${n.ns}') is not resolved statically` });
    }
  }

  const namespace = appNamespace(roots);

  const componentClass = (name) => {
    const raw = String(name);

    // a) an explicit alias
    if (aliases.has(raw)) {
      const target = aliases.get(raw);
      const cls = classes.get(target);
      return cls ?? (views.has(target) ? { view: target } : target);
    }

    // b) `prefix::name` from componentNamespace()
    const sep = raw.indexOf('::');
    if (sep > 0) {
      const prefix = raw.slice(0, sep);
      const rest = raw.slice(sep + 2);
      if (namespaces.has(prefix)) {
        const fqcn = `${namespaces.get(prefix)}\\${formatClassName(rest)}`;
        if (classes.has(fqcn)) return classes.get(fqcn);
      }
      if (views.has(raw)) return { view: raw };
    }

    // c) the conventional class: <AppNamespace>\View\Components\<Format>
    const guessed = `${namespace}View\\Components\\${formatClassName(raw)}`;
    if (classes.has(guessed)) return classes.get(guessed);

    // d) the anonymous views the framework would try, in its own order
    for (const candidate of anonymousCandidates(raw)) {
      if (views.has(candidate)) return { view: candidate };
    }

    // e) a mail component (`mail::…`) resolves to its own view name
    if (raw.startsWith('mail::') && views.has(raw)) return { view: raw };

    return null;
  };

  return { classes, views, aliases, namespaces, unresolved, componentClass, namespace };
}

/** `Str::camel` per dot segment, `ucfirst`, joined with `\`. */
function formatClassName(component) {
  return String(component)
    .split('.')
    .map((piece) => {
      const camel = piece.replace(/[-_\s]+(.)/g, (_m, c) => c.toUpperCase());
      const lower = camel.charAt(0).toLowerCase() + camel.slice(1);
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('\\');
}

/**
 * The view names `guessAnonymousComponentUsingPaths()` tries, in order:
 * `components.<name>`, `components.<name>.index`, `components.<name>.<last>`.
 */
function anonymousCandidates(component) {
  const base = `components.${String(component)}`;
  const last = String(component).split('.').pop().split(':').pop();
  return [base, `${base}.index`, `${base}.${last}`];
}

/** The app's root namespace, from composer.json's PSR-4 (`App\\` by default). */
function appNamespace(roots) {
  for (const prefix of roots.keys()) {
    if (/^App\\\\?$/.test(prefix)) return prefix.endsWith('\\') ? prefix : `${prefix}\\`;
  }
  return 'App\\';
}

/** `use Foo\Bar;` / `use Foo\Bar as Baz;` from a file. */
function useMap(source) {
  const map = new Map();
  let ast;
  try { ast = phpParser.parseCode(source); } catch { return map; }
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'usegroup') {
      // php-parser shapes `use Foo\Bar;` as usegroup{name: null, items:[{name:'Foo\\Bar'}]}
      // and `use Foo\{Bar, Baz};` as usegroup{name:'Foo', items:[{name:'Bar'},…]}.
      const prefix = node.name ? (node.name.name ?? node.name) : '';
      for (const item of node.items || []) {
        const itemName = item.name?.name ?? item.name;
        if (!itemName) continue;
        const fqcn = prefix ? `${prefix}\\${itemName}` : itemName;
        const alias = item.alias?.name ?? item.alias ?? itemName.split('\\').pop();
        map.set(alias, fqcn);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const v of value) visit(v);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return map;
}

function namespaceOf(source) {
  let ast;
  try { ast = phpParser.parseCode(source); } catch { return null; }
  const ns = (ast.children || []).find((n) => n.kind === 'namespace');
  return ns?.name?.name ?? ns?.name ?? null;
}

export default { discoverComponents, constructorParams, bladeRegistrations, psr4Roots };
