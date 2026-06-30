# planet-widget

A small Three.js widget that mounts a planet scene into any HTML element.

It ships as a **single self-contained ESM module** — no runtime npm packages, no
CDN. Three.js is bundled into the output file, so a consumer only needs the built
`.js` (and the `.d.ts` for types). Drop it into any project and import it.

## Tech stack (intentionally minimal)

- [Vite](https://vite.dev/) — dev server (to view the scene) + library build.
- [TypeScript](https://www.typescriptlang.org/) — source language and `.d.ts` output.
- [vite-plugin-dts](https://github.com/qmhc/vite-plugin-dts) — emits the declaration files.
- [three](https://threejs.org/) — bundled into the output (not a peer dependency).

## Two builds

| Command             | Output       | Purpose                                              |
| ------------------- | ------------ | ---------------------------------------------------- |
| `npm run build`     | `dist/`      | **The deliverable** — library ESM bundle + `.d.ts`.  |
| `npm run build:demo`| `dist-demo/` | Static demo page (`index.html` + JS) for testing.    |

The demo bundles the widget from source — it's a sandbox to look at the scene, not
something you hand off.

## Develop

```bash
npm install
npm run dev      # dev server for the demo (index.html) with live reload
```

Other scripts:

```bash
npm run build        # library build → dist/ (deliverable)
npm run build:demo   # demo page build → dist-demo/
npm run preview:demo # serve the built demo from dist-demo/
npm run typecheck    # tsc --noEmit
```

## Build output (the deliverable)

`npm run build` writes to `dist/`:

| File                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `planet-widget.js`     | Self-contained ESM bundle (Three.js included).   |
| `planet-widget.js.map` | Source map (optional — drop it if not needed).   |
| `index.d.ts`           | Public type declarations (entry).                |
| `widget.d.ts`          | Type declarations for the widget implementation. |

These are the only files you hand off. `index.d.ts` re-exports from `widget.d.ts`,
so keep both together.

## Usage in a consuming project

```ts
import { PlanetWidget } from './planet-widget.js';

const widget = new PlanetWidget(document.getElementById('app')!, {
  waterColor: '#3aa0e0',
  landColor: '#4caf50',
  radius: 32,
  rotationSpeed: 0.3,
});

// later, to tear it down and free GPU resources:
widget.destroy();
```

The widget mounts on construction, sizes itself to the host element, and tracks
resizes via a `ResizeObserver`.

### API

```ts
class PlanetWidget {
  constructor(container: HTMLElement, options?: PlanetWidgetOptions);
  get domElement(): HTMLCanvasElement; // the rendered <canvas>
  destroy(): void;                     // stop loop, remove canvas, dispose GPU resources
}

interface PlanetWidgetOptions {
  background?: string;     // scene background color, default "#0b0f1a"
  waterColor?: string;     // ocean color,  default "#3aa0e0" (blue)
  landColor?: string;      // land color,   default "#4caf50" (green)
  radius?: number;         // sea-level radius in voxels, default 20
  rotationSpeed?: number;  // idle auto-rotation, radians per second, default 0.1
}
```

Drag to orbit the planet and use the wheel to zoom (OrbitControls; panning is
disabled so it stays centered). After 5 seconds without interaction it resumes a
slow auto-rotation around the vertical axis (north up, no axial tilt). Land tiles
sit a third of a tile above water — flat continents with a small coastal step.

### Shape (smoothing)

The body is a **solid of revolution** (`profileRadius` in `src/planet.ts`):
essentially a sphere, but **truncated at the poles** into a small flat disk so the
poles are smooth caps instead of a single-voxel point.

Tunables live at the top of `src/planet.ts`:

- `CAP_RADIUS_FRACTION` — how wide/flat the polar caps are.
- `BAND_FRACTION` — optionally inserts a cylindrical, step-free band around the
  equator. `0` keeps the body round; raising it trades roundness for a more
  barrel-like shape with a flush, staircase-free equator.

## Level of detail (voxel resolution vs. mask)

The smallest feature the planet can show is set by the **angular size of one voxel**.
Voxels are unit cubes on a Cartesian grid, so a sphere of radius `R` voxels has
roughly `2πR` voxels around a great circle:

```
degrees per voxel ≈ 57.3 / R      (smallest feature ≈ 1–2 voxels)
```

At `R = 32` that's ~1.8°/voxel (~200 km on Earth). Anything smaller than ~3–4°
(small islands, the real width of an isthmus or strait) can only be approximated.

The land mask must be **at least as fine as the voxels**, or it becomes the
bottleneck. The mask is authored as latitude bands in real degrees, so it can be
rasterized at any resolution — keep `360 / COLS° ≤ 57.3 / R°`. Bumping `R` alone
past the mask resolution only smooths the silhouette; it adds no new geography
until the mask is re-rasterized finer too.

Measured trade-offs (single `InstancedMesh` = one draw call; build cost is the
one-time occupancy scan at init):

| R  | °/voxel | voxels around equator | instances | matching mask |
| -- | ------- | --------------------- | --------- | ------------- |
| 20 | 2.86    | 126                   | ~4.3k     | 144×72        |
| 24 | 2.39    | 151                   | ~6.2k     | 144×72        |
| **32** | **1.79** | **201**           | **~11k**  | **200×100**   |
| 40 | 1.43    | 251                   | ~17k      | 256×128       |
| 48 | 1.19    | 302                   | ~24k      | 304×152       |
| 64 | 0.90    | 402                   | ~43k      | 400×200       |

**Current setting: `R = 32` with a 200×100 mask (1.8°).** Performance is not the
limiting factor at any of these — even ~43k cubes is a single cheap draw call — so
the choice is purely about how chunky vs. globe-like it should look. To change it,
set `radius` and re-rasterize the mask in `scripts/land-mask.mjs` to match.

## Geographic coordinates & markers

The continents are pulled toward the equator by a single factor, `LAT_STRETCH`
(a "cartoon map projection" — the land squeezes into a narrower equatorial band,
leaving smooth ocean caps at the poles). **This is a coordinate transform, not just
a data filter**, so it has to be applied consistently everywhere geography meets the
mesh — both when baking the land mask *and* when placing objects on the globe.

The relation between real geography and the planet surface is:

```
planetLat = geoLat / LAT_STRETCH     // latitude is compressed
planetLon = lng                      // longitude is untouched
```

To place a marker at a real `[lng, lat]`, convert to a local position on the
sphere (north pole = +Y, matching `planet.ts`):

```ts
const φ = (lat / LAT_STRETCH) * DEG2RAD;
const λ = lng * DEG2RAD;
const r = R + elevation;
const ρ = r * Math.cos(φ);
const pos = new Vector3(Math.cos(λ) * ρ, r * Math.sin(φ), -Math.sin(λ) * ρ);
```

### Single source of truth

The stretch is **baked into the land mask at authoring time** (the mask ships
already compressed, so `planet.ts` reads it directly — no per-sample multiply).
But the *value* used must survive into the runtime, or markers would drift off the
coastlines. So the generator emits it next to the data:

```ts
// src/land-mask.ts — generated
export const LAT_STRETCH = 1.2;          // ← what the mask was compressed with
const MAP: readonly string[] = [ /* … already compressed … */ ];
```

Both the mask and the coordinate helper read this one constant, so they can never
diverge. A useful consequence: every real `[lng, lat]` maps into the band
`|planetLat| ≤ 90 / LAT_STRETCH` — exactly where land can exist — so **no marker
placed by real coordinates can ever land in the polar ocean caps**. Geography and
markers line up by construction.

> Markers spin with the globe only if they share the planet's rotating pivot. The
> widget keeps the planet mesh and any markers under one rotating `Group`, so a
> marker is a child placed at its `geoToLocal` position and rotates with the Earth.

## Project layout

```
src/
  index.ts      # public entry — what gets exported to consumers
  widget.ts     # the scene, camera, lights, render loop (PlanetWidget class)
  planet.ts     # builds the hollow voxel sphere as one InstancedMesh
  land-mask.ts  # 360×180 equirectangular land/water mask + isLand(lat, lon)
  demo.ts       # demo entry that mounts into the demo page (not shipped)
index.html      # demo page
scripts/
  land-mask.mjs # rasterizes the mask from real coastlines; `node scripts/land-mask.mjs`
vite.config.ts
```

The mask is generated from real coastlines (Natural Earth 50m land): the script
rasterizes the polygons with a point-in-polygon test, drops Antarctica, and prints
orthographic previews. Regenerate with `node scripts/land-mask.mjs --ts` and paste
the array into `src/land-mask.ts`. The GeoJSON is downloaded at authoring time
only — the baked mask is what ships.
