import { routeName } from './route-name.ts';

const route = { distance: 12.34, elevationGain: 339.6 };

describe('routeName', () => {
  it('names a route after the commune of its start point, with its distance and elevation gain', () => {
    expect(routeName('Annecy', route, 'metric')).toBe('Annecy · 12.3 km · +340 m');
  });

  it('follows imperial units', () => {
    expect(routeName('Annecy', route, 'imperial')).toBe('Annecy · 7.7 mi · +1114 ft');
  });

  it('leaves out an unknown commune', () => {
    expect(routeName(null, route, 'metric')).toBe('12.3 km · +340 m');
  });
});
