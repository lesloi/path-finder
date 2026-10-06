/** The map background the user picks: the Plan IGN, its plain variant, or the aerial photography. */
export type Basemap = 'plan' | 'minimal' | 'aerial';

/** The basemaps in the order the settings list them. */
export const BASEMAPS: Basemap[] = ['plan', 'minimal', 'aerial'];

/** The basemap before the user picks one. */
export const DEFAULT_BASEMAP: Basemap = 'plan';
