import { fireEvent, render, screen } from '@testing-library/react';

import { errorText, routesText } from '../i18n/index.ts';
import { RouteErrorToast } from './route-error-toast.tsx';

describe('RouteErrorToast', () => {
  it.each(['en', 'fr'] as const)('says no route was found, and what to try, in %s', (language) => {
    render(<RouteErrorToast language={language} error="no-routes" onDismiss={vi.fn()} />);

    const t = routesText[language];
    expect(screen.getByTestId('routes-toast')).toHaveTextContent(t.noRoutes);
    expect(screen.getByTestId('routes-toast')).toHaveTextContent(t.noRoutesHint);
  });

  it('says the service cannot be reached, and what to check', () => {
    render(<RouteErrorToast language="en" error="unreachable" onDismiss={vi.fn()} />);

    expect(screen.getByTestId('routes-toast')).toHaveTextContent(routesText.en.unreachable);
    expect(screen.getByTestId('routes-toast')).toHaveTextContent(routesText.en.unreachableHint);
  });

  it('says the service answered badly, as another case than an unreachable one', () => {
    render(<RouteErrorToast language="fr" error="failed" onDismiss={vi.fn()} />);

    expect(screen.getByTestId('routes-toast')).toHaveTextContent(routesText.fr.failed);
    expect(screen.getByTestId('routes-toast')).not.toHaveTextContent(routesText.fr.unreachable);
  });

  it('words an error code of the API', () => {
    render(<RouteErrorToast language="en" error="rate-limited" onDismiss={vi.fn()} />);

    expect(screen.getByTestId('routes-toast')).toHaveTextContent(errorText.en['rate-limited']);
  });

  describe.each(['en', 'fr'] as const)('an invalid criteria refusal, in %s', (language) => {
    const t = routesText[language];
    const toast = (invalid?: { field: 'waypoints' | 'start' | 'pace'; waypoint?: number }) => {
      render(
        <RouteErrorToast
          language={language}
          error="invalid-criteria"
          {...(invalid && { invalid })}
          onDismiss={vi.fn()}
        />,
      );
      return screen.getByTestId('routes-toast');
    };

    it('names the waypoint that is too far from a way, as numbered on the map', () => {
      expect(toast({ field: 'waypoints', waypoint: 3 })).toHaveTextContent(t.waypointTooFar(3));
    });

    it('says the start point is too far from a way', () => {
      expect(toast({ field: 'start' })).toHaveTextContent(t.startTooFar);
    });

    it('says the waypoints make too long a route when no waypoint is named', () => {
      expect(toast({ field: 'waypoints' })).toHaveTextContent(t.waypointsUnreachable);
    });

    it.each([
      ['another field', { field: 'pace' as const }],
      ['no field', undefined],
    ])('keeps the general words for %s', (_name, invalid) => {
      expect(toast(invalid)).toHaveTextContent(errorText[language]['invalid-criteria']);
    });
  });

  it('is an alert that a click drops', () => {
    const onDismiss = vi.fn();
    render(<RouteErrorToast language="en" error="unreachable" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('alert'));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
