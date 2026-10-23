import { FileUp, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';

import { useHover } from '../components/use-desktop.ts';
import { FLOATING_BUTTON, ICON_BUTTON, PRIMARY_BUTTON, tip } from '../components/styles.ts';
import { commonText, criteriaText, type Language } from '../i18n/index.ts';

/**
 * The round button over the map that opens a GPX file from the device, placed by `className`. The file is
 * handed to `onFile` as it is and read in the browser: it goes nowhere else. No `accept`, since some phones grey out
 * files they have no type for, and `.gpx` is one. Where the pointer cannot hover the tooltip never shows, so a small
 * dialog says what the button does before the picker opens.
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
  const t = criteriaText[language];
  const hover = useHover();
  const [explaining, setExplaining] = useState(false);
  // Held until the picker answers: an element nothing refers to can be collected with its listener, on Safari.
  const picker = useRef<HTMLInputElement>(null);

  // In the click itself: a browser only opens the picker for a user gesture, which an effect or a timer is not.
  function pick() {
    // Out of the page, so that the picker is not a control to name and leaves nothing behind.
    const input = Object.assign(document.createElement('input'), { type: 'file' });
    picker.current = input;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) onFile(file);
    });
    input.click();
  }

  return (
    <>
      <button
        type="button"
        data-testid="gpx-import"
        className={`${FLOATING_BUTTON} fixed z-5 ${className}`}
        {...tip(t.importGpx, 'bottom-end')}
        onClick={hover ? pick : () => setExplaining(true)}
      >
        <FileUp size={20} aria-hidden />
      </button>
      {explaining && (
        <ExplainDialog
          language={language}
          onChoose={() => {
            pick();
            setExplaining(false);
          }}
          onClose={() => setExplaining(false)}
        />
      )}
    </>
  );
}

function ExplainDialog({
  language,
  onChoose,
  onClose,
}: {
  language: Language;
  onChoose: () => void;
  onClose: () => void;
}) {
  const t = criteriaText[language];
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Modal, and opened with the commit that mounts it, so that the title is never under a closed dialog. The focus goes to
  // the title, not to the cross that `showModal` would pick: a screen reader reads the explanation first.
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    heading.current!.focus();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={headingId}
      className="m-auto w-[calc(100vw-2*--spacing(4))] max-w-100 rounded-md bg-surface text-ink shadow-float backdrop:bg-scrim"
      // Escape closes, as the cross does.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click outside the card lands on the dialog itself, over its scrim: the padding is on the wrapper, not here.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 ref={heading} id={headingId} tabIndex={-1} className="text-lg font-bold outline-none">
            {t.importGpx}
          </h2>
          <button
            type="button"
            data-testid="gpx-import-close"
            className={`${ICON_BUTTON} -mr-2`}
            {...tip(commonText[language].close, 'bottom-end')}
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-ink-2">{t.importGpxHint}</p>
        <p className="mb-4 text-ink-2">{t.importGpxPrivacy}</p>
        <button type="button" data-testid="gpx-import-choose" className={PRIMARY_BUTTON} onClick={onChoose}>
          {t.importGpxChoose}
        </button>
      </div>
    </dialog>
  );
}
