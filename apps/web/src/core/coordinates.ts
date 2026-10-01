import { commonText, type Language } from '../i18n/index.ts';

/** A longitude and a latitude, the shape the API's criteria take. */
export type Position = [number, number];

/** A position as "45.8000° N · 6.2000° E", latitude first, about 10 m apart at the last digit. */
export function formatPosition([longitude, latitude]: Position, language: Language): string {
  const { north, south, east, west } = commonText[language].hemispheres;
  const format = new Intl.NumberFormat(language, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const latitudeText = `${format.format(Math.abs(latitude))}° ${latitude < 0 ? south : north}`;
  const longitudeText = `${format.format(Math.abs(longitude))}° ${longitude < 0 ? west : east}`;
  return `${latitudeText} · ${longitudeText}`;
}

// A number with a decimal dot or comma, then maybe a degree sign and a hemisphere (O is west in French).
const COORDINATE = /(-?\d+(?:[.,]\d+)?)\s*°?\s*([NSEWO])?/giu;

/**
 * The position written in `text`: a latitude then a longitude, unless hemispheres say otherwise,
 * as `formatPosition` writes them or as maps copy them ("45.8, 6.2"). Undefined when `text` is
 * not two coordinates within their bounds.
 */
export function parsePosition(text: string): Position | undefined {
  const coordinates = [...text.replaceAll('−', '-').matchAll(COORDINATE)].map(([, number, hemisphere]) => {
    const letter = hemisphere?.toUpperCase();
    const value = Number(number.replace(',', '.'));
    return {
      value: letter === 'S' || letter === 'W' || letter === 'O' ? -Math.abs(value) : value,
      isLongitude: letter === 'E' || letter === 'W' || letter === 'O',
      isLatitude: letter === 'N' || letter === 'S',
    };
  });
  if (coordinates.length !== 2) return undefined;
  const [first, second] = coordinates;
  const [latitude, longitude] = first.isLongitude || second.isLatitude ? [second, first] : [first, second];
  if (Math.abs(latitude.value) > 90 || Math.abs(longitude.value) > 180) return undefined;
  return [longitude.value, latitude.value];
}
