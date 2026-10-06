// The site (demo/) is built for GitHub Pages: relative paths, output in dist/.
// Tests still run from the project root.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  test: { root: fileURLToPath(new URL('.', import.meta.url)) },
});
