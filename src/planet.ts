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
  /** Environment-map reflection strength. */
  envMapIntensity: number;
  /** Cube edge chamfer, as a fraction of one cube (catches edge highlights). */
  bevel: number;
  /** Per-cube brightness jitter (± fraction) so the fields aren't dead-flat. */
  colorJitter: number;
}

// Whether to draw continents (raised LAND_RELIEF cubes above the ocean).
const SHOW_LAND = true;

// Edge length of one surface cube (tangentially, and along the parallel). The sphere
// is tiled by a single layer of these — one cube per lat/lon cell — so the radius is
// effectively measured in cubes (R / CUBE cubes from the centre to sea level).
const CUBE = 1.2;

// Continental relief, in cubes (fractional is fine): land cubes sit this proud of the
// ocean shell. Below 1 the land is only partly lifted — it sits "sunk" into the sea
// rather than standing a full cube tall.
const LAND_RELIEF = 0.4;

// Radial depth of a cube. At least a full cube deep (so cubes read as cubes, not thin
// tiles) and never less than the relief height, so a raised land cube's side wall
// covers the coastal cliff down to the water — no gap into the dark interior, and no
// land cube left flush with the sea.
const THICKNESS = CUBE * Math.max(1, LAND_RELIEF + 0.2);

// Grow cubes a hair tangentially and along the parallel so neighbours abut despite
// the faceting (the sphere is a coarse polygon up close). Radially they just stack,
// so no radial overlap — that only causes coplanar z-fighting.
const OVERLAP = 1.04;

const DEG2RAD = Math.PI / 180;

/** Outward distance from sea level to a land cube's top face (where markers sit). */
export const LAND_TOP_OFFSET = LAND_RELIEF * CUBE;

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
 * Build the planet as a single {@link InstancedMesh}: a **UV-sphere of cubes**.
 *
 * One cube per latitude/longitude cell, laid in a single shell. Rows follow the
 * parallels at an even arc spacing ({@link CUBE}); each row carries `round(2πρ/CUBE)`
 * cubes, so they stay roughly square from the equator to the poles and thin out
 * pole-ward. Every cube is oriented by a local tangent frame (east / north / outward),
 * so the cube faces tile the sphere — neat rows of squares with a smooth, round
 * silhouette, not a Cartesian-lattice staircase. Land cells are pushed
 * {@link LAND_RELIEF} cube(s) outward onto the `R + relief` shell; their side walls
 * (depth {@link THICKNESS}) close the coastal cliff, so the shell stays watertight.
 *
 * The returned mesh owns its geometry and material; dispose them when done.
 */
export function buildPlanet(opts: PlanetBuildOptions): InstancedMesh {
  const { radius: R, bevel, colorJitter } = opts;
  const water = new Color(opts.waterColor);
  const land = new Color(opts.landColor);

  const mats: Matrix4[] = [];
  const cols: Color[] = [];
  const ex = new Vector3();
  const ey = new Vector3();
  const ez = new Vector3();
  const pos = new Vector3();
  const scl = new Vector3();
  const m = new Matrix4();
  const tint = new Color();

  // Emit one cube: local x→`ex`, y→`ey`, z→`ez`, scaled by (sx,sy,sz), at `(px,py,pz)`.
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

  // Land/water by a majority vote over the cube's footprint, so the coastline doesn't
  // alias to a single sample. The latitude footprint is fixed; the longitude footprint
  // widens pole-ward, so it's passed in per row (`360 / nLon`).
  const latFootDeg = (CUBE / R) * 57.2958;
  const dirIsLand = (
    latDeg: number,
    lonDeg: number,
    lonFootDeg: number,
  ): boolean => {
    let votes = 0;
    for (const dA of [-latFootDeg / 2, 0, latFootDeg / 2]) {
      for (const dB of [-lonFootDeg / 2, 0, lonFootDeg / 2]) {
        // The equator-ward squeeze is already baked into the mask (see land-mask.ts).
        if (isLand(latDeg + dA, lonDeg + dB)) votes++;
      }
    }
    return votes >= 5;
  };

  const relief = LAND_RELIEF * CUBE;
  const nLat = Math.max(1, Math.round((Math.PI * R) / CUBE));
  const dLat = Math.PI / nLat;
  const latExtent = R * dLat * OVERLAP; // ~CUBE tall along the parallel

  for (let iLat = 0; iLat < nLat; iLat++) {
    const lat = -Math.PI / 2 + (iLat + 0.5) * dLat;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const rho = R * cosLat; // distance from the spin axis
    const latDeg = (lat * 180) / Math.PI;

    const nLon = Math.max(1, Math.round((2 * Math.PI * rho) / CUBE));
    const dLon = (2 * Math.PI) / nLon;
    const lonExtent = ((2 * Math.PI * rho) / nLon) * OVERLAP; // ~CUBE wide
    const lonFootDeg = 360 / nLon;

    for (let iLon = 0; iLon < nLon; iLon++) {
      const th = -Math.PI + (iLon + 0.5) * dLon;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      const lonDeg = (th * 180) / Math.PI;
      const isLandHere = SHOW_LAND ? dirIsLand(latDeg, lonDeg, lonFootDeg) : false;

      // Local tangent frame, outward-facing. `north` is tilted along the parallel so
      // the cube tops tile the sphere instead of standing up as vertical walls.
      ex.set(-st, 0, -ct); // east — along the parallel (longitude)
      ey.set(-sinLat * ct, cosLat, sinLat * st); // north — along the meridian (latitude)
      ez.set(cosLat * ct, sinLat, -cosLat * st); // outward radial

      // Centre the cube so its outer face lands on R (water) or R + relief (land).
      const rCenter = R + (isLandHere ? relief : 0) - THICKNESS / 2;
      pushCube(
        ez.x * rCenter, ez.y * rCenter, ez.z * rCenter,
        ex, ey, ez,
        lonExtent, latExtent, THICKNESS,
        isLandHere ? land : water,
      );
    }
  }

  const geometry = new RoundedBoxGeometry(1, 1, 1, 2, bevel);
  const material = new MeshStandardMaterial({
    roughness: opts.roughness,
    metalness: opts.metalness,
    envMapIntensity: opts.envMapIntensity,
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
