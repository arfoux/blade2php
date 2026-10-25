#!/usr/bin/env node
// Copy the component fixtures into a Laravel app so the oracle can compile
// `<x-alert>` / `<x-forms.input>`. PSR-4 means no autoload re-dump is needed.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = process.argv[2];
if (!app) { console.error('usage: node install.mjs <app-root>'); process.exit(2); }

for (const rel of ['app/View/Components', 'resources/views/components/forms']) {
  mkdirSync(join(app, rel), { recursive: true });
}
cpSync(join(here, 'app/View/Components/Alert.php'), join(app, 'app/View/Components/Alert.php'));
cpSync(join(here, 'resources/views/components/alert.blade.php'), join(app, 'resources/views/components/alert.blade.php'));
cpSync(join(here, 'resources/views/components/forms/input.blade.php'), join(app, 'resources/views/components/forms/input.blade.php'));
console.log('fixtures installed into', app);
