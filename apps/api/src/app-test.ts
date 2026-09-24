import { app } from './app.ts';

describe('api', () => {
  it('answers the health check', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});
