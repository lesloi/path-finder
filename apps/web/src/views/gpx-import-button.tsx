import { FileUp } from 'lucide-react';
import { useRef } from 'react';

import { FLOATING_BUTTON, tip } from '../components/styles.ts';
import { criteriaText, type Language } from '../i18n/index.ts';

/**
 * The round button over the map that opens a GPX file from the device, placed by `className`. The file is
 * handed to `onFile` as it is and read in the browser: it goes nowhere else. No `accept`, since some phones grey out
 * files they have no type for, and `.gpx` is one.
 */
export function GpxImportButton({
  language,
  onFile,
  className,
}: {
  language: Language;
  onFile: (file: File) => void;
  className: string;
}) {
  // Held until the picker answers: an element nothing refers to can be collected with its listener, on Safari.
  const picker = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      data-testid="gpx-import"
      className={`${FLOATING_BUTTON} fixed z-5 ${className}`}
      {...tip(criteriaText[language].importGpx, 'bottom-end')}
      onClick={() => {
        // Out of the page, so that the picker is not a control to name and leaves nothing behind.
        const input = Object.assign(document.createElement('input'), { type: 'file' });
        picker.current = input;
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file) onFile(file);
        });
        input.click();
      }}
    >
      <FileUp size={20} aria-hidden />
    </button>
  );
}
