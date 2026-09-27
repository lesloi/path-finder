// Key settings of the route generation engine.

/**
 * How far a route may be from the criteria. `distance` also applies to the estimated
 * duration when the user asks for a target duration. Elevation gain floors are in metres.
 */
export const TOLERANCES = {
  match: { distance: 0.1, elevationGain: 0.2, elevationGainFloor: 50 },
  suggestion: { distance: 0.25, elevationGain: 0.5, elevationGainFloor: 100 },
};

/**
 * Bounds of the flat and hilly shortcuts, in metres of elevation gain per km of the route:
 * flat is at most `match`, hilly at least `match`, and `suggestion` widens each bound.
 */
export const ELEVATION_LEVELS = {
  flat: { match: 10, suggestion: 20 },
  hilly: { match: 10, suggestion: 5 },
};

/** Metres of elevation gain that count as 1 km of effort distance. */
export const CLIMB_PER_EFFORT_KM = 100;

/** Shortest distance to ask the routing engine for, in kilometres (#7 criteria bounds). */
export const MIN_TARGET_DISTANCE = 2;

export const MAX_ROUTES = 5;
/** Suggestions only fill the route set up to this size. */
export const MIN_ROUTES = 3;
/** Largest share of a route's geometry another route in the set may cover. */
export const MAX_SHARED = 0.5;

/** Side of the grid cells used to compare routes, in metres, as in the BRouter spike (#1). */
export const GRID_CELL = 25;
/**
 * Radius around the start point left out of the comparison, in metres, since every loop
 * goes through it: at most `START_RADIUS`, and a share of the target distance for short routes.
 */
export const START_RADIUS = 500;
export const START_RADIUS_SHARE = 0.1;
/** Metres a route must go before coming back to a cell counts as walking it twice. */
export const RETRACE_MIN_LOOP = 100;
