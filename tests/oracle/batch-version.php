<?php
// tests/oracle/batch-version.php — compile a whole directory with a standalone
// BladeCompiler from an installed laravel/framework of a given major.
//
//   php batch-version.php <framework-dir> <template-dir>
$dir = $argv[1] ?? '';
$tplDir = $argv[2] ?? '';
if ($dir === '' || $tplDir === '' || !is_dir($tplDir)) {
    fwrite(STDERR, "usage: php batch-version.php <framework-dir> <template-dir>\n");
    exit(2);
}
require $dir . '/vendor/autoload.php';
$cache = sys_get_temp_dir() . '/lw-blade-bv-' . getmypid();
@mkdir($cache, 0777, true);
$compiler = new Illuminate\View\Compilers\BladeCompiler(new Illuminate\Filesystem\Filesystem(), $cache);
$out = [];
foreach (glob($tplDir . '/*.blade.php') ?: [] as $file) {
    try {
        $out[basename($file)] = ['ok' => true, 'compiled' => $compiler->compileString(file_get_contents($file))];
    } catch (Throwable $e) {
        $out[basename($file)] = ['ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()];
    }
}
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
