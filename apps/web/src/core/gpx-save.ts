import { gpxExport, type GpxRoute } from './gpx.ts';

const gpxFile = (fileName: string, content: string) => new File([content], fileName, { type: 'application/gpx+xml' });

/** Whether `saveGpx` opens the share sheet rather than downloading, so a button can say which. */
export const canShareGpx = (file = gpxFile('route.gpx', '')) => Boolean(navigator.canShare?.({ files: [file] }));

/**
 * Sends a GPX file to the device share sheet when the browser can share files, otherwise
 * downloads it. Call it from the tap that asks for it, with nothing awaited before: a share sheet
 * needs that tap. Nothing leaves the device but through the user's own choice in the sheet.
 */
export async function saveGpx({ fileName, content }: { fileName: string; content: string }): Promise<void> {
  const file = gpxFile(fileName, content);
  if (canShareGpx(file)) {
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

/** Exports a route as a GPX file, as of now, in the language and pace unit the user reads. */
export function exportRoute(route: GpxRoute, options: Parameters<typeof gpxExport>[2], pace: number): Promise<void> {
  return saveGpx(gpxExport(route, new Date(), options, pace));
}
