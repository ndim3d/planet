import {
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildPlanet } from './planet';
import { buildClouds, type BuildCloudsOptions } from './cloud';
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
  /** Main key light, straight up the +Y axis. Defaults to white, `0.6`, at `[0, 10, 0]`. */
  key?: DirectionalLightOptions;
  /** Opposite fill light, straight down the −Y axis. Defaults to `#e6eeff`, `0.3`, at `[0, -10, 0]`. */
  fill?: DirectionalLightOptions;
}

/** Surface material / cube appearance tunables. All fields optional. */
export interface PlanetMaterialOptions {
  /** Roughness, 0 (glossy) … 1 (matte). Defaults to `0.4`. */
  roughness?: number;
  /** Metalness, 0 … 1. Defaults to `0`. */
  metalness?: number;
  /** Environment-map reflection strength. Defaults to `0.9`. */
  envMapIntensity?: number;
  /** Cube edge chamfer, as a fraction of one cube. Defaults to `0.12`. */
  bevel?: number;
  /** Per-cube brightness jitter (± fraction) so fields aren't dead-flat. Defaults to `0.07`. */
  colorJitter?: number;
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
  /** Lighting and tone mapping. Omitted fields keep their defaults. */
  lighting?: PlanetLightingOptions;
  /**
   * Pin markers to place on the surface. Each rides the planet's spin and hides when
   * it turns to the far side. A marker's `size` defaults to `radius * 0.18`.
   */
  markers?: MarkerConfig[];
  /**
   * Background voxel clouds that trail the planet's spin. Pass `false` to hide them,
   * `true` (default) for the default field, or a {@link PlanetCloudOptions} object to
   * control count, seed, size, surface clearance and follow lag.
   */
  clouds?: boolean | PlanetCloudOptions;
}

const DEFAULTS: Required<Omit<PlanetWidgetOptions, 'material' | 'lighting' | 'markers'>> = {
  background: '#0b0f1a',
  waterColor: '#2796e0',
  landColor: '#47b54b',
  radius: 20,
  rotationSpeed: 0.1,
  autoRotate: true,
  clouds: true,
};

// Glossy-plastic toy look (see reference): a low roughness gives the soft specular
// sheen of moulded plastic rather than matte clay; a strong envMapIntensity lets the
// procedural room reflect across the cube tops and bevels for the studio highlight;
// metalness stays 0 because plastic is a dielectric. The bevel is a touch rounder so
// the edges catch a bright rim, which is what reads as "plastic" more than anything.
const MATERIAL_DEFAULTS: Required<PlanetMaterialOptions> = {
  roughness: 0.4,
  metalness: 0,
  envMapIntensity: 0.9,
  bevel: 0.12,
  colorJitter: 0.07,
};

// The planet spins around Y, so only lighting that is symmetric about the Y axis keeps
// a fixed point's brightness constant through the spin (hemisphere depends only on
// normal.y; a directional light on the Y axis likewise). Any *off-axis* directional
// light depends on normal.x/z, which a Y-rotation changes — that paints a fixed bright
// patch at one longitude that the continents scroll through, brightening and dimming.
// So: hemisphere as the main soft top→bottom form, and the key/fill placed straight
// up / straight down. The continents then keep an even brightness as they rotate past.
const LIGHTING_DEFAULTS = {
  exposure: 1.0,
  // Studio-soft, evenly-bright look (see reference): the whole sphere stays vivid with
  // only a gentle top→bottom falloff. The ground tone is lifted well off the old dark
  // blue-grey so down-facing faces and the lower hemisphere keep their saturation
  // instead of greying out, and the up-axis fill is raised to brighten the bottom to
  // match — the silhouette and south pole read just slightly dimmer than the top, not
  // shadowed.
  hemisphere: { skyColor: '#cfe0ff', groundColor: '#9099ad', intensity: 1.0 },
  key: { color: '#ffffff', intensity: 0.6, position: [0, 10, 0] as [number, number, number] },
  fill: { color: '#e6eeff', intensity: 0.3, position: [0, -10, 0] as [number, number, number] },
};

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
const MAX_TILT = 1.4; // clamp pitch (~80°) so the globe can't flip past a pole
// Clouds trail the planet on a rubber band: rather than turning rigidly with it, they ease
// toward its orientation each frame (first-order smoothing). The follow lag (time constant
// in seconds) is per-instance (see `clouds.lag`); this is the fallback when unset — larger
// lags the clouds further behind and settles them slower, 0 makes them turn rigidly.
const DEFAULT_CLOUD_LAG = 0.05;
const _qSpin = new Quaternion();
const _qTilt = new Quaternion();

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
  private minDistance: number;
  private maxDistance: number;

  // Lights, kept so setOptions can retune them live (see applyLighting).
  private readonly hemi: HemisphereLight;
  private readonly key: DirectionalLight;
  private readonly fill: DirectionalLight;
  // Scene background colour, mutated in place by setOptions.
  private readonly background: Color;

  // Normalised, live-editable copy of the resolved options; setOptions edits these in
  // place and rebuilds only the mesh (planet / markers / clouds) each change touches.
  private radius: number;
  private waterColor: string;
  private landColor: string;
  private material: Required<PlanetMaterialOptions>;
  private lighting: typeof LIGHTING_DEFAULTS;
  private markerConfigs: MarkerConfig[];
  private cloudsEnabled: boolean;
  private cloudGen: BuildCloudsOptions;
  private cloudLag: number; // rubber-band follow lag for the clouds, in seconds
  private rotationSpeed: number;
  private autoRotate: boolean;
  private frameId = 0;
  private lastTime = 0;
  private destroyed = false;
  // Auto-rotation pauses while the user interacts and for IDLE_RESUME_MS after.
  private interacting = false;
  private lastInteractionEnd = 0;
  // Drag-to-spin state: two accumulated angles (no roll) + yaw inertia after release.
  private dragging = false;
  private activePointer: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastPointerTime = 0;
  private spin = 0; // yaw about the pole (longitude), also driven by auto-rotation
  private tilt = 0; // pitch about OX (clamped to ±MAX_TILT)
  private spinVel = 0; // yaw inertia (rad/s) after release

  constructor(container: HTMLElement, options: PlanetWidgetOptions = {}) {
    const opts = { ...DEFAULTS, ...options };
    const material = { ...MATERIAL_DEFAULTS, ...options.material };
    // Per-group shallow merge so a caller can override e.g. just `key.intensity`.
    const lighting = {
      exposure: options.lighting?.exposure ?? LIGHTING_DEFAULTS.exposure,
      hemisphere: { ...LIGHTING_DEFAULTS.hemisphere, ...options.lighting?.hemisphere },
      key: { ...LIGHTING_DEFAULTS.key, ...options.lighting?.key },
      fill: { ...LIGHTING_DEFAULTS.fill, ...options.lighting?.fill },
    };
    this.container = container;

    // Normalised, live-editable option state (setOptions edits these in place).
    this.radius = opts.radius;
    this.waterColor = opts.waterColor;
    this.landColor = opts.landColor;
    this.material = material;
    this.lighting = lighting;
    this.markerConfigs = options.markers ?? [];
    this.rotationSpeed = opts.rotationSpeed;
    this.autoRotate = opts.autoRotate;
    this.cloudsEnabled = opts.clouds !== false;
    // A `clouds` object overrides the field's count/seed/size/clearance (rebuilds the
    // mesh) and its `lag` (a live tick tunable); `true`/`false` just toggle the default field.
    const cloudObj = typeof opts.clouds === 'object' ? opts.clouds : {};
    const { lag: cloudLag, ...cloudGen } = cloudObj;
    this.cloudGen = cloudGen;
    this.cloudLag = cloudLag ?? DEFAULT_CLOUD_LAG;

    this.scene = new Scene();
    this.background = new Color(opts.background);
    this.scene.background = this.background;

    this.camera = new PerspectiveCamera(FOV, 1, 0.1, opts.radius * 10);
    // Pull back far enough to fit the planet's radius in view, with margin.
    const fitRadius = opts.radius + 2;
    this.camera.position.set(0, 0, fitRadius / Math.sin((FOV / 2) * (Math.PI / 180)) * 1.05);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Khronos PBR-Neutral tone mapping: rolls off blown highlights without the strong
    // desaturation/whitening that ACES gives, so the greens and blues stay vivid
    // instead of washing out toward the lit pole. Exposure kept just under 1 so the
    // top-lit cubes don't clip.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = lighting.exposure;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Soft image-based lighting: a procedural room gives the matte cubes a gentle,
    // direction-dependent gradient (subtle reflections + occlusion-like falloff) that
    // direct lights alone can't, so the surface reads as shaded clay instead of flat
    // fill. Baked once into a PMREM cubemap; the room scene/generator are discarded.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Hemisphere light gives a rotation-independent top→bottom gradient, so a cube's
    // up/side/down faces always read differently no matter the spin angle. Key + fill from
    // opposite (Y-axis) poles add contrast without pinning a bright patch to one longitude.
    // All three are kept as fields so setOptions can retune them live (see applyLighting).
    this.hemi = new HemisphereLight(
      lighting.hemisphere.skyColor,
      lighting.hemisphere.groundColor,
      lighting.hemisphere.intensity,
    );
    this.key = new DirectionalLight(lighting.key.color, lighting.key.intensity);
    this.key.position.set(...lighting.key.position);
    this.fill = new DirectionalLight(lighting.fill.color, lighting.fill.intensity);
    this.fill.position.set(...lighting.fill.position);
    this.scene.add(this.hemi, this.key, this.fill);
    // Also light the marker layer, so pins are lit the same in the overlay pass.
    for (const light of [this.hemi, this.key, this.fill]) light.layers.enable(MARKER_LAYER);

    // Build the planet (north pole +Y), its markers, and the trailing clouds from the state
    // above. The same helpers let setOptions rebuild just the affected mesh in place later.
    this.rebuildPlanet();
    this.rebuildMarkers();
    this.rebuildClouds();

    // Drag spins the planet itself (the camera stays put); the markers ride along with the
    // surface and the clouds trail after it. The wheel dollies the camera to zoom.
    this.minDistance = opts.radius * 1.4;
    this.maxDistance = opts.radius * 6;
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
    this.scene.environment?.dispose();
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

    if (next.background !== undefined) this.background.set(next.background);
    if (next.rotationSpeed !== undefined) this.rotationSpeed = next.rotationSpeed;
    if (next.autoRotate !== undefined) this.autoRotate = next.autoRotate;

    if (next.radius !== undefined && next.radius !== this.radius) {
      this.radius = next.radius;
      this.camera.far = this.radius * 10;
      this.camera.updateProjectionMatrix();
      this.minDistance = this.radius * 1.4;
      this.maxDistance = this.radius * 6;
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
      // roughness / metalness / env reflect are live material props; bevel and colour
      // jitter are baked into the geometry / instance colours, so they need a rebuild.
      if (m.roughness !== undefined) this.material.roughness = m.roughness;
      if (m.metalness !== undefined) this.material.metalness = m.metalness;
      if (m.envMapIntensity !== undefined) this.material.envMapIntensity = m.envMapIntensity;
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
          if (g.clearance !== undefined && g.clearance !== this.cloudGen.clearance) { this.cloudGen.clearance = g.clearance; cloudsDirty = true; }
        }
      }
    }

    // A planet rebuild orphans the pins parented to it, so rebuild them too.
    if (planetDirty) this.rebuildPlanet();
    if (planetDirty || markersDirty) this.rebuildMarkers();
    if (cloudsDirty) this.rebuildClouds();
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
    });
    this.scene.add(this.planet);
  }

  // Re-create the markers from markerConfigs and parent them to the current planet.
  private rebuildMarkers(): void {
    for (const marker of this.markers) {
      marker.object.removeFromParent();
      marker.dispose();
    }
    const defaultMarkerSize = this.radius * 0.18;
    this.markers = this.markerConfigs.map((cfg) => {
      const marker = new Marker({ color: cfg.color, size: cfg.size ?? defaultMarkerSize });
      marker.object.layers.set(MARKER_LAYER); // drawn in the overlay pass, on top of the clouds
      this.planet.add(marker.object);
      marker.placeAt(cfg.lat, cfg.lon, this.radius);
      return marker;
    });
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
      this.clouds.quaternion.copy(prevQuat ?? this.planet.quaternion);
      this.scene.add(this.clouds);
    }
  }

  private applyLighting(): void {
    this.renderer.toneMappingExposure = this.lighting.exposure;
    this.hemi.color.set(this.lighting.hemisphere.skyColor);
    this.hemi.groundColor.set(this.lighting.hemisphere.groundColor);
    this.hemi.intensity = this.lighting.hemisphere.intensity;
    this.key.color.set(this.lighting.key.color);
    this.key.intensity = this.lighting.key.intensity;
    this.key.position.set(...this.lighting.key.position);
    this.fill.color.set(this.lighting.fill.color);
    this.fill.intensity = this.lighting.fill.intensity;
    this.fill.position.set(...this.lighting.fill.position);
  }

  private applyLiveMaterial(): void {
    const mat = this.planet.material as MeshStandardMaterial;
    mat.roughness = this.material.roughness;
    mat.metalness = this.material.metalness;
    mat.envMapIntensity = this.material.envMapIntensity;
  }

  private resize = (): void => {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
  };

  private tick = (now: number): void => {
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (!this.dragging && this.spinVel !== 0) {
      // Yaw inertia glide after a drag, decaying toward rest.
      this.spin += this.spinVel * delta;
      this.spinVel *= Math.exp(-SPIN_DAMPING * delta);
      if (Math.abs(this.spinVel) < 1e-3) this.spinVel = 0;
    }

    // Auto-rotate (yaw about the pole) once idle past the resume delay and inertia settled.
    const idle =
      !this.interacting && this.spinVel === 0 && now - this.lastInteractionEnd >= IDLE_RESUME_MS;
    if (this.autoRotate && idle) this.spin += this.rotationSpeed * delta;

    // Compose orientation: yaw about the pole, then tilt about OX — no roll about Z.
    _qSpin.setFromAxisAngle(POLE, this.spin);
    _qTilt.setFromAxisAngle(PITCH_AXIS, this.tilt);
    this.planet.quaternion.copy(_qTilt).multiply(_qSpin);

    // Clouds trail the spin on a rubber band: ease their orientation toward the planet's.
    // The frame-rate-independent step 1 − e^(−Δt/τ) leaves a lag while the globe turns and
    // eases the clouds into alignment once it stops.
    if (this.clouds) {
      this.clouds.quaternion.slerp(this.planet.quaternion, 1 - Math.exp(-delta / this.cloudLag));
    }

    // Fade/hide each marker as the spin carries it behind the globe.
    for (const marker of this.markers) marker.update(this.camera.position, this.planet);
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };

  // Two passes: the globe and clouds on layer 0, then the markers on MARKER_LAYER over a
  // cleared depth buffer. The marker pass keeps depth testing (each pin self-occludes its
  // own thickness) but, with depth cleared, neither the globe nor a cloud can occlude a
  // pin — so markers never sink into the clouds, while their horizon fade still hides the
  // ones that have turned to the far side.
  private render(): void {
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
