import { defineConfig } from 'vite';

// base: './' keeps every asset path relative, so the built `dist/` folder
// works from any static host or sub-path (GitHub Pages, Netlify, S3…).
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: true },
});
