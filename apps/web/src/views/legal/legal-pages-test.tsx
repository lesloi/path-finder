import { render, screen } from '@testing-library/react';

import { expectNamedControls } from '../../accessible-names.ts';
import type { Language } from '../../i18n/index.ts';
import { CreditsPage } from './credits-page.tsx';
import { LegalNoticePage } from './legal-notice-page.tsx';
import { PrivacyPolicyPage } from './privacy-policy-page.tsx';

const languages: Language[] = ['en', 'fr'];

describe.each(languages)('legal pages in %s', (language) => {
  it('credits OpenStreetMap and IGN, and links to the source code', () => {
    render(<CreditsPage language={language} />);

    expect(screen.getByTestId('credits-odbl')).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(screen.getByTestId('credits-page')).toHaveTextContent(/Plan IGN/);
    expect(screen.getByTestId('credits-page')).toHaveTextContent(/BD ALTI/);
    expect(screen.getByTestId('credits-licence')).toHaveAttribute(
      'href',
      'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    );
    expect(screen.getByTestId('credits-source')).toHaveAttribute('href', 'https://github.com/lesloi/path-finder');
    expect(screen.getByTestId('credits-agpl')).toBeInTheDocument();
  });

  it.each([
    ['credits', <CreditsPage key="credits" language={language} />],
    ['privacy policy', <PrivacyPolicyPage key="privacy" language={language} />],
    ['legal notice', <LegalNoticePage key="notice" language={language} />],
  ])('names every link of the %s', (_, page) => {
    const { container } = render(page);

    expectNamedControls(container);
  });

  it('names IGN, Scaleway, and the rate-limit hash in the privacy policy', () => {
    render(<PrivacyPolicyPage language={language} />);

    expect(screen.getByTestId('privacy-policy-page')).toHaveTextContent(/IGN/);
    expect(screen.getByTestId('privacy-policy-page')).toHaveTextContent(/Scaleway/);
    expect(screen.getByTestId('privacy-policy-page')).toHaveTextContent(/hash/);
  });

  it('names the publisher and the host in the legal notice', () => {
    render(<LegalNoticePage language={language} />);

    expect(screen.getByTestId('legal-notice-page')).toHaveTextContent(/lesloi/);
    expect(screen.getByTestId('legal-notice-page')).toHaveTextContent(/Scaleway SAS/);
  });
});
