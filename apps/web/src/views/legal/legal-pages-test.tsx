import { render, screen } from '@testing-library/react';

import { LEAD } from '../../components/index.ts';
import { expectNamedControls } from '../../accessible-names.ts';
import { legalText, LINKS, privacyUpdatedLine, type Language } from '../../i18n/index.ts';
import { CreditsPage } from './credits-page.tsx';
import { LegalNoticePage } from './legal-notice-page.tsx';
import { PrivacyPolicyPage } from './privacy-policy-page.tsx';

const languages: Language[] = ['en', 'fr'];

describe.each(languages)('legal pages in %s', (language) => {
  it('credits OpenStreetMap and IGN, and links to the source code', () => {
    render(<CreditsPage language={language} />);

    expect(screen.getByTestId('credits-page-odbl')).toHaveAttribute('href', LINKS.odbl);
    expect(screen.getByTestId('credits-page')).toHaveTextContent(/Plan IGN/);
    expect(screen.getByTestId('credits-page')).toHaveTextContent(/BD ALTI/);
    expect(screen.getByTestId('credits-page-licence')).toHaveAttribute('href', LINKS.licence);
    expect(screen.getByTestId('credits-page-source')).toHaveAttribute('href', LINKS.source);
    expect(screen.getByTestId('credits-page-agpl')).toBeInTheDocument();
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

  it('sets the introduction of the privacy policy apart, and no other paragraph', () => {
    render(<PrivacyPolicyPage language={language} />);

    const [intro, ...others] = screen.getByTestId('privacy-policy-page').querySelectorAll('p');
    expect(intro).toHaveClass(...LEAD.split(' '));
    for (const paragraph of others) expect(paragraph).not.toHaveClass('border-ink');
  });

  it('names the publisher and the host in the legal notice', () => {
    render(<LegalNoticePage language={language} />);

    expect(screen.getByTestId('legal-notice-page')).toHaveTextContent(/lesloi/);
    expect(screen.getByTestId('legal-notice-page')).toHaveTextContent(/Scaleway SAS/);
  });

  it.each([
    ['credits', 'credits-page', <CreditsPage key="credits" language={language} />, legalText[language].credits],
    [
      'privacy policy',
      'privacy-policy-page',
      <PrivacyPolicyPage key="privacy" language={language} />,
      legalText[language].privacy,
    ],
    [
      'legal notice',
      'legal-notice-page',
      <LegalNoticePage key="notice" language={language} />,
      legalText[language].legalNotice,
    ],
  ])('shows every section heading of the %s', (_, testId, page, sections) => {
    render(page);

    for (const { id, title } of sections) {
      if (title) expect(screen.getByTestId(`${testId}-section-${id}`)).toHaveTextContent(title);
    }
  });

  it('puts the date of the privacy policy right under its introduction', () => {
    render(<PrivacyPolicyPage language={language} />);

    const [intro] = screen.getByTestId('privacy-policy-page').querySelectorAll('p');
    expect(intro.nextElementSibling).toHaveTextContent(privacyUpdatedLine(language));
  });

  it('dates the privacy policy in the language', () => {
    render(<PrivacyPolicyPage language={language} />);

    expect(screen.getByTestId('privacy-policy-page')).toHaveTextContent(
      { en: 'Last updated: 28 September 2026.', fr: 'Dernière mise à jour : 28 septembre 2026.' }[language],
    );
  });
});
