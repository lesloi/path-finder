// jsdom has no WebGL: tests swap maplibre-gl for these stand-ins, which record what the app asks
// of the map and let tests fire map events (`vi.mock('maplibre-gl', () => import('./maplibre-mock.ts'))`).
type Handler = (event: object) => void;

/** A GeoJSON source, with the last data it was given. */
export class GeoJSONSource {
  data?: unknown;
  setData(data: unknown) {
    this.data = data;
  }
}

/** Every map created since the test started, the latest last. */
export const maps: Map[] = [];
/** Every marker created since the test started. */
export const markers: Marker[] = [];

export class Map {
  /** Handlers by event type, or by `type:layer` for a layer's events. */
  handlers: Record<string, Handler[]> = {};
  controls: unknown[] = [];
  easedTo?: unknown;
  fitted?: { bounds: unknown; options: unknown };
  sources: Record<string, GeoJSONSource> = {};
  layers: { id: string }[] = [];
  canvas = {
    style: { cursor: '' },
    clientWidth: 800,
    clientHeight: 600,
    // A JPEG of the canvas, as an empty blob.
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(['snapshot'], { type: 'image/jpeg' })),
  };
  constructor() {
    maps.push(this);
  }
  on(type: string, layerOrHandler: string | Handler, handler?: Handler) {
    const [key, listener] =
      typeof layerOrHandler === 'string' ? [`${type}:${layerOrHandler}`, handler!] : [type, layerOrHandler];
    (this.handlers[key] ??= []).push(listener);
  }
  /** Fires the handlers of a map event, or of a layer's event as `fire('click', event, 'routes-hit')`. */
  once(type: string, handler: Handler) {
    const once = (event: object) => {
      this.off(type, once);
      handler(event);
    };
    this.on(type, once);
  }
  off(type: string, handler: Handler) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((candidate) => candidate !== handler);
  }
  /** A repaint renders a frame at once. */
  triggerRepaint() {
    this.fire('render');
  }
  getCenter() {
    return { lng: 6, lat: 45 };
  }
  /** One pixel per kilometre of longitude and latitude degree around the centre, to test mappings. */
  project([lng, lat]: [number, number]) {
    return { x: 400 + (lng - 6) * 1000, y: 300 - (lat - 45) * 1000 };
  }
  fire(type: string, event: object = {}, layer?: string) {
    for (const handler of this.handlers[layer ? `${type}:${layer}` : type] ?? []) handler(event);
  }
  getStyle() {
    return { layers: [{ id: 'first' }] };
  }
  getCanvas() {
    return this.canvas;
  }
  addSource(id: string) {
    this.sources[id] = new GeoJSONSource();
  }
  getSource(id: string) {
    return this.sources[id];
  }
  addLayer(layer: { id: string }) {
    this.layers.push(layer);
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted = { bounds, options };
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
