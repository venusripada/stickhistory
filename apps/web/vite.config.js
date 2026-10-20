import { defineConfig } from 'vite';

// base: './' keeps every asset path relative, so the built `dist/` folder
// works from any static host or sub-path (GitHub Pages, Netlify, S3…).
export default defineConfig({
  base: './',
  // the library API runs on its own port in development (npm run dev starts both)
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:5174', changeOrigin: false } } },
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: true },
});
