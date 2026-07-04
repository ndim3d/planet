import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { isLand, LAT_STRETCH } from './land-mask';

export interface PlanetBuildOptions {
  /** Sea-level (equatorial) radius in world units. */
  radius: number;
  /** Water color (any CSS / hex color). */
  waterColor: string;
  /** Land color (any CSS / hex color). */
  landColor: string;
  /** Surface roughness, 0 (glossy) … 1 (matte). */
  roughness: number;
  /** Metalness, 0 … 1. */
  metalness: number;
  /** Cube edge chamfer, as a fraction of one cube (catches edge highlights). */
  bevel: number;
  /** Per-cube brightness jitter (± fraction) so the fields aren't dead-flat. */
  colorJitter: number;
  /** Cube edge length in world units — the voxel resolution. See {@link DEFAULT_VOXEL}. */
  voxel: number;
  /** Land relief above sea level, in cubes (extra voxel layers on land). See {@link DEFAULT_RELIEF}. */
  relief: number;
  /** Ring-radius quantisation step, as a fraction of a voxel. See {@link DEFAULT_RING_STEP}. */
  ringStep: number;
  /** Flat polar-cap half-angle, in degrees. See {@link DEFAULT_POLE_CAP}. */
  poleCap: number;
}

// Whether to draw continents (raised land cubes above the ocean).
const SHOW_LAND = true;

// Defaults for the tunable terrain knobs. Also the single source of truth for the
// exported LAND_CUBE / LAND_TOP_OFFSET below, which clouds and markers key off.
/** Cube edge length (world units) — the voxel lattice pitch. */
export const DEFAULT_VOXEL = 1.2;
/** Continental relief: land is raised this many voxel layers above the ocean surface. */
export const DEFAULT_RELIEF = 1.0;
/**
 * Ring-radius quantisation, as a fraction of a voxel. `1` = rings step in by a whole voxel
 * (chunky); smaller (e.g. `0.5`) lets a ring's radius track the sphere in sub-voxel steps,
 * so the curvature reads smoother without shrinking the cubes.
 */
export const DEFAULT_RING_STEP = 1.0;
/**
 * Flat polar cap half-angle, in degrees. The rings only run from the equator up to this
 * far from each pole; inside the cap the polar disk is tiled flat, so the rings never
 * collapse into a stretched singularity. `0` disables the cap (rings run to the pole).
 */
export const DEFAULT_POLE_CAP = 20;

const DEG2RAD = Math.PI / 180;

/** Outward distance from sea level to a land cube's top face (where markers sit). */
export const LAND_TOP_OFFSET = DEFAULT_RELIEF * DEFAULT_VOXEL;

/** World edge length of one surface (land/water) cube; clouds size their voxels off this. */
export const LAND_CUBE = DEFAULT_VOXEL;

/**
 * Map a geographic `[lat, lon]` (degrees) to the point on the land-top shell and the
 * outward normal there, in the planet's **local** space (before any spin).
 *
 * Applies the same {@link LAT_STRETCH} squeeze the land mask was baked with
 * (`planetLat = lat / LAT_STRETCH`), so a marker lands on the continent that is
 * actually drawn at that latitude instead of drifting poleward off it; the longitude
 * and the outward tangent frame match {@link buildPlanet} exactly. Parent the object
 * to the returned mesh (or apply its world matrix) so it follows the rotation.
 *
 * Returns the surface `position`, the outward `normal`, and the `north` tangent (along
 * the meridian toward the north pole) — enough to build a local surface frame
 * (`east = north × normal`).
 */
export function geoToSurface(
  latDeg: number,
  lonDeg: number,
  radius: number,
): { position: Vector3; normal: Vector3; north: Vector3 } {
  const lat = (latDeg / LAT_STRETCH) * DEG2RAD;
  const th = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const normal = new Vector3(cosLat * ct, sinLat, -cosLat * st);
  const north = new Vector3(-sinLat * ct, cosLat, sinLat * st);
  const position = normal.clone().multiplyScalar(radius + LAND_TOP_OFFSET);
  return { position, normal, north };
}

/**
 * Build the planet as a single {@link InstancedMesh}: a **voxel solid of revolution**.
 *
 * The globe is a stack of latitude rings (like the reference art). Each layer is one
 * voxel ({@link PlanetBuildOptions.voxel}) tall along the polar axis; its ring radius is
 * the sphere's radius at that height *quantised* (to {@link PlanetBuildOptions.ringStep}
 * of a voxel). The radius holds for several layers — a vertical wall of cubes, correct
 * where the surface is near-vertical (the equator) — and steps inward where the sphere
 * curves away. Cubes yaw around the axis to face outward, tops flat, so they read as even
 * horizontal rows rather than a Cartesian bump field or a gnomonic terrace bullseye.
 *
 * Where the sphere curves away fast (toward the poles) the radius drops by more than a
 * voxel between layers; that ledge is tiled with several **one-voxel** concentric rings
 * rather than one stretched deep cube, so the surface never steps by more than a voxel and
 * every cube keeps its bevels. The polar neighbourhood ({@link PlanetBuildOptions.poleCap})
 * is tiled flat instead of collapsing the rings into a stretched singularity. Land is
 * pushed {@link PlanetBuildOptions.relief} out.
 *
 * The returned mesh owns its geometry and material; dispose them when done.
 */
export function buildPlanet(opts: PlanetBuildOptions): InstancedMesh {
  const { radius: R, bevel, colorJitter } = opts;
  const water = new Color(opts.waterColor);
  const land = new Color(opts.landColor);

  const CUBE = opts.voxel; // world-axis lattice pitch (cube edge)
  const relief = opts.relief * CUBE; // land raised this far (in world units) above the ocean

  const mats: Matrix4[] = [];
  const cols: Color[] = [];
  const ex = new Vector3(); // tangential — around the parallel
  const ez = new Vector3(); // outward — radial, in the XZ plane
  const ey = new Vector3(0, 1, 0); // up — along the polar axis
  const pos = new Vector3();
  const scl = new Vector3();
  const m = new Matrix4();
  const tint = new Color();

  // Emit one cube with local axes ex/ey/ez, scaled (sx,sy,sz), centred at (px,py,pz).
  const pushCube = (
    px: number, py: number, pz: number,
    exv: Vector3, eyv: Vector3, ezv: Vector3,
    sx: number, sy: number, sz: number,
    color: Color,
  ): void => {
    scl.set(sx, sy, sz);
    pos.set(px, py, pz);
    m.makeBasis(exv, eyv, ezv);
    m.scale(scl);
    m.setPosition(pos);
    mats.push(new Matrix4().copy(m));
    // Jitter each cube's brightness a touch so the fields aren't dead-flat.
    tint.copy(color).multiplyScalar(1 + (Math.random() * 2 - 1) * colorJitter);
    cols.push(tint.clone());
  };

  // Point-sample land/water for a direction. The mask (see land-mask.ts) is now finer than
  // a voxel and carries sub-voxel coastline detail, so a single nearest-cell lookup is what
  // we want: the coastline anti-aliasing is done by the sub-voxel split below (a coastal cell
  // is rendered as four half-cubes, each sampled here), not by a majority vote that would
  // erode thin land (Italy) and carve false holes (the old central-Europe "lake").
  const landAtDir = (px: number, py: number, pz: number): boolean => {
    const len = Math.hypot(px, py, pz);
    if (len === 0) return false;
    const latDeg = Math.asin(Math.max(-1, Math.min(1, py / len))) * 57.2958;
    const lonDeg = Math.atan2(-pz, px) * 57.2958; // atan2 is scale-invariant, so raw coords are fine
    // The equator-ward squeeze is already baked into the mask (see land-mask.ts).
    return isLand(latDeg, lonDeg);
  };

  // Grow cubes a hair so neighbours abut despite the faceting.
  const OVERLAP = 1.04;
  const ringStepW = Math.max(0.05, opts.ringStep) * CUBE; // radial quantisation step (world units)
  const capAngle = opts.poleCap * DEG2RAD; // flat-cap half-angle at each pole
  const yCapMax = R * Math.cos(capAngle); // |y| beyond which the surface is tiled flat
  const iyCap = Math.max(1, Math.floor(yCapMax / CUBE)); // top/bottom layer = flat cap

  // Quantised ring radius at height `yy`: the sphere radius rounded to whole ring steps.
  const rhoAt = (yy: number): number => {
    const ri = Math.sqrt(Math.max(0, R * R - yy * yy));
    return Math.max(CUBE, Math.round(ri / ringStepW) * ringStepW);
  };

  // Emit one outward-facing wall cube: at longitude `th` and height `y`, tangential width
  // `arcW` and axial height `hgt`, one voxel deep radially (+ the relief cliff on land).
  const emitFacet = (
    r: number, th: number, y: number, arcW: number, hgt: number, isLandHere: boolean,
  ): void => {
    const ct = Math.cos(th), st = Math.sin(th);
    ex.set(-st, 0, -ct); // tangent, around the parallel
    ez.set(ct, 0, -st); // outward radial (matches geoToSurface: lon = atan2(-z, x))
    const thick = CUBE + (isLandHere ? relief : 0); // one voxel deep (+ the coastal cliff)
    const outerR = r + (isLandHere ? relief : 0);
    const rc = outerR - thick / 2; // centre so the outward face lands on outerR
    pushCube(
      ez.x * rc, y, ez.z * rc,
      ex, ey, ez,
      arcW * OVERLAP, hgt * OVERLAP, thick,
      isLandHere ? land : water,
    );
  };

  // Emit one angular slot of the visible wall. A cell that is all land or all water is one
  // full cube; a cell the coastline crosses is split into four half-cubes (2×2 over its
  // longitude × height footprint), each land/water by its own sample — the sub-voxel
  // coastline that resolves peninsulas (Italy) below the base cube size, like the reference.
  const emitCell = (r: number, y: number, th: number, dTheta: number, arc: number): void => {
    const hth = dTheta / 4; // quarter cell in longitude → sub-cell centre offset
    const hy = CUBE / 4; //    quarter cell in height
    const sample = (dth: number, dy: number): boolean => {
      const ct = Math.cos(th + dth), st = Math.sin(th + dth);
      return SHOW_LAND && landAtDir(ct * r, y + dy, -st * r);
    };
    const tl = sample(-hth, hy), tr = sample(hth, hy);
    const bl = sample(-hth, -hy), br = sample(hth, -hy);
    if (tl === tr && tl === bl && tl === br) {
      emitFacet(r, th, y, arc, CUBE, tl); // uniform cell → one full cube
      return;
    }
    emitFacet(r, th - hth, y + hy, arc / 2, CUBE / 2, tl);
    emitFacet(r, th + hth, y + hy, arc / 2, CUBE / 2, tr);
    emitFacet(r, th - hth, y - hy, arc / 2, CUBE / 2, bl);
    emitFacet(r, th + hth, y - hy, arc / 2, CUBE / 2, br);
  };

  // Emit one ring of outward-facing cubes: radius `r`, height `y`. The visible outward wall
  // (`sub`) gets the sub-voxel coastline; the backing rings behind it stay plain full cubes
  // (they only close see-through gaps, so their coastline is never seen).
  const emitRing = (r: number, y: number, sub: boolean): void => {
    const nt = Math.max(1, Math.round((2 * Math.PI * r) / CUBE)); // cubes around, ~square
    const dTheta = (2 * Math.PI) / nt;
    const arc = (2 * Math.PI * r) / nt;
    for (let it = 0; it < nt; it++) {
      const th = (it + 0.5) * dTheta;
      if (sub) {
        emitCell(r, y, th, dTheta, arc);
      } else {
        emitFacet(r, th, y, arc, CUBE, SHOW_LAND && landAtDir(Math.cos(th) * r, y, -Math.sin(th) * r));
      }
    }
  };

  // Latitude rings from the equator up to the cap boundary — one layer (CUBE) tall each.
  // Where the sphere curves away fast (toward the poles) the radius drops by more than a
  // voxel between layers; rather than one stretched deep cube, that ledge is tiled with
  // several **one-voxel** concentric rings, so the surface never steps by more than a voxel
  // and every cube keeps its bevels.
  for (let iy = -(iyCap - 1); iy <= iyCap - 1; iy++) {
    const y = iy * CUBE;
    const rhoOuter = rhoAt(y);
    const innerLimit = rhoAt(Math.abs(y) + CUBE); // radius of the next layer toward the pole
    // Tile from the outward wall inward to one voxel *past* the next layer, so the shell is
    // two rings thick everywhere: a second ring always sits behind the bevel grooves and the
    // sub-voxel gap between layers, closing any see-through into the hollow interior. Each
    // cube stays one voxel (no stretching); the backing ring is hidden except in the grooves.
    let outer = true; // only the outward wall gets the sub-voxel coastline
    for (let r = rhoOuter; r >= innerLimit - CUBE - 1e-6; r -= CUBE) {
      emitRing(r, y, outer);
      outer = false;
    }
  }

  // Flat polar caps: the cap layer replaces the top ring (no duplicate same-radius ring +
  // cap), tiling the polar disk flat with upright cubes. Land on the cap is raised toward
  // the pole by the relief.
  const capRho = rhoAt(iyCap * CUBE);
  const capFill = capRho + CUBE * 0.6; // reach a touch past the last ring so the rim has no seam
  const gN = Math.ceil(capFill / CUBE);
  ex.set(1, 0, 0);
  ez.set(0, 0, 1);
  // One upright cube on the cap disk (raised toward the pole by the relief on land), or a
  // half-size one for a sub-voxel coastline cell.
  const emitCap = (cx: number, cz: number, capY: number, s: number, size: number, isLandHere: boolean): void => {
    const yy = capY + (isLandHere ? s * relief : 0);
    pushCube(cx, yy, cz, ex, ey, ez, size * OVERLAP, CUBE, size * OVERLAP, isLandHere ? land : water);
  };
  for (const s of [1, -1] as const) {
    const capY = s * iyCap * CUBE;
    for (let gi = -gN; gi <= gN; gi++) {
      for (let gk = -gN; gk <= gN; gk++) {
        const gx = gi * CUBE, gz = gk * CUBE;
        if (gx * gx + gz * gz > capFill * capFill) continue;
        // Sub-voxel coastline on the cap too: split a mixed cell into 2×2 half-cubes.
        const q = CUBE / 4;
        const capLand = (dx: number, dz: number): boolean => SHOW_LAND && landAtDir(gx + dx, capY, gz + dz);
        const tl = capLand(-q, -q), tr = capLand(q, -q), bl = capLand(-q, q), br = capLand(q, q);
        if (tl === tr && tl === bl && tl === br) {
          emitCap(gx, gz, capY, s, CUBE, tl);
          continue;
        }
        emitCap(gx - q, gz - q, capY, s, CUBE / 2, tl);
        emitCap(gx + q, gz - q, capY, s, CUBE / 2, tr);
        emitCap(gx - q, gz + q, capY, s, CUBE / 2, bl);
        emitCap(gx + q, gz + q, capY, s, CUBE / 2, br);
      }
    }
  }

  const geometry = new RoundedBoxGeometry(1, 1, 1, 2, bevel);
  const material = new MeshStandardMaterial({
    roughness: opts.roughness,
    metalness: opts.metalness,
  });
  const mesh = new InstancedMesh(geometry, material, mats.length);
  for (let i = 0; i < mats.length; i++) {
    mesh.setMatrixAt(i, mats[i]);
    mesh.setColorAt(i, cols[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return mesh;
}
