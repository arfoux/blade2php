<?php
// tests/oracle/resolve.php — what does the REAL ComponentTagCompiler resolve?
//
//   php resolve.php <app-root> <name> [<name> …]
//
// Prints { "<name>": {"class": "…"} | {"error": "…"} } — the ground truth the
// static discovery in src/discovery.mjs must match.

$appRoot = $argv[1] ?? '';
$names = array_slice($argv, 2);
if ($appRoot === '' || $names === []) {
    fwrite(STDERR, "usage: php resolve.php <app-root> <name> [...]\n");
    exit(2);
}

require $appRoot . '/vendor/autoload.php';

$app = require $appRoot . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

// BladeCompiler::compileComponentTags() passes its registered aliases and
// namespaces to the ComponentTagCompiler; they are protected, so read them the
// same way the framework hands them over.
$blade = $app->make('blade.compiler');
$read = static function (object $o, string $prop) {
    $r = new ReflectionClass($o);
    $p = $r->getProperty($prop);
    $p->setAccessible(true);
    return $p->getValue($o);
};
$compiler = new Illuminate\View\Compilers\ComponentTagCompiler(
    $read($blade, 'classComponentAliases'),
    $read($blade, 'classComponentNamespaces'),
    $blade
);
$out = [];

foreach ($names as $name) {
    try {
        $out[$name] = ['class' => $compiler->componentClass($name)];
    } catch (Throwable $e) {
        $out[$name] = ['error' => get_class($e) . ': ' . $e->getMessage()];
    }
}

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
