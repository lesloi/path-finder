import { createServer } from 'node:http';

// A stand-in for BRouter in end-to-end tests (`pnpm test:e2e`): it answers a round-trip request with a
// circle through the start point, as long as five times the radius asked for (`LOOP_PER_RADIUS`) and
// leaning towards the heading, so each heading gives a different loop and the route set holds several.
const PORT = Number(process.env.FAKE_BROUTER_PORT ?? 17_778);
const METRES_PER_DEGREE = 111_195;
const LOOP_PER_RADIUS = 5;
const POINTS = 48;

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/brouter') {
    // The health check that tells Playwright the server is up.
    response.end('ok');
    return;
  }
  const [lon, lat] = url.searchParams.get('lonlats')!.split(',').map(Number);
  const length = Number(url.searchParams.get('roundTripDistance')) * LOOP_PER_RADIUS;
  const heading = (Number(url.searchParams.get('direction')) * Math.PI) / 180;
  const radius = length / (2 * Math.PI);
  const cos = Math.cos((lat * Math.PI) / 180);
  // The circle's centre lies `radius` from the start, towards the heading.
  const [centreX, centreY] = [radius * Math.sin(heading), radius * Math.cos(heading)];
  const coordinates = Array.from({ length: POINTS + 1 }, (_, k) => {
    const angle = heading + Math.PI + (2 * Math.PI * k) / POINTS;
    const [x, y] = [centreX + radius * Math.sin(angle), centreY + radius * Math.cos(angle)];
    return [lon + x / METRES_PER_DEGREE / cos, lat + y / METRES_PER_DEGREE];
  });
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      features: [
        {
          geometry: { coordinates },
          properties: {
            'track-length': String(length),
            // A table: the first row names the columns. Half the loop is paved, half is not.
            messages: [
              [
                'Longitude',
                'Latitude',
                'Elevation',
                'Distance',
                'CostPerKm',
                'ElevCost',
                'TurnCost',
                'NodeCost',
                'InitialCost',
                'WayTags',
              ],
              ['0', '0', '0', String(length / 2), '0', '0', '0', '0', '0', 'highway=residential surface=asphalt'],
              ['0', '0', '0', String(length / 2), '0', '0', '0', '0', '0', 'highway=track surface=gravel'],
            ],
          },
        },
      ],
    }),
  );
}).listen(PORT, '127.0.0.1');
