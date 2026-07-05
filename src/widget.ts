import {
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from 'three';
import { buildPlanet } from './planet';
import { buildClouds, CLOUD_DEFAULTS, type BuildCloudsOptions } from './cloud';
import { buildStarfield, type StarfieldOptions } from './starfield';
import { Marker, type MarkerConfig } from './marker';

/** Tunables of one directional light. All fields optional. */
export interface DirectionalLightOptions {
  /** Light color (any CSS / hex color). */
  color?: string;
  /** Light intensity. */
  intensity?: number;
  /** World position the light shines from, as `[x, y, z]`. */
  position?: [number, number, number];
}

/** Lighting and tone-mapping tunables. All fields optional; omitted ones keep defaults. */
export interface PlanetLightingOptions {
  /** Tone-mapping exposure. Defaults to `1.0`. */
  exposure?: number;
  /** Rotation-independent sky→ground hemisphere fill. */
  hemisphere?: {
    /** Up-facing tint. Defaults to `#cfe0ff`. */
    skyColor?: string;
    /** Down-facing tint (kept light so the lower hemisphere keeps its colour). Defaults to `#9099ad`. */
    groundColor?: string;
    /** Intensity. Defaults to `1.0`. */
    intensity?: number;
  };
  /** Main key light from the upper right (fixed studio light). Defaults to white, `1.6`, at `[8, 6, 5]`. */
  key?: DirectionalLightOptions;
  /** Soft fill from the lower left, lifting the shadow side. Defaults to `#dce6ff`, `0.35`, at `[-7, -3, 3]`. */
  fill?: DirectionalLightOptions;
}

/** Surface material / cube appearance tunables. All fields optional. */
export interface PlanetMaterialOptions {
  /** Roughness, 0 (glossy) … 1 (matte). Defaults to `0.55`. */
  roughness?: number;
  /** Metalness, 0 … 1. Defaults to `0`. */
  metalness?: number;
  /** Cube edge chamfer, as a fraction of one cube. Defaults to `0.15`. */
  bevel?: number;
  /** Per-cube brightness jitter (± fraction) so fields aren't dead-flat. Defaults to `0.06`. */
  colorJitter?: number;
}

/** Terrain / voxel-shape tunables. All fields optional. */
export interface PlanetTerrainOptions {
  /** Cube edge length in world units — the voxel lattice pitch. Defaults to `1.2`. */
  voxel?: number;
  /** Land relief in voxel layers raised above the ocean. Defaults to `1.0`. */
  relief?: number;
  /** Ring-radius step, as a fraction of a voxel (smaller = smoother curvature). Defaults to `1.0`. */
  ringStep?: number;
  /** Flat polar-cap half-angle in degrees (bigger = larger flat cap at the poles). Defaults to `20`. */
  poleCap?: number;
}

/** Cloud generation + behaviour tunables. Extends the field-scatter options with `lag`. */
export interface PlanetCloudOptions extends BuildCloudsOptions {
  /**
   * Rubber-band follow lag, in seconds: the clouds ease toward the planet's orientation
   * with this time constant, so they trail a fast spin and settle when it stops. `0` makes
   * them turn rigidly with the globe. Defaults to `0.05`.
   */
  lag?: number;
}

/** Options accepted by the {@link PlanetWidget} constructor. All fields are optional. */
export interface PlanetWidgetOptions {
  /** Background color of the scene (any CSS / hex color). Defaults to `#0b0f1a`. */
  background?: string;
  /**
   * Static pixel-star field drawn over the {@link PlanetWidgetOptions.background} colour.
   * Pass `true` for the default field, a {@link StarfieldOptions} object to tune it, or
   * omit / `false` for a plain solid background. Fully procedural (no image asset).
   */
  starfield?: boolean | StarfieldOptions;
  /** Water color. Defaults to `#2796e0` (blue). */
  waterColor?: string;
  /** Land color. Defaults to `#47b54b` (green). */
  landColor?: string;
  /** Sea-level radius in voxels. Defaults to `20`. */
  radius?: number;
  /** Idle auto-rotation speed in radians per second. Defaults to `0.1`. */
  rotationSpeed?: number;
  /** Whether the planet slowly auto-rotates when idle. Defaults to `true`. */
  autoRotate?: boolean;
  /** Surface material / cube appearance. Omitted fields keep their defaults. */
  material?: PlanetMaterialOptions;
  /** Terrain / voxel shape (resolution, land relief, terrace step). Omitted fields keep their defaults. */
  terrain?: PlanetTerrainOptions;
  /** Lighting and tone mapping. Omitted fields keep their defaults. */
  lighting?: PlanetLightingOptions;
  /**
   * Pin markers to place on the surface. Each rides the planet's spin and hides when
   * it turns to the far side. A marker's `size` defaults to `radius * 0.18`.
   */
  markers?: MarkerConfig[];
  /**
   * Edge length of every pin's voxel cube, in world units — applies to all {@link markers}.
   * Smaller renders finer pins. Omit to let each pin use its size-proportional default (so a
   * pin keeps the same fine look whatever its `size`).
   */
  markerVoxelSize?: number;
  /**
   * Background voxel clouds that trail the planet's spin. Pass `false` to hide them,
   * `true` (default) for the default field, or a {@link PlanetCloudOptions} object to
   * control count, seed, size, surface clearance and follow lag.
   */
  clouds?: boolean | PlanetCloudOptions;
}

/**
 * The fully-resolved options the widget falls back on for every field the caller omits —
 * the single source of truth for the defaults. The constructor merges caller options over
 * this, and the demo imports it to seed its control panel, so no default value is written
 * twice: the demo only spells out the few knobs it deliberately sets differently.
 *
 * Notes on the chosen values:
 * - Matte-plastic toy look (see the reference art): no environment map at all — just a bright
 *   diffuse hemisphere fill plus two directional lights. `metalness` 0 (plastic is a
 *   dielectric), a mid `roughness` so the directional speculars read as a soft plastic sheen
 *   rather than a mirror dot, and a rounded `bevel` so the edges catch a bright rim.
 * - Form-emphasising key from the upper right (see the reference: the right of the globe is
 *   lit, the left falls into shadow). The key sits in world/camera space, not on the spin
 *   axis, so it is a fixed studio light: the planet turns underneath it and terrain brightens
 *   as it swings to the lit right side and dims to the shadowed left — the intended read of a
 *   rotating toy globe, not a bright patch pinned to one longitude. The hemisphere is the
 *   rotation-independent ambient that keeps the shadow side coloured (never black) and gives
 *   the top→bottom form; a weak fill from the lower left lifts the deepest shadows without
 *   killing the contrast. Because the key now reaches the camera-facing side walls (their
 *   normals point out through +X/+Z), the hemisphere no longer has to carry them alone, so it
 *   is dialled back from the flat, near-shadowless fill it was before.
 * - `clouds` is spelled out as the resolved cloud-field object (from the cloud module, plus
 *   the widget-level follow `lag`); passing it is equivalent to `clouds: true`.
 */
export const DEFAULTS = {
  background: '#0f1225',
  starfield: true,
  waterColor: '#4aa1fc',
  landColor: '#90e13b',
  radius: 30,
  rotationSpeed: 0.1,
  autoRotate: false,
  clouds: { ...CLOUD_DEFAULTS, lag: 0.05 },
  material: {
    roughness: 0.55,
    metalness: 0,
    bevel: 0.15,
    colorJitter: 0.04,
  },
  terrain: {
    voxel: 1,
    relief: 0.5,
    ringStep: 0.75,
    poleCap: 10,
  },
  lighting: {
    exposure: 1.45,
    hemisphere: { skyColor: '#ffffff', groundColor: '#7c89a3', intensity: 1.65 },
    key: { color: '#ffffff', intensity: 1.9, position: [5, 8, 5] as [number, number, number] },
    fill: { color: '#dce6ff', intensity: 0.3, position: [-7, -3, 3] as [number, number, number] },
  },
  markerVoxelSize: 0.32,
} satisfies Required<Omit<PlanetWidgetOptions, 'markers'>>;

const FOV = 45;

/** Idle time before auto-rotation resumes after the last user interaction. */
const IDLE_RESUME_MS = 5000;

// Markers draw in a second pass over a cleared depth buffer (see render): depth still
// makes each pin self-occlude its own thickness, but neither the globe nor the clouds
// can occlude a pin — so a marker never sinks into a cloud floating over the same spot.
const MARKER_LAYER = 1;

// Drag-to-spin: the planet (not the camera) rotates, carrying the surface and its markers;
// the clouds ease after it with a lag. It is driven by two angles, never a free tumble, so
// there is no roll about Z: horizontal drag is yaw about the pole (longitude), vertical
// drag is pitch about OX (tilting the pole toward/away from the camera). Orientation each
// frame is R_x(tilt) · R_y(spin), which keeps the north–south axis in the Y–Z plane.
const POLE = new Vector3(0, 1, 0); // yaw axis — the planet's north–south axis
const PITCH_AXIS = new Vector3(1, 0, 0); // tilt axis — OX
const DRAG_SENSITIVITY = 0.005; // radians per pixel dragged
const SPIN_DAMPING = 4; // yaw inertia decay after release; higher settles faster
const MAX_TILT = 0.5; // clamp pitch (~28°) — allow only a gentle tilt around the equator view
// Initial orientation: face Eurasia. `spin` yaws the ~75°E meridian onto the camera axis
// (spin 0 faces the mid-Pacific at 90°W), and `tilt` lifts the northern hemisphere so the
// view centres near 30°N,75°E — Europe→Siberia→China all on the near face. Derived to put
// that geographic point on the camera axis; tilt kept within MAX_TILT so a first drag doesn't snap.
const INITIAL_SPIN = -2.88;
const INITIAL_TILT = 0.455;
// Clouds trail the planet on a rubber band: rather than turning rigidly with it, they ease
// toward its orientation each frame (first-order smoothing). The follow lag (time constant
// in seconds) is per-instance (see `clouds.lag`); the fallback when unset is
// `DEFAULTS.clouds.lag` — larger lags the clouds further behind and settles them slower, 0
// makes them turn rigidly.
const _qSpin = new Quaternion();
const _qTilt = new Quaternion();
// Angular gap (radians) below which the trailing clouds are snapped onto the planet and the
// rubber-band follow is declared settled — so an idle, aligned scene stops re-rendering.
const CLOUD_SETTLE_EPS = 1e-3;

/**
 * A voxel Earth-like planet rendered with Three.js, mounted into an HTML element.
 *
 * The widget mounts itself on construction: it appends a canvas to `container`,
 * sizes to it, tracks resizes via a `ResizeObserver`, and starts a render loop.
 * Drag spins the planet in place (the camera stays put; the clouds trail on a rubber
 * band) with inertia; the wheel zooms. After {@link IDLE_RESUME_MS} of no interaction it resumes a
 * slow auto-rotation. Call {@link PlanetWidget.destroy} to tear it down and free GPU
 * resources.
 *
 * @example
 * ```ts
 * const widget = new PlanetWidget(document.getElementById('app')!, { radius: 20 });
 * // later:
 * widget.destroy();
 * ```
 */
export class PlanetWidget {
  private readonly container: HTMLElement;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private planet!: InstancedMesh;
  private markers: Marker[] = [];
  // Voxel clouds: added to the scene (not parented), their orientation eased toward the
  // planet's each frame so they trail its spin on a rubber band (see cloudLag).
  private clouds?: InstancedMesh;
  private readonly resizeObserver: ResizeObserver;
  // Upper bound on device-pixel-ratio (2 desktop / 1.5 touch, see constructor). The actual
  // ratio is min(window.devicePixelRatio, cap) and is re-applied on every resize / DPR change.
  private readonly pixelRatioCap: number;
  // Fires when devicePixelRatio leaves its current value (monitor move, browser zoom) — a
  // change a container ResizeObserver can miss, since the CSS box size need not change. Re-armed
  // after each change because the query only matches one exact ratio.
  private dprMediaQuery?: MediaQueryList;
  private minDistance: number;
  private maxDistance: number;

  // Lights, kept so setOptions can retune them live (see applyLighting).
  private readonly hemi: HemisphereLight;
  private readonly key: DirectionalLight;
  private readonly fill: DirectionalLight;
  // Scene background colour, mutated in place by setOptions.
  private readonly background: Color;
  // Static star-field config + its generated texture (when enabled); see applyBackground.
  private starfield: StarfieldOptions | false;
  private bgTexture?: CanvasTexture;

  // Normalised, live-editable copy of the resolved options; setOptions edits these in
  // place and rebuilds only the mesh (planet / markers / clouds) each change touches.
  private radius: number;
  private waterColor: string;
  private landColor: string;
  private material: Required<PlanetMaterialOptions>;
  private terrain: Required<PlanetTerrainOptions>;
  private lighting: typeof DEFAULTS.lighting;
  private markerConfigs: MarkerConfig[];
  private markerVoxelSize?: number; // pin cube edge (world units); undefined = per-pin default
  private cloudsEnabled: boolean;
  private cloudGen: BuildCloudsOptions;
  private cloudLag: number; // rubber-band follow lag for the clouds, in seconds
  private rotationSpeed: number;
  private autoRotate: boolean;
  private frameId = 0;
  private lastTime = 0;
  private destroyed = false;
  // On-demand rendering: the rAF loop keeps ticking (for input latency), but a frame is only
  // drawn — and the shadow map only rebuilt — when `dirty`. Every mutation point (drag, zoom,
  // inertia, auto-rotate, cloud settling, and the rebuild/apply helpers) sets it; a static,
  // settled scene then issues no draw calls, so the phone stays cool and doesn't throttle.
  private dirty = true;
  // Whether the trailing clouds are still easing toward the planet's orientation. False once
  // they've caught up (see CLOUD_SETTLE_EPS), so a settled scene stops the per-frame slerp.
  private cloudsSettling = true;
  // Auto-rotation pauses while the user interacts and for IDLE_RESUME_MS after.
  private interacting = false;
  private lastInteractionEnd = 0;
  // Drag-to-spin state: two accumulated angles (no roll) + yaw inertia after release.
  private dragging = false;
  private activePointer: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastPointerTime = 0;
  private spin = INITIAL_SPIN; // yaw about the pole (longitude), also driven by auto-rotation
  private tilt = INITIAL_TILT; // pitch about OX (clamped to ±MAX_TILT)
  private spinVel = 0; // yaw inertia (rad/s) after release

  constructor(container: HTMLElement, options: PlanetWidgetOptions = {}) {
    const opts = { ...DEFAULTS, ...options };
    const material = { ...DEFAULTS.material, ...options.material };
    const terrain = { ...DEFAULTS.terrain, ...options.terrain };
    // Per-group shallow merge so a caller can override e.g. just `key.intensity`.
    const lighting = {
      exposure: options.lighting?.exposure ?? DEFAULTS.lighting.exposure,
      hemisphere: { ...DEFAULTS.lighting.hemisphere, ...options.lighting?.hemisphere },
      key: { ...DEFAULTS.lighting.key, ...options.lighting?.key },
      fill: { ...DEFAULTS.lighting.fill, ...options.lighting?.fill },
    };
    this.container = container;

    // Normalised, live-editable option state (setOptions edits these in place).
    this.radius = opts.radius;
    this.waterColor = opts.waterColor;
    this.landColor = opts.landColor;
    this.material = material;
    this.terrain = terrain;
    this.lighting = lighting;
    this.markerConfigs = options.markers ?? [];
    this.markerVoxelSize = options.markerVoxelSize;
    this.rotationSpeed = opts.rotationSpeed;
    this.autoRotate = opts.autoRotate;
    this.cloudsEnabled = opts.clouds !== false;
    // A `clouds` object overrides the field's count/seed/size/clearance (rebuilds the
    // mesh) and its `lag` (a live tick tunable); `true`/`false` just toggle the default field.
    const cloudObj = typeof opts.clouds === 'object' ? opts.clouds : {};
    const { lag: cloudLag, ...cloudGen } = cloudObj;
    this.cloudGen = cloudGen;
    this.cloudLag = cloudLag ?? DEFAULTS.clouds.lag;

    this.scene = new Scene();
    this.background = new Color(opts.background);
    this.starfield = opts.starfield === true ? {} : opts.starfield || false;
    this.applyBackground();

    this.camera = new PerspectiveCamera(FOV, 1, 0.1, opts.radius * 10);
    // Start at the farthest zoom the wheel allows (maxDistance = radius · 4.5, set below).
    this.camera.position.set(0, 0, opts.radius * 4.5);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    // Cap the device-pixel-ratio lower on phones/tablets. The scene is fragment-bound (a
    // full-screen PBR fill per pixel, plus MSAA), and a retina phone at DPR 2 shades ~4× the
    // pixels of DPR 1 — the single biggest cost on mobile. Capping touch devices to 1.5
    // (vs 2 on desktop) cuts fragment work ~44% for a sharpness drop that is barely visible
    // on a dense phone screen. `(hover: none) and (pointer: coarse)` is true on phones/tablets
    // but false on a laptop with a trackpad (even a touchscreen one), so desktops keep DPR 2.
    const coarsePointer =
      typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.pixelRatioCap = coarsePointer ? 1.5 : 2;
    this.applyPixelRatio();
    // Khronos PBR-Neutral tone mapping: rolls off blown highlights without the strong
    // desaturation/whitening that ACES gives, so the greens and blues stay vivid
    // instead of washing out toward the lit pole. Exposure kept just under 1 so the
    // top-lit cubes don't clip.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = lighting.exposure;
    // Soft shadow maps: the key light casts real shadows so cubes shade each other, the land
    // relief drops shadows onto the water, and the clouds cast onto the globe — depth from one
    // side (unlike a symmetric baked outline). VSM (variance shadow maps) blurs the shadow map
    // with a Gaussian so the shadows have a soft penumbra instead of a hard voxel-sharp edge
    // (see the key's `radius`/`blurSamples`), which suits the soft toy look. We render in two
    // passes (globe+clouds, then markers), so drive the shadow update by hand: refresh it once
    // per frame before the first pass, not again for the marker overlay (see render).
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // No environment map: the look is carried entirely by a diffuse hemisphere ambient plus
    // two directional lights (see DEFAULTS). The hemisphere gives a rotation-independent
    // top→bottom gradient and keeps the shadow side coloured; the key from the upper right
    // sculpts the form (lit right, shadowed left) as a fixed studio light the planet turns
    // under, and a weak lower-left fill lifts the deepest shadows. All three are kept as
    // fields so setOptions can retune them live (see applyLighting).
    this.hemi = new HemisphereLight(
      lighting.hemisphere.skyColor,
      lighting.hemisphere.groundColor,
      lighting.hemisphere.intensity,
    );
    this.key = new DirectionalLight(lighting.key.color, lighting.key.intensity);
    // The key casts the scene's shadows. Its shadow camera sits at the light, so we place the
    // light well outside the globe along its configured direction (see positionKey) and give it
    // a soft, biased map big enough to resolve the seams between cubes.
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.1;
    // VSM Gaussian blur: `radius` is the blur width in texels, `blurSamples` its quality — the
    // penumbra that turns the hard voxel-sharp edges soft.
    this.key.shadow.radius = 3.5;
    // Blur-sample count is the quality of the VSM Gaussian, not the penumbra width (that's
    // `radius`). 10 taps are enough to keep the soft edge smooth; the former 25 were 2.5× the
    // per-frame blur cost for no visible gain — a pure win on a fill-bound mobile GPU.
    this.key.shadow.blurSamples = 10;
    this.fill = new DirectionalLight(lighting.fill.color, lighting.fill.intensity);
    this.fill.position.set(...lighting.fill.position);
    this.positionKey();
    this.scene.add(this.hemi, this.key, this.fill);
    // Also light the marker layer, so pins are lit the same in the overlay pass.
    for (const light of [this.hemi, this.key, this.fill]) light.layers.enable(MARKER_LAYER);

    // Build the planet (north pole +Y), its markers, and the trailing clouds from the state
    // above. The same helpers let setOptions rebuild just the affected mesh in place later.
    this.rebuildPlanet();
    // Compose the starting orientation now, before the clouds are built, so the fresh cloud
    // field copies the real initial orientation (Eurasia-facing) instead of identity — else it
    // would visibly slerp to catch up on the first frames.
    this.applyOrientation();
    this.rebuildMarkers();
    this.rebuildClouds();

    // Drag spins the planet itself (the camera stays put); the markers ride along with the
    // surface and the clouds trail after it. The wheel dollies the camera to zoom.
    this.minDistance = opts.radius * 2.4;
    this.maxDistance = opts.radius * 4.5;
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    // Start the idle clock now, so the first auto-rotation begins after the delay.
    this.lastInteractionEnd = performance.now();

    this.resize();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.watchDevicePixelRatio();

    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  /** Canvas element rendered into the host container. */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Stop the render loop, remove the canvas, and dispose GPU resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.dprMediaQuery?.removeEventListener('change', this.onDevicePixelRatioChange);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.remove();
    for (const marker of this.markers) marker.dispose();
    if (this.clouds) this.disposeMesh(this.clouds);
    this.disposeMesh(this.planet);
    this.bgTexture?.dispose();
    this.renderer.dispose();
  }

  /**
   * Update the widget in place from a partial set of options, without recreating it — so
   * the camera zoom, spin and tilt are preserved. Scene, lighting and material tweaks
   * apply live; changes that touch geometry (radius, land/water colour, bevel, colour
   * jitter), the marker set, or the cloud field rebuild only the mesh they affect.
   * Anything omitted is left unchanged.
   */
  setOptions(next: PlanetWidgetOptions): void {
    if (this.destroyed) return;
    let planetDirty = false;
    let markersDirty = false;
    let cloudsDirty = false;

    let backgroundDirty = false;
    if (next.background !== undefined) { this.background.set(next.background); backgroundDirty = true; }
    if (next.starfield !== undefined) {
      this.starfield = next.starfield === true ? {} : next.starfield || false;
      backgroundDirty = true;
    }
    if (backgroundDirty) this.applyBackground();
    if (next.rotationSpeed !== undefined) this.rotationSpeed = next.rotationSpeed;
    if (next.autoRotate !== undefined) { this.autoRotate = next.autoRotate; this.dirty = true; }

    if (next.radius !== undefined && next.radius !== this.radius) {
      this.radius = next.radius;
      this.camera.far = this.radius * 10;
      this.camera.updateProjectionMatrix();
      this.positionKey(); // the shadow camera is fit to the globe, so it tracks the radius
      this.minDistance = this.radius * 2.4;
      this.maxDistance = this.radius * 4.5;
      // Keep the current zoom within the new bounds.
      const dist = this.camera.position.length();
      this.camera.position.setLength(Math.min(this.maxDistance, Math.max(this.minDistance, dist)));
      planetDirty = true; // geometry scales with radius; markers/clouds sit on the surface
      markersDirty = true;
      cloudsDirty = true;
    }
    if (next.waterColor !== undefined && next.waterColor !== this.waterColor) {
      this.waterColor = next.waterColor;
      planetDirty = true;
    }
    if (next.landColor !== undefined && next.landColor !== this.landColor) {
      this.landColor = next.landColor;
      planetDirty = true;
    }
    if (next.material) {
      const m = next.material;
      // roughness / metalness are live material props; bevel and colour jitter are baked
      // into the geometry / instance colours, so they need a rebuild.
      if (m.roughness !== undefined) this.material.roughness = m.roughness;
      if (m.metalness !== undefined) this.material.metalness = m.metalness;
      if (m.bevel !== undefined && m.bevel !== this.material.bevel) {
        this.material.bevel = m.bevel;
        planetDirty = true;
      }
      if (m.colorJitter !== undefined && m.colorJitter !== this.material.colorJitter) {
        this.material.colorJitter = m.colorJitter;
        planetDirty = true;
      }
      this.applyLiveMaterial();
    }
    if (next.terrain) {
      // All three reshape the cube grid, so any change means a geometry rebuild.
      const t = next.terrain;
      if (t.voxel !== undefined && t.voxel !== this.terrain.voxel) { this.terrain.voxel = t.voxel; planetDirty = true; }
      if (t.relief !== undefined && t.relief !== this.terrain.relief) { this.terrain.relief = t.relief; planetDirty = true; }
      if (t.ringStep !== undefined && t.ringStep !== this.terrain.ringStep) { this.terrain.ringStep = t.ringStep; planetDirty = true; }
      if (t.poleCap !== undefined && t.poleCap !== this.terrain.poleCap) { this.terrain.poleCap = t.poleCap; planetDirty = true; }
    }
    if (next.lighting) {
      const l = next.lighting;
      if (l.exposure !== undefined) this.lighting.exposure = l.exposure;
      if (l.hemisphere) {
        const h = l.hemisphere;
        if (h.skyColor !== undefined) this.lighting.hemisphere.skyColor = h.skyColor;
        if (h.groundColor !== undefined) this.lighting.hemisphere.groundColor = h.groundColor;
        if (h.intensity !== undefined) this.lighting.hemisphere.intensity = h.intensity;
      }
      if (l.key) {
        if (l.key.color !== undefined) this.lighting.key.color = l.key.color;
        if (l.key.intensity !== undefined) this.lighting.key.intensity = l.key.intensity;
        if (l.key.position !== undefined) this.lighting.key.position = l.key.position;
      }
      if (l.fill) {
        if (l.fill.color !== undefined) this.lighting.fill.color = l.fill.color;
        if (l.fill.intensity !== undefined) this.lighting.fill.intensity = l.fill.intensity;
        if (l.fill.position !== undefined) this.lighting.fill.position = l.fill.position;
      }
      this.applyLighting();
    }
    // Compare by reference: passing the same array (as the demo does each tick) is a no-op.
    if (next.markers !== undefined && next.markers !== this.markerConfigs) {
      this.markerConfigs = next.markers;
      markersDirty = true;
    }
    if (next.markerVoxelSize !== undefined && next.markerVoxelSize !== this.markerVoxelSize) {
      this.markerVoxelSize = next.markerVoxelSize;
      markersDirty = true;
    }
    if (next.clouds !== undefined) {
      if (next.clouds === false) {
        if (this.cloudsEnabled) { this.cloudsEnabled = false; cloudsDirty = true; }
      } else {
        if (!this.cloudsEnabled) { this.cloudsEnabled = true; cloudsDirty = true; }
        if (typeof next.clouds === 'object') {
          const g = next.clouds;
          if (g.lag !== undefined) this.cloudLag = g.lag; // live tick tunable, no rebuild
          // Rebuild the field only when a generation field actually changes.
          if (g.count !== undefined && g.count !== this.cloudGen.count) { this.cloudGen.count = g.count; cloudsDirty = true; }
          if (g.seed !== undefined && g.seed !== this.cloudGen.seed) { this.cloudGen.seed = g.seed; cloudsDirty = true; }
          if (g.size !== undefined && g.size !== this.cloudGen.size) { this.cloudGen.size = g.size; cloudsDirty = true; }
          if (g.voxel !== undefined && g.voxel !== this.cloudGen.voxel) { this.cloudGen.voxel = g.voxel; cloudsDirty = true; }
          if (g.clearance !== undefined && g.clearance !== this.cloudGen.clearance) { this.cloudGen.clearance = g.clearance; cloudsDirty = true; }
        }
      }
    }

    // A planet rebuild orphans the pins parented to it, so rebuild them too.
    if (planetDirty) this.rebuildPlanet();
    if (planetDirty || markersDirty) this.rebuildMarkers();
    if (cloudsDirty) this.rebuildClouds();
  }

  // Set scene.background to either the solid colour or a generated star-field texture (over
  // that colour). Regenerated whenever the background colour or star-field config changes.
  private applyBackground(): void {
    this.bgTexture?.dispose();
    this.bgTexture = undefined;
    if (this.starfield) {
      this.bgTexture = buildStarfield(`#${this.background.getHexString()}`, this.starfield);
      this.scene.background = this.bgTexture;
    } else {
      this.scene.background = this.background;
    }
    this.dirty = true;
  }

  private disposeMesh(mesh: InstancedMesh): void {
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
    mesh.dispose();
  }

  // Rebuild the planet mesh in place from the current state, preserving camera and spin
  // (its orientation is re-applied from spin/tilt next tick). Call rebuildMarkers after,
  // since the pins are parented to the planet and don't survive the swap.
  private rebuildPlanet(): void {
    if (this.planet) {
      this.scene.remove(this.planet);
      this.disposeMesh(this.planet);
    }
    this.planet = buildPlanet({
      radius: this.radius,
      waterColor: this.waterColor,
      landColor: this.landColor,
      ...this.material,
      ...this.terrain,
    });
    // Cubes shade each other and take the land relief's shadow onto the water.
    this.planet.castShadow = true;
    this.planet.receiveShadow = true;
    this.scene.add(this.planet);
    this.dirty = true;
  }

  // Re-create the markers from markerConfigs and parent them to the current planet.
  private rebuildMarkers(): void {
    for (const marker of this.markers) {
      marker.object.removeFromParent();
      marker.dispose();
    }
    const defaultMarkerSize = this.radius * 0.18;
    this.markers = this.markerConfigs.map((cfg) => {
      const marker = new Marker({ color: cfg.color, size: cfg.size ?? defaultMarkerSize, voxel: this.markerVoxelSize });
      marker.object.layers.set(MARKER_LAYER); // drawn in the overlay pass, on top of the clouds
      this.planet.add(marker.object);
      marker.placeAt(cfg.lat, cfg.lon, this.radius);
      return marker;
    });
    this.dirty = true;
  }

  // Rebuild the cloud field from cloudGen (or remove it when disabled). The new mesh
  // inherits the old clouds' (or the planet's) orientation so the swap doesn't snap.
  private rebuildClouds(): void {
    const prevQuat = this.clouds?.quaternion.clone();
    if (this.clouds) {
      this.scene.remove(this.clouds);
      this.disposeMesh(this.clouds);
      this.clouds = undefined;
    }
    if (this.cloudsEnabled) {
      this.clouds = buildClouds(this.radius, this.cloudGen);
      // Clouds drop a shadow onto the globe (they trail the spin, so the shadow drifts with
      // them); they don't receive, staying bright white.
      this.clouds.castShadow = true;
      this.clouds.quaternion.copy(prevQuat ?? this.planet.quaternion);
      this.scene.add(this.clouds);
      this.cloudsSettling = true; // ease the fresh field onto the planet's current orientation
    }
    this.dirty = true;
  }

  private applyLighting(): void {
    this.renderer.toneMappingExposure = this.lighting.exposure;
    this.hemi.color.set(this.lighting.hemisphere.skyColor);
    this.hemi.groundColor.set(this.lighting.hemisphere.groundColor);
    this.hemi.intensity = this.lighting.hemisphere.intensity;
    this.key.color.set(this.lighting.key.color);
    this.key.intensity = this.lighting.key.intensity;
    this.positionKey();
    this.fill.color.set(this.lighting.fill.color);
    this.fill.intensity = this.lighting.fill.intensity;
    this.fill.position.set(...this.lighting.fill.position);
    this.dirty = true;
  }

  // Place the key light from its configured position, treated as a *direction*: for a
  // directional light only the direction to the target (origin) matters for shading, so we
  // push the light out to `radius · 2.4` along that direction — far enough that its shadow
  // camera (which sits at the light) sees the whole globe. Then fit that orthographic shadow
  // camera snugly around the globe so the shadow map's resolution is spent on the planet.
  private positionKey(): void {
    const [px, py, pz] = this.lighting.key.position;
    const dir = new Vector3(px, py, pz);
    if (dir.lengthSq() === 0) dir.set(0, 1, 0); // degenerate config → straight overhead
    dir.normalize().multiplyScalar(this.radius * 2.4);
    this.key.position.copy(dir);
    const cam = this.key.shadow.camera;
    const ext = this.radius * 1.15; // half-extent of the globe plus a little margin
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = this.radius * 0.6;
    cam.far = this.radius * 4;
    cam.updateProjectionMatrix();
  }

  private applyLiveMaterial(): void {
    const mat = this.planet.material as MeshStandardMaterial;
    mat.roughness = this.material.roughness;
    mat.metalness = this.material.metalness;
    this.dirty = true;
  }

  private resize = (): void => {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    // Re-apply the ratio first: it may have changed since construction (moved to a
    // different-DPI monitor, browser zoom), and setSize derives the drawing buffer from it.
    this.applyPixelRatio();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  };

  /** Set the drawing-buffer ratio to the live devicePixelRatio, capped (see pixelRatioCap). */
  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
  }

  /**
   * Re-render at the new devicePixelRatio when it changes, then re-arm — a `resolution`
   * media query matches only one exact ratio, so it must be recreated after each hit.
   * Covers browser zoom / monitor moves that a container-only ResizeObserver can miss.
   */
  private watchDevicePixelRatio(): void {
    if (typeof matchMedia !== 'function') return;
    this.dprMediaQuery?.removeEventListener('change', this.onDevicePixelRatioChange);
    this.dprMediaQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprMediaQuery.addEventListener('change', this.onDevicePixelRatioChange);
  }

  private onDevicePixelRatioChange = (): void => {
    this.resize(); // re-applies the pixel ratio and drawing-buffer size
    this.watchDevicePixelRatio(); // re-arm for the ratio we just moved to
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activePointer !== null) return; // one pointer drives the spin; ignore others
    this.activePointer = e.pointerId;
    this.dragging = true;
    this.interacting = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.lastPointerTime = performance.now();
    this.spinVel = 0;
    this.dirty = true;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    const now = performance.now();
    const dt = Math.max(8, now - this.lastPointerTime) / 1000; // clamp to avoid velocity spikes
    const dYaw = (e.clientX - this.lastPointerX) * DRAG_SENSITIVITY; // horizontal → yaw
    const dPitch = (e.clientY - this.lastPointerY) * DRAG_SENSITIVITY; // vertical → tilt about OX
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.lastPointerTime = now;
    this.spin += dYaw;
    this.tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, this.tilt + dPitch));
    this.spinVel = dYaw / dt; // carried into inertia on release
    this.dirty = true;
    this.cloudsSettling = true; // orientation moved → clouds must chase it again
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.dragging = false;
    this.interacting = false;
    this.lastInteractionEnd = performance.now();
    const el = this.renderer.domElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Dolly the camera along its view axis to zoom (the planet and its clouds stay put).
    const dist = this.camera.position.length() * Math.exp(e.deltaY * 0.001);
    this.camera.position.setLength(Math.min(this.maxDistance, Math.max(this.minDistance, dist)));
    this.lastInteractionEnd = performance.now();
    this.dirty = true;
  };

  // Compose the planet's orientation from the current spin (yaw about the pole) and tilt
  // (pitch about OX) — no roll about Z. Shared by the constructor (so a freshly built cloud
  // field can copy the true starting orientation) and the per-frame tick.
  private applyOrientation(): void {
    _qSpin.setFromAxisAngle(POLE, this.spin);
    _qTilt.setFromAxisAngle(PITCH_AXIS, this.tilt);
    this.planet.quaternion.copy(_qTilt).multiply(_qSpin);
  }

  private tick = (now: number): void => {
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (!this.dragging && this.spinVel !== 0) {
      // Yaw inertia glide after a drag, decaying toward rest.
      this.spin += this.spinVel * delta;
      this.spinVel *= Math.exp(-SPIN_DAMPING * delta);
      if (Math.abs(this.spinVel) < 1e-3) this.spinVel = 0;
      this.dirty = true;
      this.cloudsSettling = true;
    }

    // Auto-rotate (yaw about the pole) once idle past the resume delay and inertia settled.
    const idle =
      !this.interacting && this.spinVel === 0 && now - this.lastInteractionEnd >= IDLE_RESUME_MS;
    if (this.autoRotate && idle) {
      this.spin += this.rotationSpeed * delta;
      this.dirty = true;
      this.cloudsSettling = true;
    }

    // Compose orientation: yaw about the pole, then tilt about OX — no roll about Z.
    this.applyOrientation();

    // Clouds trail the spin on a rubber band: ease their orientation toward the planet's.
    // The frame-rate-independent step 1 − e^(−Δt/τ) leaves a lag while the globe turns and
    // eases the clouds into alignment once it stops. Once they've all but caught up, snap
    // them exactly onto the planet and stop the follow, so a settled scene stops re-rendering
    // instead of chasing an ever-shrinking residual forever.
    if (this.clouds && this.cloudsSettling) {
      this.clouds.quaternion.slerp(this.planet.quaternion, 1 - Math.exp(-delta / this.cloudLag));
      if (this.clouds.quaternion.angleTo(this.planet.quaternion) < CLOUD_SETTLE_EPS) {
        this.clouds.quaternion.copy(this.planet.quaternion);
        this.cloudsSettling = false;
      } else {
        this.dirty = true;
      }
    }

    // On-demand rendering: only redraw — and rebuild the shadow map (see render) — when
    // something actually changed this frame. A static, settled scene skips the draw entirely,
    // keeping the GPU idle so the phone stays cool and doesn't thermally throttle. The last
    // moving frame already leaves the final state on screen, so nothing is dropped.
    if (this.dirty) {
      // Fade/hide each marker as the spin carries it behind the globe.
      for (const marker of this.markers) marker.update(this.camera.position, this.planet);
      this.render();
      this.dirty = false;
    }
    this.frameId = requestAnimationFrame(this.tick);
  };

  // Two passes: the globe and clouds on layer 0, then the markers on MARKER_LAYER over a
  // cleared depth buffer. The marker pass keeps depth testing (each pin self-occludes its
  // own thickness) but, with depth cleared, neither the globe nor a cloud can occlude a
  // pin — so markers never sink into the clouds, while their horizon fade still hides the
  // ones that have turned to the far side.
  private render(): void {
    // Refresh the shadow map once, for this first (globe + clouds) pass only; the marker
    // overlay re-renders the scene but its pins don't cast shadows, so skip a second update.
    this.renderer.shadowMap.needsUpdate = true;
    this.camera.layers.set(0);
    this.renderer.render(this.scene, this.camera); // globe + clouds (clears colour + depth)

    if (this.markers.length > 0) {
      // Keep the rendered frame: clear only depth, and null the background for this pass
      // (a Color background force-clears the colour buffer even with autoClear off).
      const background = this.scene.background;
      this.scene.background = null;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.camera.layers.set(MARKER_LAYER);
      this.renderer.render(this.scene, this.camera); // markers, over globe + clouds
      this.renderer.autoClear = true;
      this.scene.background = background;
    }
    this.camera.layers.enableAll();
  }
}
