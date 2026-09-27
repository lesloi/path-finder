import { render, screen } from '@testing-library/react';

import type { Language } from '../language.ts';
import { CreditsPage } from './credits-page.tsx';
import { LegalNoticePage } from './legal-notice-page.tsx';
import { PrivacyPolicyPage } from './privacy-policy-page.tsx';

const languages: Language[] = ['en', 'fr'];

describe.each(languages)('legal pages in %s', (language) => {
  it('credits OpenStreetMap and IGN, and links to the source code', () => {
    render(<CreditsPage language={language} />);

    expect(screen.getByRole('link', { name: 'ODbL' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    expect(screen.getByText(/Plan IGN/)).toBeInTheDocument();
    expect(screen.getByText(/BD ALTI/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Licence Ouverte' })).toHaveAttribute(
      'href',
      'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    );
    expect(screen.getByRole('link', { name: 'github.com/lesloi/path-finder' })).toHaveAttribute(
      'href',
      'https://github.com/lesloi/path-finder',
    );
    expect(screen.getByRole('link', { name: 'AGPL-3.0-or-later' })).toBeInTheDocument();
  });

  it('names IGN, Scaleway, and the rate-limit hash in the privacy policy', () => {
    render(<PrivacyPolicyPage language={language} />);

    expect(screen.getAllByText(/IGN/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scaleway/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/hash/).length).toBeGreaterThan(0);
  });

  it('names the publisher and the host in the legal notice', () => {
    render(<LegalNoticePage language={language} />);

    expect(screen.getAllByText(/lesloi/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Scaleway SAS/)).toBeInTheDocument();
  });
});
