<?php
// tests/oracle/compile.php — compile a Blade template with the REAL Laravel
// BladeCompiler and print the result as JSON. Dev-only oracle: it needs a
// Laravel app with vendor/ and is never part of the package's runtime.
//
//   php compile.php <app-root> <template-file> [--components]
//
// `--components` boots the full app first (the ComponentTagCompiler needs the
// container and the view finder); without it the compiler runs standalone.

$appRoot = $argv[1] ?? '';
$template = $argv[2] ?? '';
$withComponents = in_array('--components', $argv, true);

if ($appRoot === '' || $template === '' || !is_file($template)) {
    fwrite(STDERR, "usage: php compile.php <app-root> <template-file> [--components]\n");
    exit(2);
}

require $appRoot . '/vendor/autoload.php';

$cache = sys_get_temp_dir() . '/lw-blade-oracle-' . getmypid();
@mkdir($cache, 0777, true);

if ($withComponents) {
    $app = require $appRoot . '/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $compiler = $app->make('blade.compiler');
} else {
    $compiler = new Illuminate\View\Compilers\BladeCompiler(new Illuminate\Filesystem\Filesystem(), $cache);
}

$source = file_get_contents($template);

try {
    $compiled = $compiler->compileString($source);
    echo json_encode([
        'ok' => true,
        'compiled' => $compiled,
        'laravel' => Illuminate\Foundation\Application::VERSION,
        'php' => PHP_VERSION,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    echo json_encode([
        'ok' => false,
        'error' => get_class($e) . ': ' . $e->getMessage(),
        'laravel' => Illuminate\Foundation\Application::VERSION,
        'php' => PHP_VERSION,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
