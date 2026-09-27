import { lambert93, type Position } from '../route-generation/index.ts';
import { communeLookup, type Commune } from './communes.ts';

const ANNECY: Position = [6.1294, 45.8992];
const EPAGNY: Position = [6.0856, 45.9334];
const VALREAS: Position = [4.9913, 44.3848];
const VALREAS_EAST: Position = [5.1, 44.3848];

// A closed square ring in Lambert-93 metres, `half` metres each side of a point.
function around(point: Position, half: number): number[] {
  const [x, y] = lambert93(...point);
  return [x - half, y - half, x - half, y + half, x + half, y + half, x + half, y - half, x - half, y - half];
}

const communes: Commune[] = [
  { name: 'Annecy', rings: [around(ANNECY, 1000)] },
  { name: 'Épagny Metz-Tessy', rings: [around(EPAGNY, 1000)] },
  // Surrounds the Grillon enclave, and has a second part farther east.
  { name: 'Valréas', rings: [around(VALREAS, 5000), around(VALREAS, 2000), around(VALREAS_EAST, 1000)] },
  { name: 'Grillon', rings: [around(VALREAS, 2000)] },
];

describe('communeLookup', () => {
  const communeAt = communeLookup(communes);

  it.each([
    ['a commune', 'Annecy', ANNECY],
    ['its neighbour', 'Épagny Metz-Tessy', EPAGNY],
    ['a commune around an enclave', 'Valréas', [VALREAS[0] + 0.04, VALREAS[1]]],
    ['the enclave', 'Grillon', VALREAS],
    ['another part of a commune', 'Valréas', VALREAS_EAST],
  ] satisfies [string, string, Position][])('finds %s', (_, name, start) => {
    expect(communeAt(...start)).toBe(name);
  });

  it('finds no commune outside every polygon', () => {
    expect(communeAt(ANNECY[0], ANNECY[1] + 0.05)).toBeNull();
  });
});
