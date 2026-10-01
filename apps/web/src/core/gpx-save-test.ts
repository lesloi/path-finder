import { saveGpx } from './gpx-save.ts';

const gpx = { fileName: 'Course-2809-12km.gpx', content: '<gpx/>' };

function stubShare(share: (data: ShareData) => Promise<void>, canShare = true) {
  vi.stubGlobal('navigator', { ...navigator, canShare: vi.fn(() => canShare), share: vi.fn(share) });
  return navigator.share as ReturnType<typeof vi.fn>;
}

function stubDownload() {
  const click = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  URL.createObjectURL = vi.fn(() => 'blob:gpx');
  URL.revokeObjectURL = vi.fn();
  return click;
}

afterEach(() => vi.restoreAllMocks());

describe('saveGpx', () => {
  it('opens the share sheet with the file when the browser can share it', async () => {
    const share = stubShare(() => Promise.resolve());

    await saveGpx(gpx);

    const [{ files }] = share.mock.calls[0] as [ShareData];
    expect(files).toHaveLength(1);
    expect(files![0].name).toBe('Course-2809-12km.gpx');
    expect(await files![0].text()).toBe('<gpx/>');
  });

  it('downloads the file when the browser cannot share files', async () => {
    const click = stubDownload();
    const share = stubShare(() => Promise.resolve(), false);

    await saveGpx(gpx);

    expect(share).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:gpx');
  });

  it('downloads the file when the browser has no share sheet', async () => {
    const click = stubDownload();
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });

    await saveGpx(gpx);

    expect(click).toHaveBeenCalledOnce();
  });

  it('does nothing more when the user closes the share sheet', async () => {
    const click = stubDownload();
    stubShare(() => Promise.reject(new DOMException('Cancelled', 'AbortError')));

    await saveGpx(gpx);

    expect(click).not.toHaveBeenCalled();
  });

  it('downloads the file when sharing fails', async () => {
    const click = stubDownload();
    stubShare(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));

    await saveGpx(gpx);

    expect(click).toHaveBeenCalledOnce();
  });

  it('builds the file before any wait, to keep the tap that asked for it', () => {
    const share = stubShare(() => new Promise(() => {}));

    void saveGpx(gpx);

    expect(share).toHaveBeenCalled();
  });
});
