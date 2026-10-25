// src/directives.mjs — one function per `compile<Name>` method of
// Illuminate\View\Compilers\BladeCompiler (Laravel 13.x).
//
// Each function returns the EXACT PHP bytes the framework's trait returns.
// The port is mechanical on purpose: the whitespace, the `<?php`/`?>` placement
// and the `$__env->` call shapes are part of the compiled output that every
// downstream transpiler and every golden test compares.
//
// The framework names the method `compile` + ucfirst(directive) and calls it
// with the parenthesised expression (including the parentheses) or null when
// the directive has no parentheses. `stripParentheses` therefore removes ONE
// leading `(` and ONE trailing `)`.
//
// Source of truth: upstream/Compilers/Concerns/*.php (vendored, 13.x).

import { endsWith, trimChars, explode, uuid } from './str.mjs';

const str = (v) => String(v ?? '');

const ANONYMOUS_COMPONENT = 'Illuminate\\View\\AnonymousComponent';

/** `BladeCompiler::stripParentheses()` — drop one `(` and one `)` when present. */
export function stripParentheses(expression) {
  const e = str(expression);
  if (e.startsWith('(')) return e.slice(1, -1);
  return e;
}

/** `Str::uuid()` wrapped in single quotes, the shape `@once`/`@pushOnce` emit. */
const quotedUuid = () => `'${uuid()}'`;

// ---------------------------------------------------------------------------
// CompilesAuthorizations
// ---------------------------------------------------------------------------
const GATE = 'app(\\Illuminate\\Contracts\\Auth\\Access\\Gate::class)';

export const can = (e) => `<?php if (${GATE}->check${e}): ?>`;
export const cannot = (e) => `<?php if (${GATE}->denies${e}): ?>`;
export const canany = (e) => `<?php if (${GATE}->any${e}): ?>`;
export const elsecan = (e) => `<?php elseif (${GATE}->check${e}): ?>`;
export const elsecannot = (e) => `<?php elseif (${GATE}->denies${e}): ?>`;
export const elsecanany = (e) => `<?php elseif (${GATE}->any${e}): ?>`;
export const endcan = () => '<?php endif; ?>';
export const endcannot = () => '<?php endif; ?>';
export const endcanany = () => '<?php endif; ?>';

// ---------------------------------------------------------------------------
// CompilesClasses
// ---------------------------------------------------------------------------
export const class_ = (e) => {
  const exp = e == null ? '([])' : e;
  return `class="<?php echo \\Illuminate\\Support\\Arr::toCssClasses${exp}; ?>"`;
};

// ---------------------------------------------------------------------------
// CompilesStyles
// ---------------------------------------------------------------------------
export const style = (e) => {
  const exp = e == null ? '([])' : e;
  return `style="<?php echo \\Illuminate\\Support\\Arr::toCssStyles${exp} ?>"`;
};

// ---------------------------------------------------------------------------
// CompilesConditionals
// ---------------------------------------------------------------------------
export const auth = (guard) => {
  const g = guard == null ? '()' : guard;
  return `<?php if(auth()->guard${g}->check()): ?>`;
};
export const elseauth = (guard) => {
  const g = guard == null ? '()' : guard;
  return `<?php elseif(auth()->guard${g}->check()): ?>`;
};
export const endauth = () => '<?php endif; ?>';

export const guest = (guard) => {
  const g = guard == null ? '()' : guard;
  return `<?php if(auth()->guard${g}->guest()): ?>`;
};
export const elseguest = (guard) => {
  const g = guard == null ? '()' : guard;
  return `<?php elseif(auth()->guard${g}->guest()): ?>`;
};
export const endguest = () => '<?php endif; ?>';

export const env = (environments) => `<?php if(app()->environment${environments}): ?>`;
export const endenv = () => '<?php endif; ?>';
export const production = () => `<?php if(app()->environment('production')): ?>`;
export const endproduction = () => '<?php endif; ?>';

export const hassection = (e) => `<?php if (! empty(trim($__env->yieldContent${e}))): ?>`;
export const hasstack = (e) => `<?php if (! $__env->isStackEmpty${e}): ?>`;
export const sectionmissing = (e) => `<?php if (empty(trim($__env->yieldContent${e}))): ?>`;

export const if_ = (e) => `<?php if${e}: ?>`;
export const unless = (e) => `<?php if (! ${e}): ?>`;
export const elseif = (e) => `<?php elseif${e}: ?>`;
export const else_ = () => '<?php else: ?>';
export const endif = () => '<?php endif; ?>';
export const endunless = () => '<?php endif; ?>';
export const isset = (e) => `<?php if(isset${e}): ?>`;
export const endisset = () => '<?php endif; ?>';

// `@switch` / `@case` / `@default` carry state: only the FIRST @case continues
// the `switch{…}:` line; every later one opens its own `<?php`.
export function switch_(e, ctx) {
  ctx.firstCaseInSwitch = true;
  return `<?php switch${e}:`;
}
export function case_(e, ctx) {
  if (ctx.firstCaseInSwitch) {
    ctx.firstCaseInSwitch = false;
    return `case ${e}: ?>`;
  }
  return `<?php case ${e}: ?>`;
}
export const default_ = () => '<?php default: ?>';
export const endswitch = () => '<?php endswitch; ?>';

export const once = (id, ctx) => {
  const theId = id ? stripParentheses(id) : quotedUuid();
  return `<?php if (! $__env->hasRenderedOnce(${theId})): $__env->markAsRenderedOnce(${theId}); ?>`;
};
export const endonce = () => '<?php endif; ?>';

export const bool = (condition) => `<?php echo (${condition} ? 'true' : 'false'); ?>`;
export const checked = (c) => `<?php if${c}: echo 'checked'; endif; ?>`;
export const disabled = (c) => `<?php if${c}: echo 'disabled'; endif; ?>`;
export const required = (c) => `<?php if${c}: echo 'required'; endif; ?>`;
export const readonly = (c) => `<?php if${c}: echo 'readonly'; endif; ?>`;
export const selected = (c) => `<?php if${c}: echo 'selected'; endif; ?>`;

// @pushIf / @elsePushIf / @elsePush / @endPushIf — the condition may itself
// contain commas, so more than two parts means "join all but the last".
function pushIfParts(expression) {
  const parts = explode(',', stripParentheses(expression));
  if (parts.length > 2) {
    const last = parts.pop();
    return [parts.join(','), trimChars(last, ' \t\n\r\0\x0B')];
  }
  return parts;
}

/** Laravel <= 11 split with a limit of 2: a comma in the condition broke it. */
export function pushIfPartsLegacy(expression) {
  return explode(',', stripParentheses(expression), 2);
}
export const pushif = (e) => {
  const [cond, stack] = pushIfParts(e);
  return `<?php if(${cond}): $__env->startPush(${stack}); ?>`;
};
export const elsepushif = (e) => {
  const [cond, stack] = pushIfParts(e);
  return `<?php $__env->stopPush(); elseif(${cond}): $__env->startPush(${stack}); ?>`;
};
export const elsepush = (e) => `<?php $__env->stopPush(); else: $__env->startPush${e}; ?>`;
export const endpushif = () => '<?php $__env->stopPush(); endif; ?>';

// ---------------------------------------------------------------------------
// CompilesLoops
// ---------------------------------------------------------------------------
const LOOP_AS = /\( *(.+) +as +(.*)\)$/is;

export function forelse(expression, ctx) {
  const empty = `$__empty_${++ctx.forElseCounter}`;
  const m = LOOP_AS.exec(str(expression));
  if (!m) throw ctx.fail('BL002', 'Malformed @forelse statement.', 'write `@forelse ($items as $item)`');
  const iteratee = m[1].trim();
  const iteration = m[2].trim();
  const initLoop = `$__currentLoopData = ${iteratee}; $__env->addLoop($__currentLoopData);`;
  const iterateLoop = '$__env->incrementLoopIndices(); $loop = $__env->getLastLoop();';
  return `<?php ${empty} = true; ${initLoop} foreach($__currentLoopData as ${iteration}): ${iterateLoop} ${empty} = false; ?>`;
}

export function empty_(expression, ctx) {
  if (expression) return `<?php if(empty${expression}): ?>`;
  const empty = `$__empty_${ctx.forElseCounter--}`;
  return `<?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if (${empty}): ?>`;
}

export const endforelse = () => '<?php endif; ?>';
export const endempty = () => '<?php endif; ?>';
export const for_ = (e) => `<?php for${e}: ?>`;

export function foreach_(expression, ctx) {
  const m = LOOP_AS.exec(str(expression));
  if (!m) throw ctx.fail('BL002', 'Malformed @foreach statement.', 'write `@foreach ($items as $item)`');
  const iteratee = m[1].trim();
  const iteration = m[2].trim();
  const initLoop = `$__currentLoopData = ${iteratee}; $__env->addLoop($__currentLoopData);`;
  const iterateLoop = '$__env->incrementLoopIndices(); $loop = $__env->getLastLoop();';
  return `<?php ${initLoop} foreach($__currentLoopData as ${iteration}): ${iterateLoop} ?>`;
}

const BREAK_CONTINUE = /\(\s*(-?\d+)\s*\)$/;
function breakContinue(kind, expression) {
  if (expression) {
    const m = BREAK_CONTINUE.exec(expression);
    return m ? `<?php ${kind} ${Math.max(1, Number(m[1]))}; ?>` : `<?php if${expression} ${kind}; ?>`;
  }
  return `<?php ${kind}; ?>`;
}
export const break_ = (e) => breakContinue('break', e);
export const continue_ = (e) => breakContinue('continue', e);
export const endfor = () => '<?php endfor; ?>';
export const endforeach = () => '<?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?>';
export const while_ = (e) => `<?php while${e}: ?>`;
export const endwhile = () => '<?php endwhile; ?>';

// ---------------------------------------------------------------------------
// CompilesLayouts
// ---------------------------------------------------------------------------
// The view-data filter changed in Laravel 11: 10.x passes Arr::except(), 11+
// passes array_diff_key(). The bytes differ, so the version selects the variant.
const VARS_10 = "\\Illuminate\\Support\\Arr::except(get_defined_vars(), ['__data', '__path'])";
const VARS_11 = "array_diff_key(get_defined_vars(), ['__data' => 1, '__path' => 1])";

export function extends_(expression, ctx) {
  const exp = stripParentheses(expression);
  ctx.footer.push(
    `<?php echo $__env->make(${exp}, ${ctx.vars})->render(); ?>`
  );
  return '';
}
export function extendsfirst(expression, ctx) {
  const exp = stripParentheses(expression);
  ctx.footer.push(
    `<?php echo $__env->first(${exp}, ${ctx.vars})->render(); ?>`
  );
  return '';
}
export function section(expression, ctx) {
  ctx.lastSection = trimChars(expression, "()'\" ");
  return `<?php $__env->startSection${expression}; ?>`;
}
export function parent(_expression, ctx) {
  const escaped = String(ctx.lastSection).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `<?php echo \\Illuminate\\View\\Factory::parentPlaceholder('${escaped}'); ?>`;
}
export const yield_ = (e) => `<?php echo $__env->yieldContent${e}; ?>`;
export const show = () => '<?php echo $__env->yieldSection(); ?>';
export const append = () => '<?php $__env->appendSection(); ?>';
export const overwrite = () => '<?php $__env->stopSection(true); ?>';
export const stop = () => '<?php $__env->stopSection(); ?>';
export const endsection = () => '<?php $__env->stopSection(); ?>';

// ---------------------------------------------------------------------------
// CompilesStacks
// ---------------------------------------------------------------------------
export const stack = (e) => `<?php echo $__env->yieldPushContent${e}; ?>`;
export const push = (e) => `<?php $__env->startPush${e}; ?>`;

function onceId(expression) {
  const parts = explode(',', stripParentheses(expression), 2);
  const id = parts[1] ?? '';
  const trimmed = trimChars(id, ' \t\n\r\0\x0B');
  return { stack: parts[0], id: trimmed || quotedUuid() };
}
export function pushonce(e) {
  const { stack, id } = onceId(e);
  return `<?php if (! $__env->hasRenderedOnce(${id})): $__env->markAsRenderedOnce(${id});
$__env->startPush(${stack}); ?>`;
}
export const endpush = () => '<?php $__env->stopPush(); ?>';
export const endpushonce = () => '<?php $__env->stopPush(); endif; ?>';
export const prepend = (e) => `<?php $__env->startPrepend${e}; ?>`;
export function prependonce(e) {
  const { stack, id } = onceId(e);
  return `<?php if (! $__env->hasRenderedOnce(${id})): $__env->markAsRenderedOnce(${id});
$__env->startPrepend(${stack}); ?>`;
}
export const endprepend = () => '<?php $__env->stopPrepend(); ?>';
export const endprependonce = () => '<?php $__env->stopPrepend(); endif; ?>';

// ---------------------------------------------------------------------------
// CompilesIncludes
// ---------------------------------------------------------------------------
export const each = (e) => `<?php echo $__env->renderEach${e}; ?>`;
export function include_(e, ctx) {
  const exp = stripParentheses(e);
  return `<?php echo $__env->make(${exp}, ${ctx.vars})->render(); ?>`;
}
export function includeif(e, ctx) {
  const exp = stripParentheses(e);
  return `<?php if ($__env->exists(${exp})) echo $__env->make(${exp}, ${ctx.vars})->render(); ?>`;
}
export function includewhen(e, ctx) {
  const exp = stripParentheses(e);
  return `<?php echo $__env->renderWhen(${exp}, ${ctx.vars}); ?>`;
}
export function includeunless(e, ctx) {
  const exp = stripParentheses(e);
  return `<?php echo $__env->renderUnless(${exp}, ${ctx.vars}); ?>`;
}
export function includefirst(e, ctx) {
  const exp = stripParentheses(e);
  return `<?php echo $__env->first(${exp}, ${ctx.vars})->render(); ?>`;
}
export function includeisolated(e) {
  const exp = stripParentheses(e);
  return `<?php echo $__env->make(${exp})->render(); ?>`;
}

// ---------------------------------------------------------------------------
// CompilesErrors
// ---------------------------------------------------------------------------
export function error(expression) {
  const exp = stripParentheses(expression);
  return `<?php $__errorArgs = [${exp}];
$__bag = $errors->getBag($__errorArgs[1] ?? 'default');
if ($__bag->has($__errorArgs[0])) :
if (isset($message)) { $__messageOriginal = $message; }
$message = $__bag->first($__errorArgs[0]); ?>`;
}
export const enderror = () => `<?php unset($message);
if (isset($__messageOriginal)) { $message = $__messageOriginal; }
endif;
unset($__errorArgs, $__bag); ?>`;

// ---------------------------------------------------------------------------
// CompilesFragments
// ---------------------------------------------------------------------------
export function fragment(expression, ctx) {
  ctx.lastFragment = trimChars(expression, "()'\" ");
  return `<?php $__env->startFragment${expression}; ?>`;
}
export const endfragment = () => '<?php echo $__env->stopFragment(); ?>';

// ---------------------------------------------------------------------------
// CompilesContexts
// ---------------------------------------------------------------------------
export function context(expression) {
  const exp = stripParentheses(expression);
  return `<?php $__contextArgs = [${exp}];
if (context()->has($__contextArgs[0])) :
if (isset($value)) { $__contextPrevious[] = $value; }
$value = context()->get($__contextArgs[0]); ?>`;
}
export const endcontext = () => `<?php unset($value);
if (isset($__contextPrevious) && !empty($__contextPrevious)) { $value = array_pop($__contextPrevious); }
if (isset($__contextPrevious) && empty($__contextPrevious)) { unset($__contextPrevious); }
endif;
unset($__contextArgs); ?>`;

// ---------------------------------------------------------------------------
// CompilesSessions
// ---------------------------------------------------------------------------
export function session(expression) {
  const exp = stripParentheses(expression);
  return `<?php $__sessionArgs = [${exp}];
if (session()->has($__sessionArgs[0])) :
if (isset($value)) { $__sessionPrevious[] = $value; }
$value = session()->get($__sessionArgs[0]); ?>`;
}
export const endsession = () => `<?php unset($value);
if (isset($__sessionPrevious) && !empty($__sessionPrevious)) { $value = array_pop($__sessionPrevious); }
if (isset($__sessionPrevious) && empty($__sessionPrevious)) { unset($__sessionPrevious); }
endif;
unset($__sessionArgs); ?>`;

// ---------------------------------------------------------------------------
// CompilesTranslations
// ---------------------------------------------------------------------------
export function lang(expression) {
  if (expression == null) return '<?php $__env->startTranslation(); ?>';
  if (str(expression)[1] === '[') return `<?php $__env->startTranslation${expression}; ?>`;
  return `<?php echo app('translator')->get${expression}; ?>`;
}
export const endlang = () => '<?php echo $__env->renderTranslation(); ?>';
export const choice = (e) => `<?php echo app('translator')->choice${e}; ?>`;

// ---------------------------------------------------------------------------
// CompilesInjections
// ---------------------------------------------------------------------------
export function inject(expression) {
  const cleaned = str(expression).replace(/[()]/g, '');
  const segments = explode(',', cleaned);
  const variable = trimChars(segments[0], " '\"");
  const service = trimChars(segments[1] ?? '', ' \t\n\r\0\x0B');
  return `<?php $${variable} = app(${service}); ?>`;
}

// ---------------------------------------------------------------------------
// CompilesUseStatements
// ---------------------------------------------------------------------------
export function use_legacy(expression) {
  const segments = explode(',', String(expression).replace(/[()]/g, ''));
  const u = trimChars(segments[0], " '\"").replace(/^\\+/, '');
  const as = segments[1] != null ? ` as ${trimChars(segments[1], " '\"")}` : '';
  return `<?php use \\${u}${as}; ?>`;
}

export function use(expression, ctx) {
  let e = trimChars(str(expression).replace(/[()]/g, ''), " '\"");

  let pathWithOptionalModifier;
  let aliasWithLeadingSpace = '';
  if (e.includes('{')) {
    pathWithOptionalModifier = e;
  } else {
    const segments = explode(',', e);
    pathWithOptionalModifier = trimChars(segments[0], " '\"");
    aliasWithLeadingSpace = segments[1] != null ? ` as ${trimChars(segments[1], " '\"")}` : '';
  }

  let modifierWithTrailingSpace = '';
  let path = pathWithOptionalModifier;
  if (pathWithOptionalModifier.startsWith('function ')) {
    modifierWithTrailingSpace = 'function ';
    path = pathWithOptionalModifier.split(' ').slice(1).join(' ') || pathWithOptionalModifier;
  } else if (pathWithOptionalModifier.startsWith('const ')) {
    modifierWithTrailingSpace = 'const ';
    path = pathWithOptionalModifier.split(' ').slice(1).join(' ') || pathWithOptionalModifier;
  }
  path = path.replace(/^\\+/, '');
  return `<?php use ${modifierWithTrailingSpace}\\${path}${aliasWithLeadingSpace}; ?>`;
}

// ---------------------------------------------------------------------------
// CompilesRawPhp
// ---------------------------------------------------------------------------
export const php = (expression) => (expression ? `<?php ${expression}; ?>` : '@php');
export const unset = (expression) => `<?php unset${expression}; ?>`;

// ---------------------------------------------------------------------------
// CompilesHelpers
// ---------------------------------------------------------------------------
export const csrf = () => '<?php echo csrf_field(); ?>';
export const dd = (args) => `<?php dd${args}; ?>`;
export const dump = (args) => `<?php dump${args}; ?>`;
export const method = (m) => `<?php echo method_field${m}; ?>`;
export const vite = (args) => `<?php echo app('Illuminate\\Foundation\\Vite')${args ?? '()'}; ?>`;
export const vitereactrefresh = () => `<?php echo app('Illuminate\\Foundation\\Vite')->reactRefresh(); ?>`;
export const fonts = (args) => `<?php echo app('Illuminate\\Foundation\\Vite')->fonts${args ?? '()'}; ?>`;

// ---------------------------------------------------------------------------
// CompilesJson
// ---------------------------------------------------------------------------
const JSON_DEFAULT_OPTIONS = '15'; // JSON_HEX_TAG|HEX_APOS|HEX_AMP|HEX_QUOT
export function json(expression) {
  const parts = explode(',', stripParentheses(expression));
  const options = parts[1] != null ? trimChars(parts[1], ' \t\n\r\0\x0B') : JSON_DEFAULT_OPTIONS;
  const depth = parts[2] != null ? trimChars(parts[2], ' \t\n\r\0\x0B') : '512';
  return `<?php echo json_encode(${parts[0]}, ${options}, ${depth}) ?>`;
}

// ---------------------------------------------------------------------------
// CompilesJs
// ---------------------------------------------------------------------------
export const js = (expression) => `<?php echo \\Illuminate\\Support\\Js::from(${stripParentheses(expression)})->toHtml() ?>`;

// ---------------------------------------------------------------------------
// CompilesComponents
// ---------------------------------------------------------------------------
export const component = (expression, ctx) => {
  const e = str(expression);
  const hasComma = e.includes(',');
  // explode(',', …, 3): the data expression keeps its own commas.
  const parts = hasComma
    ? explode(',', trimChars(e, '()'), 3).map((p) => trimChars(p, ' \t\n\r\0\x0B'))
    : [trimChars(e, '()'), '', ''];
  while (parts.length < 3) parts.push('');
  const [componentName, alias, data] = parts;

  const bare = trimChars(componentName, " '\"");

  // A class component is compiled to a resolve()/shouldRender() block whose hash
  // is `xxh128` of the class name. The hash is embedded in variable NAMES, so we
  // must reproduce it; we do that in component-hash.mjs (an xxh128 port).
  if (bare.includes('::class') || bare.includes('\\')) {
    // CompilesComponents::compileComponent hashes the alias too for an
    // anonymous component, so two anonymous views never share a hash.
    const hashInput = bare === ANONYMOUS_COMPONENT
      ? `${bare}:${trimChars(alias, "'\"")}`
      : bare;
    const hash = ctx.newComponentHash(hashInput);
    return compileClassComponentOpening(bare, alias, data, hash, ctx.version);
  }
  return `<?php $__env->startComponent${expression}; ?>`;
};

export function compileClassComponentOpening(component, alias, data, hash, version = '13.x') {
  // Laravel 10 cast the attribute bag with `(array) $attributes->getIterator()`;
  // 11+ uses `$attributes->all()`. The bytes differ, so the version selects it.
  const attrs = version === '10.x'
    ? '(array) $attributes->getIterator()'
    : '$attributes->all()';
  return [
    `<?php if (isset($component)) { $__componentOriginal${hash} = $component; } ?>`,
    `<?php if (isset($attributes)) { $__attributesOriginal${hash} = $attributes; } ?>`,
    `<?php $component = ${component}::resolve(${data || '[]'} + (isset($attributes) && $attributes instanceof Illuminate\\View\\ComponentAttributeBag ? ${attrs} : [])); ?>`,
    `<?php $component->withName(${alias}); ?>`,
    `<?php if ($component->shouldRender()): ?>`,
    `<?php $__env->startComponent($component->resolveView(), $component->data()); ?>`,
  ].join('\n');
}

export const endcomponent = () => '<?php echo $__env->renderComponent(); ?>';

export function endcomponentclass(_e, ctx) {
  const hash = ctx.popComponentHash();
  return `${endcomponent()}\n${[
    '<?php endif; ?>',
    `<?php if (isset($__attributesOriginal${hash})): ?>`,
    `<?php $attributes = $__attributesOriginal${hash}; ?>`,
    `<?php unset($__attributesOriginal${hash}); ?>`,
    '<?php endif; ?>',
    `<?php if (isset($__componentOriginal${hash})): ?>`,
    `<?php $component = $__componentOriginal${hash}; ?>`,
    `<?php unset($__componentOriginal${hash}); ?>`,
    '<?php endif; ?>',
  ].join('\n')}`;
}

export const slot = (e) => `<?php $__env->slot${e}; ?>`;
export const endslot = () => '<?php $__env->endSlot(); ?>';
export const componentfirst = (e) => `<?php $__env->startComponentFirst${e}; ?>`;
export const endcomponentfirst = () => endcomponent();

export const props10 = (expression) => `<?php $attributes ??= new \\Illuminate\\View\\ComponentAttributeBag; ?>
<?php foreach($attributes->onlyProps${expression} as $__key => $__value) {
    $$__key = $$__key ?? $__value;
} ?>
<?php $attributes = $attributes->exceptProps${expression}; ?>
<?php foreach (array_filter(${expression}, 'is_string', ARRAY_FILTER_USE_KEY) as $__key => $__value) {
    $$__key = $$__key ?? $__value;
} ?>
<?php $__defined_vars = get_defined_vars(); ?>
<?php foreach ($attributes as $__key => $__value) {
    if (array_key_exists($__key, $__defined_vars)) unset($$__key);
} ?>
<?php unset($__defined_vars); ?>`;

export const props11 = (expression) => `<?php $attributes ??= new \\Illuminate\\View\\ComponentAttributeBag;

$__newAttributes = [];
$__propNames = \\Illuminate\\View\\ComponentAttributeBag::extractPropNames(${expression});

foreach ($attributes->all() as $__key => $__value) {
    if (in_array($__key, $__propNames)) {
        $$__key = $$__key ?? $__value;
    } else {
        $__newAttributes[$__key] = $__value;
    }
}

$attributes = new \\Illuminate\\View\\ComponentAttributeBag($__newAttributes);

unset($__propNames);
unset($__newAttributes);

foreach (array_filter(${expression}, 'is_string', ARRAY_FILTER_USE_KEY) as $__key => $__value) {
    $$__key = $$__key ?? $__value;
}

$__defined_vars = get_defined_vars();

foreach ($attributes->all() as $__key => $__value) {
    if (array_key_exists($__key, $__defined_vars)) unset($$__key);
}

unset($__defined_vars); ?>`;

export const props = (expression) => `<?php $attributes ??= new \\Illuminate\\View\\ComponentAttributeBag;

$__newAttributes = [];
$__propNames = \\Illuminate\\View\\ComponentAttributeBag::extractPropNames(${expression});

foreach ($attributes->all() as $__key => $__value) {
    if (in_array($__key, $__propNames)) {
        $$__key = $$__key ?? $__value;
    } else {
        $__newAttributes[$__key] = $__value;
    }
}

$attributes = new \\Illuminate\\View\\ComponentAttributeBag($__newAttributes);

unset($__propNames);
unset($__newAttributes);

foreach (array_filter(${expression}, 'is_string', ARRAY_FILTER_USE_KEY) as $__key => $__value) {
    $$__key = $$__key ?? $__value;
}

$__defined_vars = get_defined_vars();

foreach ($attributes->all() as $__key => $__value) {
    if (array_key_exists($__key, $__defined_vars)) unset($$__key);
}

unset($__defined_vars, $__key, $__value); ?>`;

export const aware = (expression) => `<?php foreach (${expression} as $__key => $__value) {
    $__consumeVariable = is_string($__key) ? $__key : $__value;
    $$__consumeVariable = is_string($__key) ? $__env->getConsumableComponentData($__key, $__value) : $__env->getConsumableComponentData($__value);
} ?>`;

// ---------------------------------------------------------------------------
// The lookup table.
//
// BladeCompiler resolves a directive with `method_exists($this,
// 'compile'.ucfirst($name))` — so the table key must be the lowercase directive
// as written (`@endunless` → `compileEndunless` → key `endunless`).
// ---------------------------------------------------------------------------
export const DIRECTIVES = new Map(Object.entries({
  // authorizations
  can, cannot, canany, elsecan, elsecannot, elsecanany, endcan, endcannot, endcanany,
  // classes / styles
  class: class_, style,
  // conditionals
  auth, elseauth, endauth, guest, elseguest, endguest,
  env, endenv, production, endproduction,
  hassection, hasstack, sectionmissing,
  if: if_, unless, elseif, else: else_, endif, endunless,
  isset, endisset,
  switch: switch_, case: case_, default: default_, endswitch,
  once, endonce,
  bool, checked, disabled, required, readonly, selected,
  pushif, elsepushif, elsepush, endpushif,
  // loops
  forelse, empty: empty_, endforelse, endempty,
  for: for_, foreach: foreach_, break: break_, continue: continue_,
  endfor, endforeach, while: while_, endwhile,
  // layouts
  extends: extends_, extendsfirst, section, parent, yield: yield_,
  show, append, overwrite, stop, endsection,
  // stacks
  stack, push, pushonce, endpush, endpushonce,
  prepend, prependonce, endprepend, endprependonce,
  // includes
  each, include: include_, includeif, includewhen, includeunless,
  includefirst, includeisolated,
  // errors
  error, enderror,
  // fragments
  fragment, endfragment,
  // contexts
  context, endcontext,
  // sessions
  session, endsession,
  // translations
  lang, endlang, choice,
  // injections
  inject,
  // use statements
  use,
  // raw php
  php, unset,
  // helpers
  csrf, dd, dump, method, vite, vitereactrefresh, fonts,
  // json
  json,
  // js
  js,
  // components
  component, endcomponent, endcomponentclass, slot, endslot,
  componentfirst, endcomponentfirst, props, aware,
}));

/** Does the framework have a `compile<Name>` for this directive? */
export function hasDirective(name) {
  return DIRECTIVES.has(String(name).toLowerCase());
}
