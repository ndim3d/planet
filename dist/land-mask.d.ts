/**
 * Equirectangular land mask for a cartoon Earth-like planet (480×240, ~0.75° cells).
 *
 * Each character is one cell: `#` = land, `.` = water.
 * Row 0 is the north pole band (+90° lat), the last row is the south pole (−90°).
 * Column 0 is lon −180°, the last column is lon +180°.
 *
 * Generated from real coastlines (Natural Earth 50m land) by `scripts/land-mask.mjs`:
 * supersampled coverage rasterization, tiny islands removed, Antarctica dropped. The
 * grid is intentionally *finer* than a base voxel — the planet renders coastal cells at
 * half a voxel (a sub-voxel coastline; see planet.ts), so the mask must carry sub-voxel
 * coastline detail (Italy, the Adriatic, the Aegean) for those half-cubes to key off.
 *
 * The {@link LAT_STRETCH} squeeze (continents pulled toward the equator, ocean caps
 * at the poles) is **already baked into this `MAP`**, so the runtime reads it directly
 * with no per-sample latitude scaling. The stretch *value* is exported because it is
 * also the latitude transform for placing things at real `[lng, lat]` — geography and
 * markers must use this one constant or they drift apart. Both the rows below and that
 * value are emitted together by the generator; regenerate with
 * `node scripts/land-mask.mjs --ts` and paste the export + array below.
 */
export declare const LAT_STRETCH = 1.15;
/**
 * Whether the given geographic point is land.
 *
 * @param latDeg - Latitude in degrees, +90 (north) … −90 (south).
 * @param lonDeg - Longitude in degrees, −180 … +180.
 */
export declare function isLand(latDeg: number, lonDeg: number): boolean;
