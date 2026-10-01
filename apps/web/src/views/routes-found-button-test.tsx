import { fireEvent, render, screen } from '@testing-library/react';

import { routesText } from '../i18n/index.ts';
import { RoutesFoundButton } from './routes-found-button.tsx';

describe('RoutesFoundButton', () => {
  it.each(['en', 'fr'] as const)('says how many routes were found in %s', (language) => {
    render(<RoutesFoundButton language={language} count={3} onClick={vi.fn()} />);

    const t = routesText[language];
    expect(screen.getByTestId('criteria-routes')).toHaveTextContent(t.routeCount(3));
    expect(screen.getByTestId('criteria-routes')).toHaveAccessibleName(t.showRoutes(3));
  });

  it('names a single route found', () => {
    render(<RoutesFoundButton language="en" count={1} onClick={vi.fn()} />);

    expect(screen.getByTestId('criteria-routes')).toHaveAccessibleName(routesText.en.showRoutes(1));
  });

  it('shows the routes on a click', () => {
    const onClick = vi.fn();
    render(<RoutesFoundButton language="en" count={2} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('criteria-routes'));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
