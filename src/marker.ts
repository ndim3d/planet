import {
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { geoToSurface } from './planet';

/** Appearance tunables of a surface marker. All fields optional. */
export interface MarkerOptions {
  /** Pin voxel color (any CSS / hex color). Defaults to `#e8453d` (red). */
  color?: string;
  /** Overall pin height in world units. Defaults to `3`. */
  size?: number;
}

/** A marker to place on the planet: a geographic point plus its appearance. */
export interface MarkerConfig extends MarkerOptions {
  /** Latitude in degrees, +90 (north) … −90 (south). */
  lat: number;
  /** Longitude in degrees, −180 … +180. */
  lon: number;
  /** Optional label for the point (not rendered yet; handy for identifying markers). */
  label?: string;
}

// The pin is a teardrop voxelised in its own plane: a round head with a hole, blending
// into a point below. The shape is described analytically (head circle + the tangent
// "cone" down to the tip) and rasterised at RES, so the voxels can be made smaller just
// by raising RES — no hand-drawn mask to redo. Units: head radius = 1, head centred at
// the origin, tip at TIP_Y; the whole pin spans TIP_Y … (1) tall.
const HEAD_R = 1;
const HOLE_R = 0.42; // hole radius (the see-through centre of the head)
const TIP_Y = -2.2; // tip apex, below the head
// Voxels across the head diameter — the knob for voxel smallness (higher = smaller).
const RES = 16;

// Voxels through the slab. The pin is no longer billboarded, so this thickness is
// genuinely seen edge-on as the planet turns — keep it a few voxels for a clear side.
const DEPTH = 3;

// Tangent ("cone") from the tip to the head circle, precomputed: below TANGENT_Y the
// outline is the straight taper of half-slope TAN_THETA; above it, it's the head circle.
const TIP_DIST = -TIP_Y; // tip distance from head centre
const TANGENT_Y = -(HEAD_R * HEAD_R) / TIP_DIST;
const TAN_THETA = HEAD_R / Math.sqrt(TIP_DIST * TIP_DIST - HEAD_R * HEAD_R);

/** Whether a point (in the pin's normalised plane) is inside the filled teardrop. */
function inPin(x: number, y: number): boolean {
  const distSq = x * x + y * y;
  if (distSq <= HOLE_R * HOLE_R) return false; // the hole
  if (distSq <= HEAD_R * HEAD_R) return true; // the head disk
  // The tapered point: inside the straight cone from the tip up to the tangent.
  return y >= TIP_Y && y <= TANGENT_Y && Math.abs(x) <= (y - TIP_Y) * TAN_THETA;
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
 * front, turns to show its {@link DEPTH} thickness toward the limb, and is parented to
 * the planet to ride the spin; {@link Marker.update} only fades/hides it across the horizon.
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

    // Rasterise the teardrop on a grid of pitch `pitch` (in normalised units), then
    // scale so the whole pin (TIP_Y … head top) is `size` tall in world units.
    const pitch = (2 * HEAD_R) / RES;
    const spanY = HEAD_R - TIP_Y; // normalised pin height
    const scale = size / spanY;
    const voxel = pitch * scale; // world edge of one voxel

    // Voxel-centre coords in the pin's plane: x symmetric about 0, y from the tip up.
    const nx = Math.ceil((HEAD_R + pitch) / pitch);
    const ny = Math.ceil((HEAD_R - TIP_Y) / pitch);
    const cells: [number, number][] = [];
    for (let j = 0; j < ny; j++) {
      const y = TIP_Y + (j + 0.5) * pitch;
      for (let i = -nx; i <= nx; i++) {
        const x = i * pitch;
        if (inPin(x, y)) cells.push([x, y]);
      }
    }

    // Same rounded plastic cube as the planet, sized to one voxel. Normal depth testing
    // is on, so the pin's own thickness self-occludes solidly and it sits in the scene
    // depth properly; the outward tilt keeps the body clear of the globe at every
    // latitude, and a high renderOrder draws it after the globe.
    const geometry = new RoundedBoxGeometry(voxel, voxel, voxel, 2, voxel * 0.18);
    this.material = new MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0,
      envMapIntensity: 0.9,
    });

    const mesh = new InstancedMesh(geometry, this.material, cells.length * DEPTH);
    mesh.renderOrder = 10;
    const m = new Matrix4();
    let i = 0;
    for (const [x, y] of cells) {
      const wx = x * scale;
      const wy = (y - TIP_Y) * scale; // tip bottom lands on y = 0, head climbs in +Y
      for (let d = 0; d < DEPTH; d++) {
        const wz = (d - (DEPTH - 1) / 2) * voxel;
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
