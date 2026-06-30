import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * Two build targets, selected by `--mode`:
 *
 *   vite build                 → library build  → dist/      (the deliverable)
 *   vite build --mode demo     → demo HTML app  → dist-demo/ (for testing)
 *   vite                       → dev server for the demo (index.html + src/demo.ts)
 */
export default defineConfig(({ mode }) => {
  if (mode === 'demo') {
    // Plain Vite app build of index.html — bundles the widget from source.
    return {
      base: './',
      build: {
        outDir: 'dist-demo',
        emptyOutDir: true,
        // The bundle is large because it contains three.js — that's expected here.
        chunkSizeWarningLimit: 1500,
      },
    };
  }

  // Library build: a single self-contained ESM file + type declarations.
  return {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        formats: ['es'],
        fileName: () => 'planet-widget.js',
      },
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      // No externals — three.js is bundled, so the consumer needs no packages/CDN.
      rollupOptions: {},
    },
    plugins: [
      dts({
        // Emit per-module .d.ts files next to the bundle. We avoid `rollupTypes`
        // on purpose: it needs the heavyweight @microsoft/api-extractor, and two
        // tiny declaration files (index.d.ts + widget.d.ts) keep the toolchain light.
        include: ['src'],
        exclude: ['src/demo.ts'],
      }),
    ],
  };
});
