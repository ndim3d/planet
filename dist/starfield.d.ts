import { CanvasTexture } from 'three';
/** Procedural pixel-star background tunables. All fields optional. */
export interface StarfieldOptions {
    /** Number of stars scattered over the field. Defaults to `22`. */
    count?: number;
    /** Star colour (any CSS / hex color). Defaults to `#ffffff`. */
    color?: string;
    /** Seed for the (deterministic) scatter, so the field is stable across reloads. Defaults to `7`. */
    seed?: number;
}
/**
 * Build a **static pixel-star** background as a {@link CanvasTexture}, ready to drop into
 * `scene.background`. Crisp white pixel stars (dots, four-point sparkles and short diagonal
 * streaks) each with a soft glow, scattered **evenly** (blue-noise, so no clumps or bald
 * gaps) over the given base colour. Fully procedural — no image asset — and deterministic
 * for a given `seed`.
 *
 * The texture uses nearest-neighbour magnification so the star pixels stay blocky. Dispose
 * it when you swap it out.
 */
export declare function buildStarfield(background: string, options?: StarfieldOptions): CanvasTexture;
