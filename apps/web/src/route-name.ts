export type Units = 'metric' | 'imperial';

const KM_PER_MILE = 1.609344;
const METRES_PER_FOOT = 0.3048;

/**
 * The route name, in every language: the commune of the start point when the API found one,
 * the distance, and the elevation gain when known, such as "Annecy · 12.3 km · +340 m".
 */
export function routeName(
  commune: string | null,
  { distance, elevationGain }: { distance: number; elevationGain?: number },
  units: Units,
): string {
  const metric = units === 'metric';
  const length = metric ? `${distance.toFixed(1)} km` : `${(distance / KM_PER_MILE).toFixed(1)} mi`;
  const climb =
    elevationGain === undefined
      ? []
      : [metric ? `+${Math.round(elevationGain)} m` : `+${Math.round(elevationGain / METRES_PER_FOOT)} ft`];
  return [...(commune ? [commune] : []), length, ...climb].join(' · ');
}
