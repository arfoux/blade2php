<?php
// tests/oracle/batch.php — compile every *.blade.php in a directory with the
// REAL Laravel BladeCompiler, in ONE process. Fuzzing needs thousands of
// compiles; spawning PHP per template would dominate the runtime.
//
//   php batch.php <app-root> <dir>   ->  {"<file>": {"ok":true,"compiled":"…"} | {"ok":false,"error":"…"}}

$appRoot = $argv[1] ?? '';
$dir = $argv[2] ?? '';

if ($appRoot === '' || $dir === '' || !is_dir($dir)) {
    fwrite(STDERR, "usage: php batch.php <app-root> <dir>\n");
    exit(2);
}

require $appRoot . '/vendor/autoload.php';

$cache = sys_get_temp_dir() . '/lw-blade-batch-' . getmypid();
@mkdir($cache, 0777, true);

if (in_array('--components', $argv, true)) {
    // ComponentTagCompiler resolves through the container + view finder.
    $app = require $appRoot . '/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $compiler = $app->make('blade.compiler');
} else {
    $compiler = new Illuminate\View\Compilers\BladeCompiler(
        new Illuminate\Filesystem\Filesystem(),
        $cache
    );
}

$out = [];
foreach (glob($dir . '/*.blade.php') ?: [] as $file) {
    try {
        $out[basename($file)] = [
            'ok' => true,
            'compiled' => $compiler->compileString(file_get_contents($file)),
        ];
    } catch (Throwable $e) {
        $out[basename($file)] = [
            'ok' => false,
            'error' => get_class($e) . ': ' . $e->getMessage(),
        ];
    }
}

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
