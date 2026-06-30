# Project rules for planet-widget

## Deliverable

- Ships as a **single self-contained ESM module** (`dist/planet-widget.js`) + `.d.ts` files.
- Three.js is **bundled into** the output. No runtime npm packages, no CDN for the consumer.
- Toolchain is intentionally minimal: Vite (lib mode) + TypeScript + vite-plugin-dts.
  Do not add heavy tooling (e.g. `@microsoft/api-extractor`) without a reason.

## Three.js tree-shaking — DO NOT BREAK

We bundle three, but it must stay tree-shakeable. three is ESM and mostly
`sideEffects: false`, so Rollup/Vite drops what we don't import. Keep it that way:

1. **Only named imports from `'three'`**: `import { Scene, WebGLRenderer } from 'three'`.
   NEVER `import * as THREE from 'three'` — the namespace import kills tree-shaking.
2. **Import addons by their specific path**, not via a barrel:
   `import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'`.
3. **Never re-export all of `THREE`** from `src/index.ts` (or anywhere public).
   Export only our own API surface.

Reason: namespace imports / barrel re-exports force the whole three graph into the
bundle. With named imports, unused loaders/controls/materials are removed. The `WebGLRenderer`
core graph is large and indivisible, so the size floor stays ~130–140 KB gzip — that's
expected; tree-shaking mainly saves us from pulling in addons we don't use.
