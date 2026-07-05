import {
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { geoToSurface } from './planet';

/**
 * Appearance tunables passed to the {@link Marker} class. `color` and `size` are per-pin;
 * `voxel` is the pin's cube edge, which the {@link PlanetWidget} sets for every pin from its
 * single `markerVoxelSize` option — so it is not a per-pin field on {@link MarkerConfig}.
 */
export interface MarkerOptions {
  /** Pin voxel color (any CSS / hex color). Defaults to `#e8453d` (red). */
  color?: string;
  /** Overall pin height in world units. Defaults to `3`. */
  size?: number;
  /**
   * Edge length of one pin cube, in world units — the pin's voxel resolution. Smaller
   * cubes render the pin with more, finer voxels. Defaults to a small fraction of `size`
   * ({@link DEFAULT_VOXEL_FRACTION}) so the pin keeps the same fine look at any size.
   */
  voxel?: number;
}

/** A marker to place on the planet: a geographic point plus its per-pin appearance. */
export interface MarkerConfig {
  /** Pin voxel color (any CSS / hex color). Defaults to `#e8453d` (red). */
  color?: string;
  /** Overall pin height in world units. Defaults to `radius * 0.18`. */
  size?: number;
  /** Latitude in degrees, +90 (north) … −90 (south). */
  lat: number;
  /** Longitude in degrees, −180 … +180. */
  lon: number;
  /** Optional label for the point (not rendered yet; handy for identifying markers). */
  label?: string;
}

// The pin is a teardrop voxelised in its own plane: a round head with a hole, tapering
// down to a ROUNDED tip — a small circular cap, not a sharp point. The shape is described
// analytically (head circle + straight tangents down to a small tip circle) and rasterised
// at the chosen voxel size, so the voxels can be made finer just by shrinking the voxel —
// no hand-drawn mask to redo. Units: head radius = 1, head centred at the origin; the pin
// spans BOTTOM_Y … (1) tall.
const HEAD_R = 1;
const HOLE_R = 0.42; // hole radius (the see-through centre of the head)
// Virtual cone apex below the head: the straight sides are the tangents from this point to
// the head circle. The pin is rounded off at TIP_R before it reaches the apex, so it ends
// in a smooth cap instead of a sharp point.
const APEX_Y = -2.2;
const TIP_R = 0.42; // radius of the rounded bottom cap (was a sharp tip)

// Default pin voxel edge, as a fraction of the pin's height — so a pin keeps the same fine
// voxel look at any `size`. Small enough to read as many little cubes.
const DEFAULT_VOXEL_FRACTION = 0.03;

// Slab thickness in normalised units. The pin isn't billboarded, so this depth is seen
// edge-on as the planet turns; kept ~constant in world terms (voxel count scales with the
// resolution) for a clear side no matter how fine the voxels are.
const DEPTH_NORM = 0.4;

// Straight tangents ("cone") from the apex to the head circle, precomputed: below TANGENT_Y
// the outline is the straight taper of half-slope TAN_THETA; above it, the head circle. The
// same tangents are tangent to the rounded tip circle, so the sides flow into the cap.
const APEX_DIST = -APEX_Y; // apex distance from the head centre
const SIN_THETA = HEAD_R / APEX_DIST; // sine of the taper half-angle
const TANGENT_Y = -(HEAD_R * HEAD_R) / APEX_DIST;
const TAN_THETA = HEAD_R / Math.sqrt(APEX_DIST * APEX_DIST - HEAD_R * HEAD_R);
const TIP_CY = APEX_Y + TIP_R / SIN_THETA; // centre of the rounded tip circle (on the axis)
const BOTTOM_Y = TIP_CY - TIP_R; // lowest point of the pin (bottom of the cap)

/** Whether a point (in the pin's normalised plane) is inside the filled teardrop. */
function inPin(x: number, y: number): boolean {
  const distSq = x * x + y * y;
  if (distSq <= HOLE_R * HOLE_R) return false; // the hole
  if (distSq <= HEAD_R * HEAD_R) return true; // the head disk
  // The rounded tip: a small circular cap where the sharp point used to be.
  const dyc = y - TIP_CY;
  if (x * x + dyc * dyc <= TIP_R * TIP_R) return true;
  // The straight tapered sides, from the cap up to the head tangent.
  return y >= TIP_CY && y <= TANGENT_Y && Math.abs(x) <= (y - APEX_Y) * TAN_THETA;
}

const WORLD_UP = new Vector3(0, 1, 0);

// Minimum outward tilt of the pin's up-axis (its component along the surface normal).
// World-up alone points INTO the globe in the southern hemisphere, so an upright pin
// dips below the surface there; tilting the up-axis out along the normal until
// `up·normal ≥ OUTWARD_TILT` keeps the whole body outside the sphere at any latitude.
// Northern/high pins already clear it, so they stay exactly vertical (world +Y); only
// southern and near-equatorial pins tilt outward — i.e. we drop strict vertical there.
const OUTWARD_TILT = 0.2;

// Reused for the one-off orientation in placeAt.
const _up = new Vector3();
const _face = new Vector3();
const _east = new Vector3();
const _basis = new Matrix4();
// Reused by the per-frame visibility test so the hot path allocates nothing.
const _marker = new Vector3();
const _toCam = new Vector3();
const _center = new Vector3();

// Width of the fade band, in cos-angle, over which the pin fades out as its base
// crosses the horizon — wide enough to kill the pop, narrow enough to feel like a cut.
const FADE_BAND = 0.05;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A voxel map-pin marker anchored to a geographic point on the planet.
 *
 * The pin is a slab of small plastic cubes (see {@link inPin}) standing along its local
 * +Y with the tip at the origin. {@link Marker.placeAt} stands it vertically (world +Y,
 * face toward the viewer) wherever that clears the surface, and in the southern
 * hemisphere — where vertical would dip into the globe — tilts the up-axis outward along
 * the normal just enough to clear it ({@link OUTWARD_TILT}). It reads face-on at the
 * front, turns to show its slab thickness toward the limb, and is parented to the planet
 * to ride the spin; {@link Marker.update} only fades/hides it across the horizon.
 *
 * Parent {@link Marker.object} to the planet mesh and call {@link Marker.update} each
 * frame. Owns its geometry and material; call {@link Marker.dispose} when done.
 */
export class Marker {
  readonly object: InstancedMesh;
  private readonly material: MeshStandardMaterial;

  constructor(options: MarkerOptions = {}) {
    const color = options.color ?? '#e8453d';
    const size = options.size ?? 3;

    // Scale so the whole pin (BOTTOM_Y … head top) is `size` tall in world units, then
    // rasterise the teardrop on a grid whose pitch is the requested world voxel expressed
    // in normalised units. `voxel` defaults to a fraction of `size` (see above).
    const spanY = HEAD_R - BOTTOM_Y; // normalised pin height (incl. the rounded tip)
    const scale = size / spanY; // world units per normalised unit
    const voxel = options.voxel ?? size * DEFAULT_VOXEL_FRACTION; // world edge of one voxel
    const pitch = voxel / scale; // grid pitch in normalised units
    // Depth in voxels, from a ~constant world thickness — so finer voxels give a thicker
    // stack of thinner cubes, keeping the slab's side roughly the same size on screen.
    const depth = Math.max(1, Math.round(DEPTH_NORM / pitch));

    // Voxel-centre coords in the pin's plane: x symmetric about 0, y from the tip up.
    const nx = Math.ceil((HEAD_R + pitch) / pitch);
    const ny = Math.ceil((HEAD_R - BOTTOM_Y) / pitch);
    const cells: [number, number][] = [];
    for (let j = 0; j < ny; j++) {
      const y = BOTTOM_Y + (j + 0.5) * pitch;
      for (let i = -nx; i <= nx; i++) {
        const x = i * pitch;
        if (inPin(x, y)) cells.push([x, y]);
      }
    }

    // Same rounded plastic cube as the planet, sized to one voxel. Normal depth testing
    // is on, so the pin's own thickness self-occludes solidly and it sits in the scene
    // depth properly; the outward tilt keeps the body clear of the globe at every
    // latitude, and a high renderOrder draws it after the globe.
    const geometry = new RoundedBoxGeometry(voxel, voxel, voxel, 1, voxel * 0.18);
    this.material = new MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0,
    });

    const mesh = new InstancedMesh(geometry, this.material, cells.length * depth);
    mesh.renderOrder = 10;
    const m = new Matrix4();
    let i = 0;
    for (const [x, y] of cells) {
      const wx = x * scale;
      const wy = (y - BOTTOM_Y) * scale; // pin bottom lands on y = 0, head climbs in +Y
      for (let d = 0; d < depth; d++) {
        const wz = (d - (depth - 1) / 2) * voxel;
        m.makeTranslation(wx, wy, wz);
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.object = mesh;
  }

  /**
   * Place the pin's tip at a geographic `[lat, lon]` and orient it once, in the
   * planet's local space (the object is parented to the planet, so the spin carries it).
   *
   * The up axis (local +Y) is world-up tilted outward along the normal by just enough to
   * clear the surface: `tilt = max(0, OUTWARD_TILT − sinlat)`, so northern/high pins keep
   * `tilt = 0` (exactly vertical) and southern ones tilt out (dropping strict vertical).
   * The face (local +Z) is the outward normal projected perpendicular to that up axis, so
   * it stays as face-on to the viewer as the tilt allows; local +X = up × face.
   */
  placeAt(latDeg: number, lonDeg: number, radius: number): void {
    const { position, normal, north } = geoToSurface(latDeg, lonDeg, radius);
    this.object.position.copy(position);

    // up = world-up nudged out along the normal until up·normal ≥ OUTWARD_TILT, so the
    // body always sits outside the sphere. normal.y = sin(latitude).
    const tilt = Math.max(0, OUTWARD_TILT - normal.y);
    _up.copy(WORLD_UP).addScaledVector(normal, tilt).normalize();
    // face = the outward normal made perpendicular to up (its most face-on direction).
    _face.copy(normal).addScaledVector(_up, -normal.dot(_up));
    if (_face.lengthSq() < 1e-6) _face.copy(north); // up ∥ normal (poles): any tangent face
    _face.normalize();
    _east.crossVectors(_up, _face); // local +X
    _basis.makeBasis(_east, _up, _face); // local x = east, y = up, z = face
    this.object.quaternion.setFromRotationMatrix(_basis);
  }

  /**
   * Fade the pin out and hide it once the planet's spin carries it past the globe's
   * horizon. Call once per frame, before rendering.
   *
   * @param cameraWorldPos - Camera position in world space.
   * @param planet - The planet the pin is parented to (its center anchors the horizon).
   */
  update(cameraWorldPos: Vector3, planet: Object3D): void {
    this.object.getWorldPosition(_marker);
    planet.getWorldPosition(_center);

    // Horizon test: visible only while the cosine of the pin's angle from the camera
    // direction exceeds the tangent (`radius / cameraDistance`).
    _marker.sub(_center);
    _toCam.copy(cameraWorldPos).sub(_center);
    const r = _marker.length();
    const camDist = _toCam.length();
    const cosAngle = _marker.dot(_toCam) / (r * camDist);
    const opacity = smoothstep(r / camDist, r / camDist + FADE_BAND, cosAngle);

    const visible = opacity > 0.001;
    this.object.visible = visible;
    if (visible) {
      this.material.transparent = opacity < 1;
      this.material.opacity = opacity;
    }
  }

  /** Dispose the pin's geometry and material. */
  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
