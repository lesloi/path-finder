import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ID written by each web app build (see `apps/web/vite.config.ts`), or none when the web app is not built. */
export function readBuildId(webRoot: string): string | undefined {
  try {
    return readFileSync(join(webRoot, 'build-id'), 'utf8').trim();
  } catch {
    return undefined;
  }
}
