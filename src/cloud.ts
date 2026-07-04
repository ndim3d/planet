import { InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LAND_CUBE } from './planet';

interface Lump {
  x: number;
  y: number;
  z: number;
  r: number;
}

// One cartoon cloud as overlapping lumps in voxel units. Local axes: x is width, z is
// depth (both tangent to the surface), y is height (radially outward once placed). Like
// the reference the cloud is a broad, flat pad — wide in x and z, low in y — with a few
// rounded bumps rising on top, and a roughly level bottom.
const TEMPLATE: readonly Lump[] = [
  // Broad flat base, spread across width (x) and depth (z), all sitting near y = 0.
  { x: 0.0, y: 0.0, z: 0.0, r: 2.9 },
  { x: -3.3, y: 0.0, z: -0.2, r: 2.1 },
  { x: 3.3, y: -0.1, z: 0.2, r: 2.3 },
  { x: 0.4, y: 0.0, z: 2.3, r: 1.9 },
  { x: -0.6, y: 0.0, z: -2.2, r: 1.8 },
  // A few rounded bumps rising on top.
  { x: -1.6, y: 1.5, z: 0.1, r: 1.8 },
  { x: 1.5, y: 1.6, z: 0.4, r: 1.6 },
  { x: 0.2, y: 1.7, z: -0.7, r: 1.4 },
];

// Squashes applied in the lump test. Higher flattens that axis. Depth (z) is kept full
// so clouds read as plump 3D pads, not plates; height (y) is squashed hard so the pad
// stays wide and low with a level-ish bottom, matching the flat reference clouds.
const Z_SQUASH = 1.0;
const Y_SQUASH = 1.9;

// Cloud voxels are a bit larger than the land cubes (see reference).
const DEFAULT_CLOUD_VOXEL = LAND_CUBE * 1.3;

const DEG2RAD = Math.PI / 180;

/** Options controlling how the cloud field is generated. All optional; see the defaults. */
export interface BuildCloudsOptions {
  /** How many clouds to scatter over the globe. Defaults to `6`. */
  count?: number;
  /** Seed for the placement RNG — the same seed always gives the same layout. Defaults to `1`. */
  seed?: number;
  /** Base size multiplier applied to every cloud. Defaults to `1`. */
  size?: number;
  /**
   * Edge length of one cloud cube, in world units — the cloud voxel resolution. Smaller
   * cubes render each cloud with more, finer voxels; larger cubes make it chunkier.
   * Defaults to `LAND_CUBE * 1.3` (a bit larger than the land cubes).
   */
  voxel?: number;
  /**
   * Gap in world units between a cloud's lowest voxel and the sea-level shell. Small, so
   * the clouds hug the surface without ever dipping into the planet as they ride the
   * spin. Defaults to ~0.6 of a cloud voxel.
   */
  clearance?: number;
}

const CLOUD_DEFAULTS: Required<BuildCloudsOptions> = {
  count: 6,
  seed: 1,
  size: 1,
  voxel: DEFAULT_CLOUD_VOXEL,
  clearance: DEFAULT_CLOUD_VOXEL * 0.6,
};

interface Placement {
  lat: number; // latitude of the spot the cloud floats over, degrees (+N)
  lon: number; // longitude, degrees
  scale: number; // scales the cloud's lumps
  mirror: boolean; // mirror left↔right, for variety
}

// Small fast seeded PRNG (mulberry32): a 32-bit seed → a deterministic stream of floats in
// [0, 1). Same seed ⇒ same cloud layout, which is what makes `seed` reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scatter `count` clouds over the sphere from `seed`. Latitudes are drawn as asin(2u−1) so
// points spread uniformly over the sphere (no clustering at the poles); a minimum angular
// separation is enforced by rejection so the clouds fall like blue noise instead of
// clumping. Per-cloud size jitter and mirroring add variety. Deterministic in `seed`.
function scatter(count: number, seed: number, size: number): Placement[] {
  const rng = mulberry32(seed);
  const placements: Placement[] = [];
  const dirs: Vector3[] = [];
  // The mean nearest-neighbour angle on a sphere scales like 1/√count; keep a fraction of
  // that as the separation floor so denser fields still fit.
  const minSep = 1.5 / Math.sqrt(count);
  for (let n = 0; n < count; n++) {
    let pick: { lat: number; lon: number; dir: Vector3 } | null = null;
    for (let tries = 0; tries < 24; tries++) {
      const lat = Math.asin(2 * rng() - 1) / DEG2RAD;
      const lon = rng() * 360 - 180;
      const dir = surfaceFrame(lat, lon).normal;
      if (!pick) pick = { lat, lon, dir }; // fall back to the first candidate if none clear
      if (dirs.every((d) => d.angleTo(dir) >= minSep)) {
        pick = { lat, lon, dir };
        break;
      }
    }
    const p = pick as { lat: number; lon: number; dir: Vector3 };
    dirs.push(p.dir);
    placements.push({
      lat: p.lat,
      lon: p.lon,
      scale: size * (0.6 + rng() * 0.25), // ~0.6–0.85 × size
      mirror: rng() < 0.5,
    });
  }
  return placements;
}

/**
 * Outward-facing local frame at a geographic direction: the radial `normal`, the `north`
 * tangent (toward the pole) and the `east` tangent (along the parallel). Matches the
 * planet's own tangent frame (see planet.ts) so a cloud sits square to the surface.
 */
function surfaceFrame(latDeg: number, lonDeg: number): {
  normal: Vector3;
  north: Vector3;
  east: Vector3;
} {
  const lat = latDeg * DEG2RAD;
  const th = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const normal = new Vector3(cosLat * ct, sinLat, -cosLat * st);
  const north = new Vector3(-sinLat * ct, cosLat, sinLat * st);
  const east = new Vector3(-st, 0, -ct);
  return { normal, north, east };
}

/**
 * Build the background clouds as one white {@link InstancedMesh} of plump voxel cubes (a
 * bit larger than the land cubes). Each cloud is a cluster of overlapping lumps
 * ({@link TEMPLATE}) rasterised on a voxel grid, then placed over a spot on the surface
 * (scattered from {@link BuildCloudsOptions.seed}) and oriented to the local tangent
 * frame: its flat base sits parallel to the ground with the bumps pointing radially out.
 *
 * `count`, `seed`, `size` and `clearance` (see {@link BuildCloudsOptions}) drive the
 * scatter. Each cloud is floated at the lowest altitude that still leaves `clearance`
 * between its nearest voxel and the sea-level shell, so it hugs the surface without ever
 * intersecting it — even as it rides the planet's spin around to the far side.
 *
 * Add the mesh to the scene and ease its orientation toward the planet's each frame (see
 * PlanetWidget) so the clouds trail the spin on a rubber band rather than turning rigidly
 * with the globe. Owns its geometry and material; dispose them when done.
 */
export function buildClouds(radius: number, options: BuildCloudsOptions = {}): InstancedMesh {
  const count = options.count ?? CLOUD_DEFAULTS.count;
  const seed = options.seed ?? CLOUD_DEFAULTS.seed;
  const size = options.size ?? CLOUD_DEFAULTS.size;
  const voxel = options.voxel ?? CLOUD_DEFAULTS.voxel;
  // Default clearance tracks the (possibly retuned) voxel, not the constant default.
  const clearance = options.clearance ?? voxel * 0.6;
  const placements = scatter(Math.max(0, Math.floor(count)), seed, size);

  const mats: Matrix4[] = [];

  // Reused scratch vectors.
  const offset = new Vector3();
  const east = new Vector3();
  const north = new Vector3();
  const normal = new Vector3();
  const m = new Matrix4();

  // Half a voxel of margin so it's the cube's inner *face*, not its centre, that must
  // clear the shell. The shell we keep clear of is sea level (`radius`).
  const half = voxel * 0.5;
  const surface = radius + clearance + half;

  for (const place of placements) {
    const s = place.scale;
    const mir = place.mirror ? -1 : 1;
    const frame = surfaceFrame(place.lat, place.lon);
    normal.copy(frame.normal);
    north.copy(frame.north);
    east.copy(frame.east);

    // Rasterise this cloud's lumps into integer voxel coords (i: width→east,
    // j: base→top→outward, k: depth→north).
    let minI = Infinity, maxI = -Infinity;
    let minJ = Infinity, maxJ = -Infinity;
    let minK = Infinity, maxK = -Infinity;
    for (const l of TEMPLATE) {
      minI = Math.min(minI, (l.x - l.r) * s); maxI = Math.max(maxI, (l.x + l.r) * s);
      minJ = Math.min(minJ, (l.y - l.r) * s); maxJ = Math.max(maxJ, (l.y + l.r) * s);
      minK = Math.min(minK, (l.z - l.r) * s); maxK = Math.max(maxK, (l.z + l.r) * s);
    }

    const voxels: Array<[number, number, number]> = [];
    for (let i = Math.floor(minI); i <= Math.ceil(maxI); i++) {
      for (let j = Math.floor(minJ); j <= Math.ceil(maxJ); j++) {
        for (let k = Math.floor(minK); k <= Math.ceil(maxK); k++) {
          for (const l of TEMPLATE) {
            const dx = i - l.x * s;
            const dy = (j - l.y * s) * Y_SQUASH;
            const dz = (k - l.z * s) * Z_SQUASH;
            if (dx * dx + dy * dy + dz * dz <= l.r * s * (l.r * s)) {
              voxels.push([i, k, j]); // store as (east i, north k, outward j)
              break;
            }
          }
        }
      }
    }

    // Distance from the planet centre to the cloud's origin so that every voxel clears
    // the surface. A voxel sits at `centreR·normal + iv·east + kv·north + jv·normal`, i.e.
    // at radius √((centreR+jv)² + iv² + kv²) from the centre. Requiring that ≥ `surface`
    // for the whole cloud gives centreR = maxᵥ(-jv + √(surface² − iv² − kv²)). The base
    // (lowest jv, near the axis) is what binds; tangential spread only pushes voxels out.
    let centreR = radius;
    for (const [i, k, j] of voxels) {
      const iv = i * voxel;
      const kv = k * voxel;
      const jv = j * voxel;
      const tang = iv * iv + kv * kv;
      const need = -jv + Math.sqrt(Math.max(0, surface * surface - tang));
      if (need > centreR) centreR = need;
    }

    // Emit the voxels as cubes oriented to the frame (so they tile neatly on the tilted
    // slab) at their world positions.
    m.makeBasis(east, north, normal); // cube axes: x→east, y→north, z→outward
    for (const [i, k, j] of voxels) {
      offset
        .copy(east).multiplyScalar(mir * i * voxel)
        .addScaledVector(north, k * voxel)
        .addScaledVector(normal, centreR + j * voxel);
      m.setPosition(offset);
      mats.push(new Matrix4().copy(m));
    }
  }

  const geometry = new RoundedBoxGeometry(voxel, voxel, voxel, 2, voxel * 0.18);
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.75,
    metalness: 0,
    envMapIntensity: 0.5,
  });
  const mesh = new InstancedMesh(geometry, material, mats.length);
  for (let n = 0; n < mats.length; n++) mesh.setMatrixAt(n, mats[n]);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
