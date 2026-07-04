/**
 * Public entry point of the planet widget.
 *
 * Everything that should be importable by a consumer is re-exported from here.
 * The build turns this into a single self-contained ESM file (`dist/planet-widget.js`)
 * plus type declarations (`dist/index.d.ts` + `dist/widget.d.ts`).
 */
export { PlanetWidget } from './widget';
export type {
  DirectionalLightOptions,
  PlanetCloudOptions,
  PlanetLightingOptions,
  PlanetMaterialOptions,
  PlanetTerrainOptions,
  PlanetWidgetOptions,
} from './widget';
export type { StarfieldOptions } from './starfield';
export type { MarkerConfig, MarkerOptions } from './marker';
