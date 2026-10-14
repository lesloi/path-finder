import { render, screen } from '@testing-library/react';

import { routesText } from '../i18n/index.ts';
import { SearchingPanel } from './searching-panel.tsx';

describe('SearchingPanel', () => {
  it.each(['en', 'fr'] as const)('tells that routes are being found in %s', (language) => {
    render(<SearchingPanel language={language} />);

    expect(screen.getByTestId('routes-loading')).toHaveTextContent(routesText[language].finding);
  });

  it('is a status that assistive technology announces', () => {
    render(<SearchingPanel language="en" />);

    expect(screen.getByRole('status')).toBe(screen.getByTestId('routes-loading'));
  });

  it('hides the placeholder of the results from assistive technology', () => {
    render(<SearchingPanel language="en" />);

    const placeholder = screen.getByTestId('routes-placeholder');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('routes-loading')).not.toContainElement(placeholder);
  });
});
