/**
 * Demo entry. Not part of the shipped library — it mounts the widget into the
 * demo page (`index.html`) so the scene can be viewed and tested, both with
 * `npm run dev` (live) and `npm run build:demo` (static HTML build).
 */
import { PlanetWidget } from './index';

const stage = document.getElementById('stage');
if (stage) {
  new PlanetWidget(stage, {
    background: '#0b0f1a',
    waterColor: '#2796e0',
    landColor: '#47b54b',
    radius: 20,
    rotationSpeed: 0.3,
  });
}
