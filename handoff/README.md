# planet-widget

An animated voxel-planet that mounts into any HTML element. Drag to spin it,
scroll to zoom; it drifts back to a slow idle rotation when left alone. You can
pin markers to real geographic coordinates.

It ships as **one self-contained ES module** — Three.js is bundled inside. There
are no npm packages to install and nothing to load from a CDN. You only need the
files in this folder.

## What's in this folder

| File                   | You need it? | Purpose                                            |
| ---------------------- | ------------ | -------------------------------------------------- |
| `planet-widget.js`     | **yes**      | The widget. A single ES module, Three.js included. |
| `index.d.ts` + others  | for TS       | TypeScript type declarations (auto-picked up).     |
| `example.html`         | reference    | A minimal working page — open it to see the setup. |
| `planet-widget.js.map` | optional     | Source map. Only fetched when devtools is open.    |

Drop `planet-widget.js` (and the `.d.ts` files, if you use TypeScript) into your
project. That's the whole install.

## Requirements

- A modern browser with WebGL and ES-module support (all current evergreen browsers).
- The page must be **served over `http(s)`**, not opened as a `file://` URL — browsers
  refuse to load ES modules from the filesystem. Any static server works
  (`npx serve`, Vite, your existing dev server, the production host).

## Quick start (plain HTML)

The widget fills its host element, so give the container a size.

```html
<div id="planet" style="width: 480px; height: 480px;"></div>

<script type="module">
  import { PlanetWidget } from './planet-widget.js';

  const widget = new PlanetWidget(document.getElementById('planet'));

  // When the element goes away (e.g. SPA route change), free the GPU resources:
  // widget.destroy();
</script>
```

That's it — no options are required. Everything below is optional tuning.

## Sizing

The widget sizes itself to the host element and tracks resizes automatically (via
`ResizeObserver`). So **the container decides the size** — set its width/height with
CSS (fixed px, `%`, `vh`, a flex/grid cell, whatever). If the container has zero
height (a bare `<div>` with no styling), you'll see nothing.

## Options

Every field is optional; omit any to keep its default. Colors accept any CSS color
string (`'#4aa1fc'`, `'rebeccapurple'`, `'rgb(…)'`).

```js
const widget = new PlanetWidget(container, {
  background: '#0f1225',   // scene background color
  starfield: true,         // procedural pixel stars over the background (true | false | {…})
  waterColor: '#4aa1fc',
  landColor:  '#90e13b',
  radius: 30,              // planet size in voxels — bigger = rounder, more cubes
  rotationSpeed: 0.1,      // idle auto-rotation, radians/second
  autoRotate: false,       // start spinning on its own (resumes after 5s idle regardless)
  clouds: true,            // trailing voxel clouds (true | false | {…})
});
```

### Common groups

You rarely need these, but they're all live-tunable:

- **`material`** — `roughness`, `metalness`, `bevel` (edge rounding), `colorJitter`.
- **`terrain`** — `voxel` (cube size), `relief` (land height), `ringStep`, `poleCap`.
- **`lighting`** — `exposure`, and `hemisphere` / `key` / `fill` lights (each with
  `color`, `intensity`, `position`).

The exact shape and every default is in `index.d.ts` — your editor will autocomplete
it. If you're not using TypeScript, `example.html` shows a fuller options block.

## Markers

Pin points to real `[lat, lon]` coordinates. Each marker rides the spin and fades out
as it turns to the far side of the globe.

```js
const widget = new PlanetWidget(container, {
  markers: [
    { lat: 51.5, lon: -0.13, label: 'London' },
    { lat: 40.7, lon: -74.0, color: '#ffcc00', label: 'New York' },
    { lat: 35.7, lon: 139.7, size: 4, label: 'Tokyo' },
  ],
});
```

Per marker: `lat`, `lon` (required), plus optional `color`, `size`, `label`.
`lat` is +90 (north) … −90 (south); `lon` is −180 … +180.

## Changing it after creation

Retune a live widget without rebuilding it — cheap enough to drive from UI controls:

```js
widget.setOptions({ landColor: '#c0ffb0', rotationSpeed: 0.3 });
```

## Tearing it down

Always call `destroy()` when the widget's element is removed (route change, component
unmount). It stops the render loop, removes the canvas, and frees GPU memory.

```js
widget.destroy();
```

## Framework snippets

**React**

```jsx
import { useEffect, useRef } from 'react';
import { PlanetWidget } from './planet-widget.js';

export function Planet(props) {
  const ref = useRef(null);
  useEffect(() => {
    const widget = new PlanetWidget(ref.current, props);
    return () => widget.destroy();
  }, []); // create once; use widget.setOptions for live prop changes
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
```

**Vue 3**

```vue
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { PlanetWidget } from './planet-widget.js';

const el = ref(null);
let widget;
onMounted(() => { widget = new PlanetWidget(el.value); });
onBeforeUnmount(() => widget?.destroy());
</script>

<template>
  <div ref="el" style="width: 100%; height: 100%"></div>
</template>
```

## TypeScript

Types resolve automatically as long as the `.d.ts` files sit next to `planet-widget.js`:

```ts
import { PlanetWidget, type PlanetWidgetOptions } from './planet-widget.js';
```

## API reference

```ts
class PlanetWidget {
  constructor(container: HTMLElement, options?: PlanetWidgetOptions);
  get domElement(): HTMLCanvasElement;      // the rendered <canvas>
  setOptions(next: PlanetWidgetOptions): void; // retune a live widget
  destroy(): void;                          // stop, unmount, free GPU resources
}
```

## Controls

- **Drag** — spin the planet (it keeps a little inertia when you let go).
- **Wheel / pinch** — zoom.
- **Idle** — after ~5 seconds without interaction it resumes a slow auto-rotation.
