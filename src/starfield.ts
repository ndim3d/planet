import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';

/** Procedural pixel-star background tunables. All fields optional. */
export interface StarfieldOptions {
  /** Number of stars scattered over the field. Defaults to `22`. */
  count?: number;
  /** Star colour (any CSS / hex color). Defaults to `#ffffff`. */
  color?: string;
  /** Seed for the (deterministic) scatter, so the field is stable across reloads. Defaults to `7`. */
  seed?: number;
}

const DEFAULTS: Required<StarfieldOptions> = {
  count: 22,
  color: '#ffffff',
  seed: 7,
};

// Small deterministic PRNG (mulberry32) so a given seed always yields the same field.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
export function buildStarfield(background: string, options: StarfieldOptions = {}): CanvasTexture {
  const { count, color, seed } = { ...DEFAULTS, ...options };

  const W = 1024;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  const rnd = mulberry32(seed);
  const px = Math.round(W / 96); // one star "pixel" block

  // Soft round glow behind a star so the crisp pixels read as points of light.
  const glow = (cx: number, cy: number, r: number, a: number): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const block = (bx: number, by: number): void => ctx.fillRect(bx, by, px, px);

  // Blue-noise scatter: reject a candidate that lands too close to an already-placed star, so
  // the field spreads evenly instead of clumping into dense patches and bald gaps the way pure
  // uniform random does. The separation floor scales with the field's density (roughly the
  // even-grid spacing), and a rejected star falls back to its first candidate so a dense field
  // still fits. Positions are laid out first, then drawn, but both stay deterministic in seed.
  const margin = 3 * px;
  const minSep2 = 0.6 * ((W * H) / count); // squared spacing floor between star centres
  const stars: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    let best: { x: number; y: number } | null = null;
    for (let tries = 0; tries < 32; tries++) {
      // Snap to the pixel grid so the blocks line up crisply.
      const x = Math.round((rnd() * (W - 2 * margin) + margin) / px) * px;
      const y = Math.round((rnd() * (H - 2 * margin) + margin) / px) * px;
      if (!best) best = { x, y }; // fall back to the first candidate if none clears
      if (stars.every((s) => (s.x - x) ** 2 + (s.y - y) ** 2 >= minSep2)) {
        best = { x, y };
        break;
      }
    }
    stars.push(best as { x: number; y: number });
  }

  for (const { x, y } of stars) {
    const kind = rnd();
    const big = rnd() < 0.22; // a few brighter, larger sparkles
    const cx = x + px / 2;
    const cy = y + px / 2;

    glow(cx, cy, px * (big ? 4.5 : 2.4), big ? 0.55 : 0.35);
    ctx.fillStyle = color;

    if (kind < 0.42) {
      // single dot
      block(x, y);
      if (big) { block(x + px, y); block(x, y + px); block(x + px, y + px); }
    } else if (kind < 0.78) {
      // four-point sparkle: a plus, longer arms when big
      block(x, y);
      block(x, y - px); block(x, y + px);
      block(x - px, y); block(x + px, y);
      if (big) { block(x, y - 2 * px); block(x, y + 2 * px); block(x - 2 * px, y); block(x + 2 * px, y); }
    } else {
      // short diagonal streak (stair-stepped pixels)
      block(x, y);
      block(x + px, y + px);
      if (rnd() < 0.5) block(x + 2 * px, y + 2 * px);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
