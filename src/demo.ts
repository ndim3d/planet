/**
 * Demo entry. Not part of the shipped library — it mounts the widget into the
 * demo page (`index.html`) so the scene can be viewed and tested, both with
 * `npm run dev` (live) and `npm run build:demo` (static HTML build).
 */
import { PlanetWidget, type MarkerConfig } from './index';

// Country pins (approximate centroids). "Asia" is a generic pin over East Asia.
const MARKERS: MarkerConfig[] = [
  { label: 'Argentina', lat: -35, lon: -65 },
  { label: 'Egypt', lat: 26, lon: 30 },
  { label: 'Turkey', lat: 39, lon: 35 },
  { label: 'Belarus', lat: 53.7, lon: 28 },
  { label: 'Kazakhstan', lat: 48, lon: 67 },
  { label: 'Russia', lat: 62, lon: 90 },
  { label: 'Asia', lat: 34, lon: 100 },
  { label: 'Indonesia', lat: 0, lon: 114 },
];

const stage = document.getElementById('stage');
if (stage) {
  new PlanetWidget(stage, {
    background: '#0b0f1a',
    waterColor: '#2796e0',
    landColor: '#47b54b',
    radius: 20,
    rotationSpeed: 0.3,
    markers: MARKERS,
  });
}
