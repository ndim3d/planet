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
import { PlanetWidget, DEFAULTS, type MarkerConfig, type PlanetWidgetOptions } from './index';

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

// Live config for the control panel. Flat here for simple binding; the nested
// `material` / `lighting` / `clouds` groups are assembled in toOptions().
//
// Single source of truth: every value that has a widget default is read from DEFAULTS, so
// the panel never keeps a second copy. Only the handful of knobs the demo deliberately sets
// differently (or that aren't widget defaults at all, like the pin voxel and cloud seed) are
// spelled out as literals below.
const D = DEFAULTS;
const config = {
  radius: D.radius,
  background: D.background,
  // `as boolean` re-widens the satisfies-preserved `true`/`false` literals so the flat
  // boolean control binding (BoolKey) stays sound.
  starfield: D.starfield as boolean,
  waterColor: D.waterColor,
  landColor: D.landColor,
  autoRotate: D.autoRotate as boolean,
  rotationSpeed: D.rotationSpeed,
  // terrain (voxel shape)
  voxel: D.terrain.voxel,
  relief: D.terrain.relief,
  ringStep: D.terrain.ringStep,
  poleCap: D.terrain.poleCap,
  // markers (pins) — no widget default (pins fall back to a size-proportional voxel); demo
  // sets an explicit fine voxel for all pins via the widget's markerVoxelSize option.
  markerVoxelSize: 0.2, // pin cube edge in world units
  // clouds
  cloudsOn: true,
  cloudCount: D.clouds.count,
  cloudSeed: D.clouds.seed,
  cloudSize: D.clouds.size, // widget default: 1
  cloudVoxel: D.clouds.voxel,
  cloudClearance: D.clouds.clearance,
  cloudLag: D.clouds.lag,
  // material
  roughness: D.material.roughness,
  metalness: D.material.metalness,
  bevel: D.material.bevel,
  colorJitter: D.material.colorJitter,
  // lighting
  exposure: D.lighting.exposure,
  skyColor: D.lighting.hemisphere.skyColor,
  groundColor: D.lighting.hemisphere.groundColor,
  hemiIntensity: D.lighting.hemisphere.intensity,
  keyColor: D.lighting.key.color,
  keyIntensity: D.lighting.key.intensity,
  fillColor: D.lighting.fill.color,
  fillIntensity: D.lighting.fill.intensity,
};

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
    markers: MARKERS,
    markerVoxelSize: config.markerVoxelSize,
    terrain: {
      voxel: config.voxel,
      relief: config.relief,
      ringStep: config.ringStep,
      poleCap: config.poleCap,
    },
    material: {
      roughness: config.roughness,
      metalness: config.metalness,
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

  // One shared hint tooltip, mounted on <body> (not inside the panel) so #controls' overflow
  // can't clip it; positioned in JS just below the hovered/focused "i" badge, flipped above
  // when it would run off the bottom, and clamped horizontally to the viewport.
  const tooltip = document.createElement('div');
  tooltip.id = 'tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);
  const showTip = (anchor: HTMLElement, text: string): void => {
    tooltip.textContent = text;
    tooltip.classList.add('show');
    const a = anchor.getBoundingClientRect();
    const t = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
    let top = a.bottom + 6;
    if (top + t.height > window.innerHeight - 8) top = a.top - t.height - 6; // flip above
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const hideTip = (): void => tooltip.classList.remove('show');
  panel.addEventListener('scroll', hideTip); // a fixed tooltip would otherwise drift on scroll

  const section = (title: string, hint: string): HTMLFieldSetElement => {
    const fs = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    // An "i" badge next to the title; hover/focus reveals the hint in the shared tooltip.
    const info = document.createElement('span');
    info.className = 'info';
    info.textContent = 'i';
    info.tabIndex = 0;
    info.setAttribute('aria-label', hint);
    info.addEventListener('mouseenter', () => showTip(info, hint));
    info.addEventListener('mouseleave', hideTip);
    info.addEventListener('focus', () => showTip(info, hint));
    info.addEventListener('blur', hideTip);
    legend.append(' ', info);
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
  // Order for a designer: what they retune most (colours, material) sits at the top, then
  // clouds, then the rest (lighting, shape, markers, motion).
  const colors = section('Цвета', 'Основные цвета сцены — то, что дизайнер подгоняет в первую очередь: фон, звёзды, вода и суша.');
  color(colors, 'Фон', 'background');
  toggle(colors, 'Звёзды', 'starfield');
  color(colors, 'Вода', 'waterColor');
  color(colors, 'Суша', 'landColor');

  const mat = section('Материал', 'Как поверхность реагирует на свет: матовость, металличность, скругление кубиков и разброс их яркости.');
  range(mat, 'Шероховатость', 'roughness', 0, 1, 0.05);
  range(mat, 'Металличность', 'metalness', 0, 1, 0.05);
  range(mat, 'Фаска', 'bevel', 0, 0.5, 0.01);
  range(mat, 'Разброс цвета', 'colorJitter', 0, 0.3, 0.01);

  const clouds = section('Облака', 'Облачный слой над планетой: количество, размер, зазор до поверхности и инерция следования за вращением.');
  toggle(clouds, 'Показывать', 'cloudsOn');
  range(clouds, 'Количество', 'cloudCount', 0, 20, 1);
  range(clouds, 'Базовый размер', 'cloudSize', 0.3, 2.5, 0.05);
  range(clouds, 'Размер вокселя', 'cloudVoxel', 0.6, 3, 0.1);
  range(clouds, 'Зазор', 'cloudClearance', 0, 3, 0.05);
  range(clouds, 'Инерция (τ)', 'cloudLag', 0, 1, 0.01);
  const seedInput = range(clouds, 'Сид', 'cloudSeed', 1, 999, 1);
  button(clouds, '🎲 Пересоздать', () => {
    seedInput.value = String(Math.floor(Math.random() * 999) + 1);
    seedInput.dispatchEvent(new Event('input')); // reuse the slider's handler (updates + rebuilds)
  });

  const light = section('Освещение', 'Экспозиция тонмаппинга и цвета/интенсивности источников света: полусфера, ключевой и заливка.');
  range(light, 'Экспозиция', 'exposure', 0, 2, 0.05);
  color(light, 'Небо', 'skyColor');
  color(light, 'Земля', 'groundColor');
  range(light, 'Полусфера', 'hemiIntensity', 0, 2, 0.05);
  color(light, 'Ключевой', 'keyColor');
  range(light, 'Ключевой, инт.', 'keyIntensity', 0, 2, 0.05);
  color(light, 'Заливка', 'fillColor');
  range(light, 'Заливка, инт.', 'fillIntensity', 0, 2, 0.05);

  const terrain = section('Форма планеты', 'Геометрия глобуса: радиус, размер вокселя, высота рельефа суши, шаг колец и размер полярной шапки.');
  range(terrain, 'Радиус', 'radius', 6, 40, 1);
  range(terrain, 'Размер вокселя', 'voxel', 0.6, 3, 0.1);
  range(terrain, 'Рельеф суши', 'relief', 0, 4, 0.5);
  range(terrain, 'Шаг колец', 'ringStep', 0.25, 1, 0.05);
  range(terrain, 'Полярная шапка°', 'poleCap', 0, 45, 1);

  const markerSec = section('Маркеры', 'Булавки-метки на поверхности планеты — их размер в вокселях.');
  range(markerSec, 'Размер вокселя', 'markerVoxelSize', 0.05, 0.5, 0.01);

  const motion = section('Движение', 'Автоматическое медленное вращение планеты, когда её не крутят вручную.');
  toggle(motion, 'Автоповорот', 'autoRotate');
  range(motion, 'Скорость', 'rotationSpeed', 0, 1, 0.05);
}
