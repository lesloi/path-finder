// jsdom has no WebGL: tests swap maplibre-gl for these stand-ins, which record what the app asks
// of the map and let tests fire map events (`vi.mock('maplibre-gl', () => import('./maplibre-mock.ts'))`).
type Handler = (event: object) => void;

/** Every map created since the test started, the latest last. */
export const maps: Map[] = [];
/** Every marker created since the test started. */
export const markers: Marker[] = [];

export class Map {
  handlers: Record<string, Handler[]> = {};
  controls: unknown[] = [];
  easedTo?: unknown;
  constructor() {
    maps.push(this);
  }
  on(type: string, handler: Handler) {
    (this.handlers[type] ??= []).push(handler);
  }
  fire(type: string, event: object = {}) {
    for (const handler of this.handlers[type] ?? []) handler(event);
  }
  addControl(control: unknown) {
    this.controls.push(control);
  }
  easeTo(options: unknown) {
    this.easedTo = options;
  }
  remove() {}
}

export class Marker {
  options: unknown;
  position?: unknown;
  shown = false;
  constructor(options?: unknown) {
    this.options = options;
    markers.push(this);
  }
  setLngLat(position: unknown) {
    this.position = position;
    return this;
  }
  addTo() {
    this.shown = true;
    return this;
  }
  remove() {
    this.shown = false;
  }
}

export class AttributionControl {
  options: unknown;
  constructor(options?: unknown) {
    this.options = options;
  }
}
