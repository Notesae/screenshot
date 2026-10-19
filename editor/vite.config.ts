import { defineConfig } from 'vite';
// TSX uses the automatic JSX runtime from tsconfig. Avoid an inline refresh preamble under CSP.
export default defineConfig({ base: './', build: { outDir: 'dist', emptyOutDir: true } });
