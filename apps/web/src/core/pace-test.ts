import { CLIMB_PER_EFFORT_KM } from '../contract/index.ts';
import { estimatedDuration } from './pace.ts';

describe('estimatedDuration', () => {
  it('is the distance at the pace on flat ground', () => {
    expect(estimatedDuration({ distance: 10 }, 6)).toBe(60);
  });

  it('counts the climb as effort kilometres, as the server does', () => {
    expect(estimatedDuration({ distance: 10, elevationGain: CLIMB_PER_EFFORT_KM }, 6)).toBe(66);
  });

  it('follows the pace', () => {
    expect(estimatedDuration({ distance: 10, elevationGain: 0 }, 7.5)).toBe(75);
  });
});
