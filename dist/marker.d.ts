import { InstancedMesh, Object3D, Vector3 } from 'three';
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
export declare class Marker {
    readonly object: InstancedMesh;
    private readonly material;
    constructor(options?: MarkerOptions);
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
    placeAt(latDeg: number, lonDeg: number, radius: number): void;
    /**
     * Fade the pin out and hide it once the planet's spin carries it past the globe's
     * horizon. Call once per frame, before rendering.
     *
     * @param cameraWorldPos - Camera position in world space.
     * @param planet - The planet the pin is parented to (its center anchors the horizon).
     */
    update(cameraWorldPos: Vector3, planet: Object3D): void;
    /** Dispose the pin's geometry and material. */
    dispose(): void;
}
