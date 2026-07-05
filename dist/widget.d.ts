import { BuildCloudsOptions } from './cloud';
import { StarfieldOptions } from './starfield';
import { MarkerConfig } from './marker';
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
export declare const DEFAULTS: {
    background: string;
    starfield: true;
    waterColor: string;
    landColor: string;
    radius: number;
    rotationSpeed: number;
    autoRotate: false;
    clouds: {
        lag: number;
        count: number;
        seed: number;
        size: number;
        voxel: number;
        clearance: number;
    };
    material: {
        roughness: number;
        metalness: number;
        bevel: number;
        colorJitter: number;
    };
    terrain: {
        voxel: number;
        relief: number;
        ringStep: number;
        poleCap: number;
    };
    lighting: {
        exposure: number;
        hemisphere: {
            skyColor: string;
            groundColor: string;
            intensity: number;
        };
        key: {
            color: string;
            intensity: number;
            position: [number, number, number];
        };
        fill: {
            color: string;
            intensity: number;
            position: [number, number, number];
        };
    };
    markerVoxelSize: number;
};
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
export declare class PlanetWidget {
    private readonly container;
    private readonly scene;
    private readonly camera;
    private readonly renderer;
    private planet;
    private markers;
    private clouds?;
    private readonly resizeObserver;
    private minDistance;
    private maxDistance;
    private readonly hemi;
    private readonly key;
    private readonly fill;
    private readonly background;
    private starfield;
    private bgTexture?;
    private radius;
    private waterColor;
    private landColor;
    private material;
    private terrain;
    private lighting;
    private markerConfigs;
    private markerVoxelSize?;
    private cloudsEnabled;
    private cloudGen;
    private cloudLag;
    private rotationSpeed;
    private autoRotate;
    private frameId;
    private lastTime;
    private destroyed;
    private dirty;
    private cloudsSettling;
    private interacting;
    private lastInteractionEnd;
    private dragging;
    private activePointer;
    private lastPointerX;
    private lastPointerY;
    private lastPointerTime;
    private spin;
    private tilt;
    private spinVel;
    constructor(container: HTMLElement, options?: PlanetWidgetOptions);
    /** Canvas element rendered into the host container. */
    get domElement(): HTMLCanvasElement;
    /** Stop the render loop, remove the canvas, and dispose GPU resources. */
    destroy(): void;
    /**
     * Update the widget in place from a partial set of options, without recreating it — so
     * the camera zoom, spin and tilt are preserved. Scene, lighting and material tweaks
     * apply live; changes that touch geometry (radius, land/water colour, bevel, colour
     * jitter), the marker set, or the cloud field rebuild only the mesh they affect.
     * Anything omitted is left unchanged.
     */
    setOptions(next: PlanetWidgetOptions): void;
    private applyBackground;
    private disposeMesh;
    private rebuildPlanet;
    private rebuildMarkers;
    private rebuildClouds;
    private applyLighting;
    private positionKey;
    private applyLiveMaterial;
    private resize;
    private onPointerDown;
    private onPointerMove;
    private onPointerUp;
    private onWheel;
    private applyOrientation;
    private tick;
    private render;
}
