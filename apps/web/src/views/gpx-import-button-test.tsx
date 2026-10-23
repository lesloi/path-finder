import { fireEvent, render, screen } from '@testing-library/react';

import { commonText, criteriaText } from '../i18n/index.ts';
import { GpxImportButton } from './gpx-import-button.tsx';

const en = criteriaText.en;

const onHoverScreen = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) =>
        ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );

// The picker is an input out of the page: its click is what opens the system dialog.
function spyOnPicker() {
  const picked: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    picked.push(this);
  });
  return picked;
}

function renderButton(onFile = vi.fn()) {
  render(<GpxImportButton language="en" onFile={onFile} className="" />);
  return onFile;
}

afterEach(() => vi.restoreAllMocks());

describe('GpxImportButton', () => {
  describe('on a touch screen', () => {
    it('explains the import in a dialog before opening the picker', () => {
      const picked = spyOnPicker();
      renderButton();

      fireEvent.click(screen.getByTestId('gpx-import'));

      expect(screen.getByRole('dialog')).toHaveAccessibleName(en.importGpx);
      expect(screen.getByRole('dialog')).toHaveTextContent(en.importGpxHint);
      expect(screen.getByRole('dialog')).toHaveTextContent(en.importGpxPrivacy);
      expect(screen.getByTestId('gpx-import-choose')).toHaveAccessibleName(en.importGpxChoose);
      expect(screen.getByTestId('gpx-import-close')).toHaveAccessibleName(commonText.en.close);
      expect(picked).toHaveLength(0);
    });

    it('puts the focus on its title, so that the explanation is read first', () => {
      renderButton();

      fireEvent.click(screen.getByTestId('gpx-import'));

      expect(screen.getByRole('heading')).toHaveFocus();
    });

    it('opens the picker from the choose button, and hands the file over', () => {
      const picked = spyOnPicker();
      const onFile = renderButton();
      fireEvent.click(screen.getByTestId('gpx-import'));
      const file = new File(['<gpx/>'], 'track.gpx');

      fireEvent.click(screen.getByTestId('gpx-import-choose'));
      Object.defineProperty(picked[0], 'files', { value: [file] });
      picked[0]!.dispatchEvent(new Event('change'));

      expect(picked).toHaveLength(1);
      expect(onFile).toHaveBeenCalledWith(file);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes without opening the picker from the cross', () => {
      const picked = spyOnPicker();
      renderButton();
      fireEvent.click(screen.getByTestId('gpx-import'));

      fireEvent.click(screen.getByTestId('gpx-import-close'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(picked).toHaveLength(0);
    });

    it('closes on Escape', () => {
      renderButton();
      fireEvent.click(screen.getByTestId('gpx-import'));

      fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on a click on the scrim', () => {
      renderButton();
      fireEvent.click(screen.getByTestId('gpx-import'));

      fireEvent.click(screen.getByRole('dialog'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('on a screen that can hover', () => {
    it('opens the picker directly, with no dialog', () => {
      onHoverScreen();
      const picked = spyOnPicker();
      renderButton();

      fireEvent.click(screen.getByTestId('gpx-import'));

      expect(picked).toHaveLength(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
