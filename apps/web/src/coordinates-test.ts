import { formatPosition, parsePosition } from './coordinates.ts';

describe('formatPosition', () => {
  it.each([
    ['en', [6.2, 45.8], '45.8000° N · 6.2000° E'],
    ['en', [-1.5, -33.9], '33.9000° S · 1.5000° W'],
    ['fr', [-1.5, 47.2], '47,2000° N · 1,5000° O'],
  ] as const)('writes a position in %s', (language, position, text) => {
    expect(formatPosition([...position], language)).toBe(text);
  });
});

describe('parsePosition', () => {
  it.each([
    ['its own English format', '45.8000° N · 6.2000° E', [6.2, 45.8]],
    ['its own French format', '47,2000° N · 1,5000° O', [-1.5, 47.2]],
    ['a latitude and a longitude, as maps copy them', '45.8, 6.2', [6.2, 45.8]],
    ['decimal commas', '45,8, 6,2', [6.2, 45.8]],
    ['spaces only', '45.8 6.2', [6.2, 45.8]],
    ['negative numbers', '-33.9, 18.4', [18.4, -33.9]],
    ['a Unicode minus sign', '−33.9, 18.4', [18.4, -33.9]],
    ['hemispheres', '33.9 S 18.4 E', [18.4, -33.9]],
    ['the longitude first, when hemispheres say so', '6.2 E, 45.8 N', [6.2, 45.8]],
    ['lower-case hemispheres', '45.8 n 6.2 w', [-6.2, 45.8]],
  ])('reads %s', (_, text, position) => {
    expect(parsePosition(text)).toEqual(position);
  });

  it.each([
    ['nothing', ''],
    ['a place name', 'Paris'],
    ['a single number', '45.8'],
    ['three numbers', '45.8, 6.2, 100'],
    ['a latitude beyond 90°', '95, 6.2'],
    ['a longitude beyond 180°', '45.8, 200'],
  ])('rejects %s', (_, text) => {
    expect(parsePosition(text)).toBeUndefined();
  });
});
