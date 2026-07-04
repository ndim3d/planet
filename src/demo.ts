/**
 * Demo entry. Not part of the shipped library — it mounts the widget into the
 * demo page (`index.html`) so the scene can be viewed and tested, both with
 * `npm run dev` (live) and `npm run build:demo` (static HTML build).
 *
 * A control panel (built below) exposes every {@link PlanetWidgetOptions} field. Each
 * change pushes the full option set through `widget.setOptions()`, which updates in place
 * (rebuilding only the affected mesh) and preserves the camera/spin — so tweaking a
 * slider no longer resets the view.
 */
import { PlanetWidget, type MarkerConfig, type PlanetWidgetOptions } from './index';

// Country pins (approximate centroids). "Asia" is a generic pin over East Asia.
const MARKERS: MarkerConfig[] = [
  { label: 'Argentina', lat: -35, lon: -65 },
  { label: 'Egypt', lat: 26, lon: 30 },
  { label: 'Turkey', lat: 39, lon: 35 },
  { label: 'Belarus', lat: 53.7, lon: 28 },
  { label: 'Kazakhstan', lat: 48, lon: 67 },
  { label: 'Russia', lat: 62, lon: 90 },
  { label: 'Asia', lat: 34, lon: 100 },
  { label: 'Indonesia', lat: 0, lon: 114 },
];

// Live config, seeded with the widget's own defaults. Flat here for simple binding; the
// nested `material` / `lighting` groups are assembled in toOptions().
const config = {
  radius: 30,
  background: '#0b0f1a',
  starfield: true,
  waterColor: '#2796e0',
  landColor: '#47b54b',
  autoRotate: false,
  rotationSpeed: 0.3,
  // terrain (voxel shape)
  voxel: 1.0,
  relief: 0.0,
  ringStep: 0.05,
  poleCap: 10,
  // markers (pins)
  markerVoxel: 0.16, // pin cube edge in world units (default ≈ size × 0.03)
  // clouds
  cloudsOn: true,
  cloudCount: 6,
  cloudSeed: 303,
  cloudSize: 0.9,
  cloudVoxel: 1.56, // cloud cube edge length (world units) — default LAND_CUBE * 1.3
  cloudClearance: 0.45,
  cloudLag: 0.05,
  // material
  roughness: 0.4,
  metalness: 0,
  envMapIntensity: 0.9,
  bevel: 0.10,
  colorJitter: 0.07,
  // lighting
  exposure: 1.0,
  skyColor: '#cfe0ff',
  groundColor: '#9099ad',
  hemiIntensity: 1.0,
  keyColor: '#ffffff',
  keyIntensity: 0.6,
  fillColor: '#e6eeff',
  fillIntensity: 0.3,
};

// Markers, rebuilt only when the pin voxel changes so setOptions (which compares the array
// by reference) treats an unrelated slider drag as a no-op for the pins.
let markersCache: MarkerConfig[] = MARKERS;
let markersCacheVoxel: number | undefined;
function markers(): MarkerConfig[] {
  if (config.markerVoxel !== markersCacheVoxel) {
    markersCache = MARKERS.map((m) => ({ ...m, voxel: config.markerVoxel }));
    markersCacheVoxel = config.markerVoxel;
  }
  return markersCache;
}

function toOptions(): PlanetWidgetOptions {
  return {
    background: config.background,
    starfield: config.starfield,
    waterColor: config.waterColor,
    landColor: config.landColor,
    radius: config.radius,
    autoRotate: config.autoRotate,
    rotationSpeed: config.rotationSpeed,
    clouds: config.cloudsOn
      ? {
          count: config.cloudCount,
          seed: config.cloudSeed,
          size: config.cloudSize,
          voxel: config.cloudVoxel,
          clearance: config.cloudClearance,
          lag: config.cloudLag,
        }
      : false,
    markers: markers(),
    terrain: {
      voxel: config.voxel,
      relief: config.relief,
      ringStep: config.ringStep,
      poleCap: config.poleCap,
    },
    material: {
      roughness: config.roughness,
      metalness: config.metalness,
      envMapIntensity: config.envMapIntensity,
      bevel: config.bevel,
      colorJitter: config.colorJitter,
    },
    lighting: {
      exposure: config.exposure,
      hemisphere: {
        skyColor: config.skyColor,
        groundColor: config.groundColor,
        intensity: config.hemiIntensity,
      },
      key: { color: config.keyColor, intensity: config.keyIntensity },
      fill: { color: config.fillColor, intensity: config.fillIntensity },
    },
  };
}

const stage = document.getElementById('stage');
const panel = document.getElementById('controls');

if (stage && panel) {
  const widget = new PlanetWidget(stage, toOptions());
  // Coalesce the flurry of `input` events from a slider drag into one update per frame.
  // setOptions applies the change in place (preserving the camera/spin) and only rebuilds
  // the mesh a change actually touches, so this stays cheap even during a drag.
  let pending = false;
  const rebuild = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      widget.setOptions(toOptions());
    });
  };

  // --- Control builders -----------------------------------------------------
  // Each binds to a numeric/string/boolean key of `config` and rebuilds on change.
  type NumKey = { [K in keyof typeof config]: (typeof config)[K] extends number ? K : never }[keyof typeof config];
  type StrKey = { [K in keyof typeof config]: (typeof config)[K] extends string ? K : never }[keyof typeof config];
  type BoolKey = { [K in keyof typeof config]: (typeof config)[K] extends boolean ? K : never }[keyof typeof config];

  const section = (title: string): HTMLFieldSetElement => {
    const fs = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    fs.appendChild(legend);
    panel.appendChild(fs);
    return fs;
  };

  const row = (parent: HTMLElement, labelText: string): HTMLDivElement => {
    const div = document.createElement('div');
    div.className = 'row';
    const label = document.createElement('label');
    label.textContent = labelText;
    div.appendChild(label);
    parent.appendChild(div);
    return div;
  };

  const range = (
    parent: HTMLElement,
    labelText: string,
    key: NumKey,
    min: number,
    max: number,
    step: number,
  ): HTMLInputElement => {
    const div = row(parent, labelText);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(config[key]);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = String(config[key]);
    input.addEventListener('input', () => {
      const n = Number(input.value);
      config[key] = n;
      val.textContent = Number.isInteger(step) ? String(n) : n.toFixed(2);
      rebuild();
    });
    div.append(input, val);
    return input;
  };

  const color = (parent: HTMLElement, labelText: string, key: StrKey): void => {
    const div = row(parent, labelText);
    const input = document.createElement('input');
    input.type = 'color';
    input.value = config[key];
    input.addEventListener('input', () => {
      config[key] = input.value;
      rebuild();
    });
    div.appendChild(input);
  };

  const toggle = (parent: HTMLElement, labelText: string, key: BoolKey): void => {
    const div = row(parent, labelText);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config[key];
    input.addEventListener('change', () => {
      config[key] = input.checked;
      rebuild();
    });
    div.appendChild(input);
  };

  // A full-width action button (e.g. reseed).
  const button = (parent: HTMLElement, labelText: string, onClick: () => void): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = labelText;
    btn.addEventListener('click', onClick);
    parent.appendChild(btn);
  };

  // --- Panel layout ---------------------------------------------------------
  const scene = section('Scene');
  color(scene, 'Background', 'background');
  toggle(scene, 'Starfield', 'starfield');
  color(scene, 'Water', 'waterColor');
  color(scene, 'Land', 'landColor');
  range(scene, 'Radius', 'radius', 6, 40, 1);

  const motion = section('Motion');
  toggle(motion, 'Auto-rotate', 'autoRotate');
  range(motion, 'Speed', 'rotationSpeed', 0, 1, 0.05);

  const clouds = section('Clouds');
  toggle(clouds, 'Enabled', 'cloudsOn');
  range(clouds, 'Count', 'cloudCount', 0, 20, 1);
  range(clouds, 'Base size', 'cloudSize', 0.3, 2.5, 0.05);
  range(clouds, 'Voxel size', 'cloudVoxel', 0.6, 3, 0.1);
  range(clouds, 'Clearance', 'cloudClearance', 0, 3, 0.05);
  range(clouds, 'Lag (τ)', 'cloudLag', 0, 1, 0.01);
  const seedInput = range(clouds, 'Seed', 'cloudSeed', 1, 999, 1);
  button(clouds, '🎲 Reseed', () => {
    seedInput.value = String(Math.floor(Math.random() * 999) + 1);
    seedInput.dispatchEvent(new Event('input')); // reuse the slider's handler (updates + rebuilds)
  });

  const terrain = section('Terrain');
  range(terrain, 'Voxel size', 'voxel', 0.6, 3, 0.1);
  range(terrain, 'Land relief', 'relief', 0, 4, 0.5);
  range(terrain, 'Ring step', 'ringStep', 0.25, 1, 0.05);
  range(terrain, 'Pole cap°', 'poleCap', 0, 45, 1);

  const markerSec = section('Markers');
  range(markerSec, 'Voxel size', 'markerVoxel', 0.05, 0.5, 0.01);

  const mat = section('Material');
  range(mat, 'Roughness', 'roughness', 0, 1, 0.05);
  range(mat, 'Metalness', 'metalness', 0, 1, 0.05);
  range(mat, 'Env reflect', 'envMapIntensity', 0, 2, 0.05);
  range(mat, 'Bevel', 'bevel', 0, 0.5, 0.01);
  range(mat, 'Color jitter', 'colorJitter', 0, 0.3, 0.01);

  const light = section('Lighting');
  range(light, 'Exposure', 'exposure', 0, 2, 0.05);
  color(light, 'Sky', 'skyColor');
  color(light, 'Ground', 'groundColor');
  range(light, 'Hemi', 'hemiIntensity', 0, 2, 0.05);
  color(light, 'Key', 'keyColor');
  range(light, 'Key int', 'keyIntensity', 0, 2, 0.05);
  color(light, 'Fill', 'fillColor');
  range(light, 'Fill int', 'fillIntensity', 0, 2, 0.05);
}
