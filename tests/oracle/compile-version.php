<?php
// tests/oracle/compile-version.php — compile a template with a STANDALONE
// BladeCompiler from an installed laravel/framework of a given major.
//
//   php compile-version.php <framework-install-dir> <template-file>
//
// The install dir is a composer project whose only requirement is
// laravel/framework (tests/oracle/versions/l10|l11|l12). No app is booted, so
// the ComponentTagCompiler path is unavailable — exactly like the corpus run
// without --components.

$dir = $argv[1] ?? '';
$template = $argv[2] ?? '';

if ($dir === '' || $template === '' || !is_file($template)) {
    fwrite(STDERR, "usage: php compile-version.php <framework-dir> <template-file>\n");
    exit(2);
}

require $dir . '/vendor/autoload.php';

$cache = sys_get_temp_dir() . '/lw-blade-v-' . getmypid();
@mkdir($cache, 0777, true);

$compiler = new Illuminate\View\Compilers\BladeCompiler(
    new Illuminate\Filesystem\Filesystem(),
    $cache
);

try {
    echo json_encode([
        'ok' => true,
        'compiled' => $compiler->compileString(file_get_contents($template)),
        'laravel' => Illuminate\Foundation\Application::VERSION,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    echo json_encode([
        'ok' => false,
        'error' => get_class($e) . ': ' . $e->getMessage(),
        'laravel' => Illuminate\Foundation\Application::VERSION,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
