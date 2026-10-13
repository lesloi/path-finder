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
  /** How many times the map was asked to fit bounds. */
  fits = 0;
  sources: Record<string, GeoJSONSource> = {};
  layers: { id: string }[] = [];
  canvas = {
    style: { cursor: '' },
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    clientWidth: 800,
    clientHeight: 600,
    // A JPEG of the canvas, as an empty blob.
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(['snapshot'], { type: 'image/jpeg' })),
  };
  /** What the map was created with, and every style it was given since, the latest last. */
  options: { style?: unknown; locale?: unknown };
  styles: { style: unknown; options: unknown }[] = [];
  constructor(options: { style?: unknown; locale?: unknown } = {}) {
    this.options = options;
    maps.push(this);
  }
  /** Like the real map, a new style drops the sources and layers added to the old one. */
  setStyle(style: unknown, options?: unknown) {
    this.styles.push({ style, options });
    this.sources = {};
    this.layers = [];
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
  bearing = 0;
  /** Turns the map and fires `move`, as a gesture would. */
  rotateTo(bearing: number) {
    this.bearing = bearing;
    this.fire('move');
  }
  getBearing() {
    return this.bearing;
  }
  jumpTo({ bearing }: { bearing?: number }) {
    if (bearing !== undefined) this.rotateTo(bearing);
  }
  resetNorth() {
    this.rotateTo(0);
  }
  zoom = 5;
  /** West, south, east and north of the view, which tests move to ask for other tiles. */
  view: [number, number, number, number] = [6, 45, 6.1, 45.1];
  getZoom() {
    return this.zoom;
  }
  getBounds() {
    const [west, south, east, north] = this.view;
    return {
      toArray: () => [
        [west, south],
        [east, north],
      ],
    };
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
  // The toggle of the compact attribution, which MapLibre's control draws: a real element to read its names from.
  container = document.createElement('div');
  getContainer() {
    return this.container;
  }
  images: Record<string, unknown> = {};
  addImage(id: string, image: unknown) {
    this.images[id] = image;
  }
  addSource(id: string) {
    this.sources[id] = new GeoJSONSource();
  }
  getSource(id: string) {
    return this.sources[id];
  }
  addLayer(layer: { id: string }, beforeId?: string) {
    const before = this.layers.findIndex(({ id }) => id === beforeId);
    if (before >= 0) this.layers.splice(before, 0, layer);
    else this.layers.push(layer);
  }
  /** What the map finds under a point: tests put a route there to tell a click on it from one on the background. */
  rendered: unknown[] = [];
  queryRenderedFeatures() {
    return this.rendered;
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted = { bounds, options };
    this.fits++;
  }
  addControl(control: unknown) {
    this.controls.push(control);
    if (control instanceof AttributionControl) control.mountIn(this.container);
  }
  easeTo(options: unknown) {
    this.easedTo = options;
  }
  remove() {}
}

/** Every popup created since the test started. */
export const popups: Popup[] = [];

export class Popup {
  options: unknown;
  position?: unknown;
  text?: string;
  html?: string;
  shown = false;
  constructor(options?: unknown) {
    this.options = options;
    popups.push(this);
  }
  setLngLat(position: unknown) {
    this.position = position;
    return this;
  }
  setText(text: string) {
    this.text = text;
    return this;
  }
  setHTML(html: string) {
    this.html = html;
    return this;
  }
  addTo() {
    this.shown = true;
    return this;
  }
  remove() {
    this.shown = false;
    return this;
  }
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
  /** As MapLibre's compact control does once added: open, with a button that toggles it. */
  mountIn(container: HTMLElement) {
    const element = container.appendChild(document.createElement('details'));
    element.className = 'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show';
    const button = element.appendChild(document.createElement('button'));
    button.className = 'maplibregl-ctrl-attrib-button';
    button.addEventListener('click', () => element.classList.toggle('maplibregl-compact-show'));
  }
}

export class ScaleControl {
  options: { unit?: string };
  constructor(options: { unit?: string } = {}) {
    this.options = options;
  }
}

/** The app points maplibre at its worker before the first map: nothing to do without one. */
export function setWorkerUrl() {}
