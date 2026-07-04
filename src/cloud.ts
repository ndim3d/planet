import { InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

interface Lump {
  x: number;
  y: number;
  z: number;
  r: number;
}

// One cartoon cloud as overlapping lumps in voxel units. Local axes: x is width, z is
// depth (both horizontal once placed), y is height — which grows straight up (world +Y),
// like the reference, not out along the surface normal. Like the reference the cloud is a
// broad, flat pad — wide in x and z, low in y — with a few rounded bumps rising on top, and
// a roughly level bottom.
const TEMPLATE: readonly Lump[] = [
  // Broad flat base, spread across width (x) and depth (z), all sitting near y = 0 — this is
  // the level underside of the cloud.
  { x: 0.0, y: 0.0, z: 0.0, r: 3.0 },
  { x: -3.4, y: 0.0, z: -0.2, r: 2.2 },
  { x: 3.4, y: 0.0, z: 0.2, r: 2.2 },
  { x: 0.3, y: 0.0, z: 2.4, r: 2.0 },
  { x: -0.5, y: 0.0, z: -2.3, r: 1.9 },
  // Distinct rounded bumps rising well above the base — the puffy top of the cumulus.
  { x: -2.0, y: 2.2, z: 0.1, r: 1.9 },
  { x: 1.6, y: 2.4, z: 0.3, r: 1.8 },
  { x: 0.1, y: 2.7, z: -0.6, r: 1.6 },
];

// Squashes applied in the lump test. Higher flattens that axis. Depth (z) is kept full so
// clouds read as plump 3D pads, not plates; height (y) is only lightly squashed so the base
// stays broad and level while the bumps still rise into clear humps (see the reference).
const Z_SQUASH = 1.0;
const Y_SQUASH = 1.35;

// Cloud voxels are a bit larger than the land cubes (see reference).
const DEFAULT_CLOUD_VOXEL = 1.0;

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

export const CLOUD_DEFAULTS: Required<BuildCloudsOptions> = {
  count: 6,
  seed: 613,
  size: 1.55,
  voxel: DEFAULT_CLOUD_VOXEL,
  clearance: 0,
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

// Face-neighbour directions in the voxel lattice (6-connectivity). Two cubes are "solidly"
// joined only when they share a whole face — an edge- or corner-only touch reads as a cube
// barely hanging on. The stored triples are a permutation of the grid coords, but a ±1 step
// in exactly one component is a shared face whatever the order, so this works on them as-is.
const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
// Pack a small signed voxel coord triple into one integer key (coords stay well within ±128).
const packVoxel = (a: number, b: number, c: number): number =>
  (((a + 128) << 16) | ((b + 128) << 8) | (c + 128)) >>> 0;

/**
 * Erode a cloud's voxels to a cohesive solid: repeatedly drop every voxel that shares a face
 * with fewer than two others, until none remain. This peels off the stray cubes that clung to
 * the body by a single face (or only an edge/corner), so the cloud reads as one welded lump
 * instead of a blob with loose bits — while a dense cluster (every interior/surface voxel has
 * 3+ face-neighbours) only loses its lone protruding tips and converges after a pass or two.
 */
function cohere(voxels: Array<[number, number, number]>): Array<[number, number, number]> {
  let current = voxels;
  const present = new Set(current.map(([a, b, c]) => packVoxel(a, b, c)));
  for (;;) {
    const doomed = new Set<number>();
    for (const [a, b, c] of current) {
      let n = 0;
      for (const [dx, dy, dz] of FACE_DIRS) if (present.has(packVoxel(a + dx, b + dy, c + dz))) n++;
      if (n < 2) doomed.add(packVoxel(a, b, c));
    }
    if (doomed.size === 0) return current;
    const next: Array<[number, number, number]> = [];
    for (const v of current) {
      const p = packVoxel(v[0], v[1], v[2]);
      if (doomed.has(p)) present.delete(p);
      else next.push(v);
    }
    current = next;
  }
}

/**
 * Build the background clouds as one white {@link InstancedMesh} of plump voxel cubes (a
 * bit larger than the land cubes). Each cloud is a cluster of overlapping lumps
 * ({@link TEMPLATE}) rasterised on a voxel grid, then scattered over the globe (from
 * {@link BuildCloudsOptions.seed}) and oriented **upright**: its flat base lies in the
 * horizontal plane and the bumps grow straight up (world +Y), like the reference — the
 * cloud stands up out of the globe rather than leaning out along the surface normal.
 *
 * `count`, `seed`, `size` and `clearance` (see {@link BuildCloudsOptions}) drive the
 * scatter. Each cloud is pushed out along its radial direction to the smallest distance at
 * which its whole upright body still clears the sea-level shell by `clearance`, so it hugs
 * the globe without intersecting it at any spin angle (the clearance is rigid-rotation
 * invariant, so it holds as the field turns).
 *
 * Add the mesh to the scene and ease its orientation toward the planet's each frame (see
 * PlanetWidget) so the clouds trail the spin on a rubber band. The planet spins about the
 * vertical pole (Y), and a Y-rotation leaves +Y fixed, so the upright clouds stay upright
 * as they orbit — only a pitch/tilt drag leans them. Owns its geometry and material; dispose
 * them when done.
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
  const width = new Vector3(); // horizontal, across the cloud (⊥ depth)
  const depth = new Vector3(); // horizontal, the cloud's outward-facing direction
  const up = new Vector3(0, 1, 0); // world up — the axis the bumps grow along
  const normal = new Vector3(); // radial direction of the spot the cloud floats over
  const o = new Vector3(); // a voxel's offset from the cloud origin (world units)
  const m = new Matrix4();

  // Half a voxel of margin so it's the cube's inner *face*, not its centre, that must
  // clear the shell. The shell we keep clear of is sea level (`radius`).
  const half = voxel * 0.5;
  const surface = radius + clearance + half;

  for (const place of placements) {
    const s = place.scale;
    const mir = place.mirror ? -1 : 1;
    normal.copy(surfaceFrame(place.lat, place.lon).normal);

    // Upright frame: the cloud stands up (bumps along world +Y) wherever it sits. `depth` is
    // the radial direction flattened into the horizontal plane (so the cloud faces outward),
    // `width` is the horizontal perpendicular. Near a pole the radial is almost vertical and
    // its horizontal part vanishes, so fall back to a fixed horizontal facing.
    depth.set(normal.x, 0, normal.z);
    if (depth.lengthSq() < 1e-6) depth.set(1, 0, 0);
    depth.normalize();
    width.set(depth.z, 0, -depth.x); // = up × depth, horizontal and ⊥ depth

    // Rasterise this cloud's lumps into integer voxel coords (i: width, j: base→top→up,
    // k: depth).
    let minI = Infinity, maxI = -Infinity;
    let minJ = Infinity, maxJ = -Infinity;
    let minK = Infinity, maxK = -Infinity;
    for (const l of TEMPLATE) {
      minI = Math.min(minI, (l.x - l.r) * s); maxI = Math.max(maxI, (l.x + l.r) * s);
      minJ = Math.min(minJ, (l.y - l.r) * s); maxJ = Math.max(maxJ, (l.y + l.r) * s);
      minK = Math.min(minK, (l.z - l.r) * s); maxK = Math.max(maxK, (l.z + l.r) * s);
    }

    const raw: Array<[number, number, number]> = [];
    for (let i = Math.floor(minI); i <= Math.ceil(maxI); i++) {
      for (let j = Math.floor(minJ); j <= Math.ceil(maxJ); j++) {
        for (let k = Math.floor(minK); k <= Math.ceil(maxK); k++) {
          for (const l of TEMPLATE) {
            const dx = i - l.x * s;
            const dy = (j - l.y * s) * Y_SQUASH;
            const dz = (k - l.z * s) * Z_SQUASH;
            if (dx * dx + dy * dy + dz * dz <= l.r * s * (l.r * s)) {
              raw.push([i, k, j]); // store as (width i, depth k, up j)
              break;
            }
          }
        }
      }
    }
    // Drop loosely-attached voxels so the cloud reads as one solid lump, not a blob with
    // stray cubes hanging off by a single face/edge.
    const voxels = cohere(raw);

    // Push the cloud out along `normal` to the smallest distance `centreR` at which every
    // voxel clears `surface`. A voxel sits at `centreR·normal + o`, where `o` is its upright
    // offset (width·iv + depth·kv + up·jv); requiring |centreR·normal + o| ≥ surface and
    // solving the quadratic (normal is a unit vector) gives
    // centreR ≥ −(normal·o) + √((normal·o)² − |o|² + surface²), maximised over the voxels.
    let centreR = radius;
    for (const [i, k, j] of voxels) {
      o.set(0, 0, 0)
        .addScaledVector(width, mir * i * voxel)
        .addScaledVector(depth, k * voxel)
        .addScaledVector(up, j * voxel);
      const nDotO = normal.dot(o);
      const need = -nDotO + Math.sqrt(Math.max(0, nDotO * nDotO - o.lengthSq() + surface * surface));
      if (need > centreR) centreR = need;
    }

    // Emit the voxels as upright cubes at their world positions.
    m.makeBasis(width, up, depth); // cube axes: x→width, y→up, z→depth
    for (const [i, k, j] of voxels) {
      offset
        .copy(normal).multiplyScalar(centreR)
        .addScaledVector(width, mir * i * voxel)
        .addScaledVector(depth, k * voxel)
        .addScaledVector(up, j * voxel);
      m.setPosition(offset);
      mats.push(new Matrix4().copy(m));
    }
  }

  const geometry = new RoundedBoxGeometry(voxel, voxel, voxel, 2, voxel * 0.18);
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.75,
    metalness: 0,
  });
  const mesh = new InstancedMesh(geometry, material, mats.length);
  for (let n = 0; n < mats.length; n++) mesh.setMatrixAt(n, mats[n]);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
