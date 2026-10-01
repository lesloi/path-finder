import { legalText, type Language } from '../../i18n/index.ts';
import { LegalDocument } from './legal-document.tsx';

export function CreditsPage({ language }: { language: Language }) {
  return <LegalDocument testId="credits-page" sections={legalText[language].credits} />;
}
