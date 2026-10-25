import { compile } from './src/index.mjs';
try {
  const out = compile('<x-alert type="danger" />', { app: './tests/fixtures/app' });
  console.log('OK:', out.split('\n')[2].slice(0, 90));
} catch (e) {
  console.log('FAIL:', e.constructor.name, '|', e.message.slice(0, 200));
}
