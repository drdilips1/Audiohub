import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [preact()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || pkg.version) },
  build: { outDir: 'dist', target: 'es2020', sourcemap: false },
  test: { include: ['tests/**/*.test.js'] },
});
