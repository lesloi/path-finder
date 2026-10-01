/**
 * Sends a GPX file to the device share sheet when the browser can share files, otherwise
 * downloads it. Call it from the tap that asks for it, with nothing awaited before: a share sheet
 * needs that tap. Nothing leaves the device but through the user's own choice in the sheet.
 */
export async function saveGpx({ fileName, content }: { fileName: string; content: string }): Promise<void> {
  const file = new File([content], fileName, { type: 'application/gpx+xml' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (error) {
      // The user closed the sheet: they do not want the file twice.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  link.click();
  URL.revokeObjectURL(url);
}
