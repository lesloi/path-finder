import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBuildId } from './build-id.ts';

describe('readBuildId', () => {
  let webRoot: string;

  beforeEach(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'web-'));
  });

  afterEach(async () => {
    await rm(webRoot, { recursive: true });
  });

  it('returns the ID the web app build wrote, without its trailing newline', async () => {
    await writeFile(join(webRoot, 'build-id'), 'b1d-2026\n');

    const buildId = readBuildId(webRoot);

    expect(buildId).toBe('b1d-2026');
  });

  it('returns none when the web app is not built', () => {
    const buildId = readBuildId(webRoot);

    expect(buildId).toBeUndefined();
  });
});
