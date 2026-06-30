import {
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildPlanet } from './planet';

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
  /** Surface material / cube appearance. Omitted fields keep their defaults. */
  material?: PlanetMaterialOptions;
  /** Lighting and tone mapping. Omitted fields keep their defaults. */
  lighting?: PlanetLightingOptions;
}

const DEFAULTS: Required<Omit<PlanetWidgetOptions, 'material' | 'lighting'>> = {
  background: '#0b0f1a',
  waterColor: '#2796e0',
  landColor: '#47b54b',
  radius: 20,
  rotationSpeed: 0.1,
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

/**
 * A voxel Earth-like planet rendered with Three.js, mounted into an HTML element.
 *
 * The widget mounts itself on construction: it appends a canvas to `container`,
 * sizes to it, tracks resizes via a `ResizeObserver`, and starts a render loop.
 * Drag to orbit the planet (OrbitControls); after {@link IDLE_RESUME_MS} of no
 * interaction it resumes a slow auto-rotation. Call {@link PlanetWidget.destroy}
 * to tear it down and free GPU resources.
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
  private readonly planet: InstancedMesh;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;

  private rotationSpeed: number;
  private frameId = 0;
  private lastTime = 0;
  private destroyed = false;
  // Auto-rotation pauses while the user interacts and for IDLE_RESUME_MS after.
  private interacting = false;
  private lastInteractionEnd = 0;

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
    this.rotationSpeed = opts.rotationSpeed;

    this.scene = new Scene();
    this.scene.background = new Color(opts.background);

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

    this.planet = buildPlanet({
      radius: opts.radius,
      waterColor: opts.waterColor,
      landColor: opts.landColor,
      ...material,
    });
    // North pole is +Y; spinning around Y keeps north up (no axial tilt).
    this.scene.add(this.planet);

    // Hemisphere light gives a rotation-independent top→bottom gradient, so a
    // cube's up/side/down faces always read differently no matter the spin angle.
    // The ground tone is kept fairly light (not near-black) so down-facing faces and
    // the shaded side of coastal cliffs lift out of black instead of reading as gaps.
    const hemi = new HemisphereLight(
      lighting.hemisphere.skyColor,
      lighting.hemisphere.groundColor,
      lighting.hemisphere.intensity,
    );
    // Key + fill from opposite sides add left/right/front contrast, so there is no
    // angle where the lit hemisphere faces the camera and looks flat. The fill is
    // strong enough to keep the dark side soft and toy-like rather than harsh.
    const key = new DirectionalLight(lighting.key.color, lighting.key.intensity);
    key.position.set(...lighting.key.position);
    const fill = new DirectionalLight(lighting.fill.color, lighting.fill.intensity);
    fill.position.set(...lighting.fill.position);
    this.scene.add(hemi, key, fill);

    // Drag to orbit; wheel to zoom. Pan is off so the planet stays centered.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = opts.radius * 1.4;
    this.controls.maxDistance = opts.radius * 6;
    this.controls.addEventListener('start', this.onInteractStart);
    this.controls.addEventListener('end', this.onInteractEnd);
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
    this.controls.removeEventListener('start', this.onInteractStart);
    this.controls.removeEventListener('end', this.onInteractEnd);
    this.controls.dispose();
    this.renderer.domElement.remove();
    this.planet.geometry.dispose();
    (this.planet.material as { dispose(): void }).dispose();
    this.planet.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }

  private resize = (): void => {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private onInteractStart = (): void => {
    this.interacting = true;
  };

  private onInteractEnd = (): void => {
    this.interacting = false;
    this.lastInteractionEnd = performance.now();
  };

  private tick = (now: number): void => {
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Auto-rotate only once the user has been idle past the resume delay.
    const idle = !this.interacting && now - this.lastInteractionEnd >= IDLE_RESUME_MS;
    if (idle) this.planet.rotation.y += this.rotationSpeed * delta;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.tick);
  };
}
