import { InstancedMesh, Vector3 } from 'three';
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
/** Cube edge length (world units) — the voxel lattice pitch. */
export declare const DEFAULT_VOXEL = 1.2;
/** Continental relief: land is raised this many voxel layers above the ocean surface. */
export declare const DEFAULT_RELIEF = 1;
/**
 * Ring-radius quantisation, as a fraction of a voxel. `1` = rings step in by a whole voxel
 * (chunky); smaller (e.g. `0.5`) lets a ring's radius track the sphere in sub-voxel steps,
 * so the curvature reads smoother without shrinking the cubes.
 */
export declare const DEFAULT_RING_STEP = 1;
/**
 * Flat polar cap half-angle, in degrees. The rings only run from the equator up to this
 * far from each pole; inside the cap the polar disk is tiled flat, so the rings never
 * collapse into a stretched singularity. `0` disables the cap (rings run to the pole).
 */
export declare const DEFAULT_POLE_CAP = 20;
/** Outward distance from sea level to a land cube's top face (where markers sit). */
export declare const LAND_TOP_OFFSET: number;
/** World edge length of one surface (land/water) cube; clouds size their voxels off this. */
export declare const LAND_CUBE = 1.2;
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
export declare function geoToSurface(latDeg: number, lonDeg: number, radius: number): {
    position: Vector3;
    normal: Vector3;
    north: Vector3;
};
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
export declare function buildPlanet(opts: PlanetBuildOptions): InstancedMesh;
