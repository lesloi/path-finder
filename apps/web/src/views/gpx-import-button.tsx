import { FileUp } from 'lucide-react';

import { criteriaText, type Language } from '../i18n/index.ts';

/**
 * The button that opens a GPX file from the device. The file is handed to `onFile` as it is and read in the browser:
 * it goes nowhere else. No `accept`, since some phones grey out files they have no type for, and `.gpx` is one.
 */
export function GpxImportButton({ language, onFile }: { language: Language; onFile: (file: File) => void }) {
  return (
    <button
      type="button"
      data-testid="gpx-import"
      className="flex min-h-touch w-full items-center justify-center gap-2 rounded-full text-accent"
      onClick={() => {
        // Out of the page, so that the picker is not a control to name and leaves nothing behind.
        const input = Object.assign(document.createElement('input'), { type: 'file' });
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file) onFile(file);
        });
        input.click();
      }}
    >
      <FileUp size={18} aria-hidden />
      {criteriaText[language].importGpx}
    </button>
  );
}
