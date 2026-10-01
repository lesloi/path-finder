import { legalText, type Language } from '../../i18n/index.ts';
import { LegalDocument } from './legal-document.tsx';

export function LegalNoticePage({ language }: { language: Language }) {
  return <LegalDocument testId="legal-notice-page" sections={legalText[language].legalNotice} />;
}
