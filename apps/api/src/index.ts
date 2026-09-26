import { serve } from '@hono/node-server';
import { join } from 'node:path';

import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
const app = createApp({ webRoot: join(import.meta.dirname, '../../web/dist') });

serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on port ${port}`);
});
