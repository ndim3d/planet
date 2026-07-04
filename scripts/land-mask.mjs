/**
 * Regenerate the equirectangular land mask in `src/land-mask.ts` from real
 * coastlines (Natural Earth 50m land — the "medium scale" dataset; its finer
 * coastlines resolve peninsulas and seas — Italy, the Adriatic — that the 110m
 * dataset smears away at this grid).
 *
 * The grid is deliberately finer than a base voxel: the planet renders coastal
 * cells at half a voxel (a sub-voxel coastline, see planet.ts), so the mask must
 * carry sub-voxel coastline detail for those half-cubes to key off.
 *
 *   1. COLS×ROWS grid (~0.75° cells), finer than the ~1.9° base voxel.
 *   2. Each cell is supersampled (SUB×SUB points); it's land if the covered
 *      fraction ≥ COVERAGE_THRESHOLD — stable coastlines, no single-point specks.
 *   3. LAT_STRETCH is baked in here: the row for `planetLat` samples geography at
 *      `planetLat × LAT_STRETCH`, so the mask ships already compressed toward the
 *      equator (smooth ocean caps at the poles) and the runtime needs no stretch.
 *   4. Tiny islands (connected components < MIN_ISLAND_CELLS) are removed.
 *   5. Antarctica is dropped (geography south of ANTARCTICA_LAT forced to water).
 *
 *   node scripts/land-mask.mjs [path-to-ne_110m_land.geojson] [--ts]
 *
 * `--ts` prints `export const LAT_STRETCH` + the `string[]` array to paste into
 * src/land-mask.ts. The GeoJSON is only needed at authoring time — the baked mask
 * (and the stretch value next to it) is what ships. The value emitted here is the
 * single source of truth: the runtime coordinate helper reads the same constant,
 * so the mask and marker placement can never disagree.
 */
import { readFile } from 'node:fs/promises';

const COLS = 480; // 0.75° per cell in longitude — finer than a voxel, feeds the sub-voxel coast
const ROWS = 240; //  0.75° per cell in latitude
const SUB = 4; // supersample grid per cell (SUB×SUB points)
const COVERAGE_THRESHOLD = 0.38; // cell is land if ≥ this fraction of points are land
const MIN_ISLAND_CELLS = 4; // drop land blobs smaller than this many cells (keeps Sicily/Crete)
const LAT_STRETCH = 1.15; // continents pulled toward the equator (>1); baked in here
const ANTARCTICA_LAT = -60; // everything south of this is forced to water
const SRC_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';

const args = process.argv.slice(2);
const emitTs = args.includes('--ts');
const pathArg = args.find((a) => !a.startsWith('--'));

async function loadGeoJson() {
  if (pathArg) return JSON.parse(await readFile(pathArg, 'utf8'));
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return res.json();
}

/** Flatten features into polygons, each `{ bbox, rings }`, rings = [[lon,lat],…]. */
function collectPolygons(geo) {
  const polys = [];
  const addPolygon = (rings) => {
    let minLon = 180,
      minLat = 90,
      maxLon = -180,
      maxLat = -90;
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    polys.push({ bbox: [minLon, minLat, maxLon, maxLat], rings });
  };
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') addPolygon(g.coordinates);
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) addPolygon(p);
  }
  return polys;
}

/** Even-odd ray cast across all rings of a polygon (handles holes correctly). */
function pointInPolygon(lon, lat, poly) {
  const [minLon, minLat, maxLon, maxLat] = poly.bbox;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
  let inside = false;
  for (const ring of poly.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      if (yi > lat !== yj > lat) {
        const xCross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (lon < xCross) inside = !inside;
      }
    }
  }
  return inside;
}

/** Is a single geographic point land? (Antarctica and the stretch caps excluded.) */
function pointIsLand(lon, geoLat, polys) {
  if (geoLat < -90 || geoLat > 90) return false; // beyond the stretched poles → ocean cap
  if (geoLat < ANTARCTICA_LAT) return false; // Antarctica dropped
  for (const poly of polys) {
    if (pointInPolygon(lon, geoLat, poly)) return true;
  }
  return false;
}

/**
 * Rasterize to a COLS×ROWS grid. Rows are indexed by *planetLat*; each cell is
 * supersampled and marked land by coverage fraction. The stretch is applied per
 * sub-point: planetLat → geoLat = planetLat × LAT_STRETCH.
 */
function rasterize(polys) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    for (let c = 0; c < COLS; c++) {
      let hits = 0;
      for (let sr = 0; sr < SUB; sr++) {
        const planetLat = 90 - (r + (sr + 0.5) / SUB) * (180 / ROWS);
        const geoLat = planetLat * LAT_STRETCH;
        for (let sc = 0; sc < SUB; sc++) {
          const lon = -180 + (c + (sc + 0.5) / SUB) * (360 / COLS);
          if (pointIsLand(lon, geoLat, polys)) hits++;
        }
      }
      line += hits / (SUB * SUB) >= COVERAGE_THRESHOLD ? '#' : '.';
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Remove land blobs smaller than MIN_ISLAND_CELLS. Flood-fills connected
 * components with 8-connectivity, wrapping in longitude (col 0 abuts col COLS−1)
 * so islands straddling the antimeridian stay whole.
 */
function dropSmallIslands(rows) {
  const grid = rows.map((r) => Array.from(r, (ch) => ch === '#'));
  const seen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const neighbors = [
    [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!grid[r][c] || seen[r][c]) continue;
      const comp = [];
      const stack = [[r, c]];
      seen[r][c] = true;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        comp.push([cr, cc]);
        for (const [dr, dc] of neighbors) {
          const nr = cr + dr;
          if (nr < 0 || nr >= ROWS) continue;
          const nc = (cc + dc + COLS) % COLS; // wrap longitude
          if (grid[nr][nc] && !seen[nr][nc]) {
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      if (comp.length < MIN_ISLAND_CELLS) {
        for (const [cr, cc] of comp) grid[cr][cc] = false;
      }
    }
  }
  return grid.map((row) => row.map((b) => (b ? '#' : '.')).join(''));
}

/** Sample the finished mask like the runtime does (nearest cell). */
function isLand(rows, latDeg, lonDeg) {
  const u = (lonDeg + 180) / 360;
  const v = (90 - latDeg) / 180;
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)));
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor(v * ROWS)));
  return rows[row][col] === '#';
}

/** Orthographic ASCII globe centered at a longitude, to eyeball recognizability. */
function previewOrtho(rows, lon0, size = 40) {
  const out = [];
  for (let yy = 0; yy < size; yy++) {
    const y = 1 - (2 * (yy + 0.5)) / size; // +1 north … −1 south
    let line = '';
    for (let xx = 0; xx < size * 2; xx++) {
      const x = ((xx + 0.5) / (size * 2)) * 2 - 1; // −1 … +1 (aspect ×2 for chars)
      if (x * x + y * y > 1) {
        line += ' ';
        continue;
      }
      const lat = Math.asin(y) * (180 / Math.PI);
      const dlon =
        Math.asin(Math.max(-1, Math.min(1, x / Math.cos((lat * Math.PI) / 180)))) *
        (180 / Math.PI);
      const lon = lon0 + dlon;
      line += isLand(rows, lat, ((lon + 540) % 360) - 180) ? '#' : '.';
    }
    out.push(line);
  }
  return out.join('\n');
}

const geo = await loadGeoJson();
const polys = collectPolygons(geo);
const rows = dropSmallIslands(rasterize(polys));

const landCells = rows.reduce((n, r) => n + (r.match(/#/g)?.length ?? 0), 0);
process.stderr.write(
  `polygons: ${polys.length}  grid: ${COLS}×${ROWS}  stretch: ${LAT_STRETCH}  ` +
    `land: ${((100 * landCells) / (COLS * ROWS)).toFixed(1)}%\n`,
);
process.stderr.write('\n— centered on Africa/Europe (lon 20°) —\n');
process.stderr.write(previewOrtho(rows, 20) + '\n');
process.stderr.write('\n— centered on Americas (lon −90°) —\n');
process.stderr.write(previewOrtho(rows, -90) + '\n');
process.stderr.write('\n— centered on Asia/Pacific (lon 120°) —\n');
process.stderr.write(previewOrtho(rows, 120) + '\n');

if (emitTs) {
  // Emit the two generated pieces: the stretch constant (single source of truth,
  // read by both the mask and the runtime coordinate helper) and the MAP array.
  process.stdout.write(`export const LAT_STRETCH = ${LAT_STRETCH};\n\n`);
  const body = rows.map((r) => `  '${r}',`).join('\n');
  process.stdout.write(`const MAP: readonly string[] = [\n${body}\n];\n`);
}
