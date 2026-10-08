import { legalText, privacyUpdatedLine, type Language } from '../../i18n/index.ts';
import { LegalDocument } from './legal-document.tsx';

export function PrivacyPolicyPage({ language }: { language: Language }) {
  return (
    <LegalDocument
      testId="privacy-policy-page"
      sections={legalText[language].privacy}
      note={privacyUpdatedLine(language)}
    />
  );
}
