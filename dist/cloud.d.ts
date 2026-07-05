import { InstancedMesh } from 'three';
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
export declare const CLOUD_DEFAULTS: Required<BuildCloudsOptions>;
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
export declare function buildClouds(radius: number, options?: BuildCloudsOptions): InstancedMesh;
