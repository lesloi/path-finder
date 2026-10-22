// Kilometres between two positions, on a local equirectangular projection: close enough along a route.
export function kmBetween([lonA, latA]: number[], [lonB, latB]: number[]): number {
  const cos = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return Math.hypot((lonB - lonA) * cos, latB - latA) * 111.195;
}

// Kilometres from the start to each point.
export function distancesAlong(geometry: number[][]): number[] {
  const distances = [0];
  for (let k = 1; k < geometry.length; k++) distances.push(distances[k - 1] + kmBetween(geometry[k - 1], geometry[k]));
  return distances;
}
