import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      // The PDF worker ships as .mjs; the app's file server only sends .js as JavaScript.
      output: { assetFileNames: (a) => (/\.mjs$/.test(a.names?.[0] || a.name || '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') },
    },
  },
});
