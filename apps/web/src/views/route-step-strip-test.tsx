import { render, screen, within } from '@testing-library/react';

import { waypointPoiKey, type Position, type Route, type WaypointPois } from '../core/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';
import { RouteStepStrip } from './route-step-strip.tsx';

const METRES_PER_DEGREE = 111_195;
// 1.2 km north: climbs from 450 m to 600 m at the third point, then back down to 480 m.
const heights = [450, 520, 600, 540, 480];
const route: Route = {
  geometry: heights.map((height, k) => [6.1294, 45.8992 + (k * 300) / METRES_PER_DEGREE, height]),
  distance: 1.2,
  elevationGain: 150,
  elevationLoss: 120,
  estimatedDuration: 20,
  kind: 'match',
  unpavedShare: 0,
  surfaces: [{ surface: 'paved', from: 0, to: 1.2 }],
  technical: false,
};
const at = (k: number): Position => [route.geometry[k][0], route.geometry[k][1]];

function strip(props: Partial<Parameters<typeof RouteStepStrip>[0]> = {}, language: 'en' | 'fr' = 'en') {
  return render(<RouteStepStrip route={route} language={language} pace={5.5} waypoints={undefined} {...props} />);
}

describe('RouteStepStrip', () => {
  it('has a card for the start, the highest point and the finish, in the order of the route', () => {
    strip();

    expect(screen.getAllByTestId('route-step-name').map((name) => name.textContent)).toEqual([
      routesText.en.timelineStart,
      routesText.en.timelineSummit,
      routesText.en.timelineFinish,
    ]);
  });

  it('gives each card its altitude, and its distance and time except the start’s', () => {
    strip();

    const [start, summit] = screen.getAllByTestId('route-step');
    expect(start).toHaveTextContent('450 m');
    expect(start).not.toHaveTextContent('km');
    expect(summit).toHaveTextContent('0.6 km · 16 min');
    expect(summit).toHaveTextContent('600 m');
  });

  it('gives the figures of each leg on the card that ends it, and none for the start', () => {
    strip();

    const [start, summit] = screen.getAllByTestId('route-step');
    expect(within(start!).queryByTestId('route-step-leg')).not.toBeInTheDocument();
    expect(within(summit!).getByTestId('route-step-leg')).toHaveTextContent('0.6 km');
  });

  it('puts the climb and the descent of a leg on their own line, without the dot that joins them to the duration', () => {
    strip();

    const [, summit] = screen.getAllByTestId('route-step');
    const leg = within(summit!).getByTestId('route-step-leg');
    expect(leg).toHaveTextContent('0.6 km · 16 min');
    expect(leg).toHaveTextContent('150 m');
    expect(leg).not.toHaveTextContent('16 min ·');
  });

  it('names a waypoint by its point of interest, or by its number', () => {
    const waypoints = [at(1)];
    const pois: WaypointPois = {
      [waypointPoiKey(waypoints[0]!)]: { category: 'water', seasonal: false, name: 'Spring' },
    };
    const { unmount } = strip({ waypoints, waypointPois: pois });
    expect(screen.getAllByTestId('route-step-name')[1]).toHaveTextContent('Spring');
    unmount();

    strip({ waypoints });

    expect(screen.getAllByTestId('route-step-name')[1]).toHaveTextContent(criteriaText.en.waypointName(1));
  });

  it('draws a link from each card to its place on the profile', () => {
    strip();

    expect(screen.getByTestId('route-step-links').querySelectorAll('path')).toHaveLength(3);
  });

  describe('placement of the cards', () => {
    // jsdom has no layout: the list is 600 px wide, and its cards 100 px wide, one every 200 px.
    const layout = (element: HTMLElement) => {
      const cards = [...(element.parentElement?.children ?? [])];
      return { isList: element.dataset.testid === 'route-steps', index: cards.indexOf(element) };
    };
    const defineLayout = (property: 'clientWidth' | 'offsetLeft' | 'offsetWidth', value: (e: HTMLElement) => number) =>
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get(this: HTMLElement) {
          return value(this);
        },
      });
    beforeEach(() => {
      defineLayout('clientWidth', (e) => (layout(e).isList ? 600 : 0));
      defineLayout('offsetLeft', (e) => layout(e).index * 200);
      defineLayout('offsetWidth', () => 100);
    });
    afterEach(() => {
      for (const property of ['clientWidth', 'offsetLeft', 'offsetWidth'])
        Reflect.deleteProperty(HTMLElement.prototype, property);
    });

    it('joins each link to the centre of its card', () => {
      strip();

      const links = screen.getByTestId('route-step-links').querySelectorAll('path');
      // The centres of cards at 0, 200 and 400 px of 600 px, as percentages, ending 4 px above the card.
      expect(links[1]).toHaveAttribute('d', expect.stringMatching(/L41\.7,20$/));
      expect(links[2]).toHaveAttribute('d', expect.stringMatching(/L75,20$/));
    });

    it('centres a leg in the gap before its card, and keeps it clear of the next leg', () => {
      strip();

      const [summit, finish] = screen.getAllByTestId('route-step-leg');
      // The gaps are 100 px wide, so the leg is 50 px left of its card, and the legs 200 px apart.
      expect(summit).toHaveStyle({ left: '-50px', maxWidth: '196px' });
      expect(finish).toHaveStyle({ left: '-50px', maxWidth: '196px' });
    });

    it('watches every card, as their widths change with the language and the names', () => {
      const observed: Element[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe(element: Element) {
            observed.push(element);
          }
          disconnect() {}
        },
      );

      strip();

      expect(observed).toHaveLength(1 + screen.getAllByTestId('route-step').length);
    });
  });

  it('can be laid out without links, for a route with no profile to join', () => {
    strip({ linked: false } as Partial<Parameters<typeof RouteStepStrip>[0]>);

    expect(screen.queryByTestId('route-step-links')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('route-step').length).toBeGreaterThan(0);
  });

  it('is labelled as the timeline of the route, in the language of the settings', () => {
    strip({}, 'fr');

    expect(screen.getByTestId('route-steps')).toHaveAccessibleName(routesText.fr.timeline);
  });

  it('renders nothing for a route without a geometry', () => {
    const { container } = strip({ route: { ...route, geometry: [] } });

    expect(container).toBeEmptyDOMElement();
  });
});
