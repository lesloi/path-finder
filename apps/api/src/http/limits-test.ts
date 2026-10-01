import { createConcurrencyLimiter, createRateLimiter } from './limits.ts';

const TEN_MINUTES = 10 * 60 * 1000;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits the limit of requests from an address in a window, then asks to retry when the window ends', () => {
    const admit = createRateLimiter({ limit: 3, windowMs: TEN_MINUTES });

    const admitted = [admit('203.0.113.1'), admit('203.0.113.1'), admit('203.0.113.1')];
    vi.advanceTimersByTime(4 * 60 * 1000);
    const turnedAway = admit('203.0.113.1');

    expect(admitted).toEqual([{ admitted: true }, { admitted: true }, { admitted: true }]);
    expect(turnedAway).toEqual({ admitted: false, retryAfter: 6 * 60 });
  });

  it('counts each address on its own', () => {
    const admit = createRateLimiter({ limit: 1, windowMs: TEN_MINUTES });

    admit('203.0.113.1');

    expect(admit('203.0.113.1').admitted).toBe(false);
    expect(admit('203.0.113.2').admitted).toBe(true);
    expect(admit('2001:db8:0:2::1').admitted).toBe(true);
  });

  it('forgets every address when a new window starts', () => {
    const admit = createRateLimiter({ limit: 1, windowMs: TEN_MINUTES });
    admit('203.0.113.1');

    vi.advanceTimersByTime(TEN_MINUTES);

    expect(admit('203.0.113.1').admitted).toBe(true);
  });

  it('forgets every address when a window ends, even without a request after it', () => {
    const clear = vi.spyOn(Map.prototype, 'clear');
    const admit = createRateLimiter({ limit: 1, windowMs: TEN_MINUTES });
    admit('203.0.113.1');

    vi.advanceTimersByTime(TEN_MINUTES);

    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it.each([
    ['an IPv6 /64', '2001:db8:0:1::1', '2001:0db8:0000:0001:ffff:0:0:2'],
    ['an IPv6 /64 written with an IPv4 tail', '64:ff9b::198.51.100.1', '64:ff9b::198.51.100.2'],
    ['an IPv4 address mapped to IPv6', '::ffff:203.0.113.1', '203.0.113.1'],
  ])('counts %s as one address', (_, first, second) => {
    const admit = createRateLimiter({ limit: 1, windowMs: TEN_MINUTES });

    admit(first);

    expect(admit(second).admitted).toBe(false);
  });
});

describe('concurrency limiter', () => {
  it('runs up to the limit of tasks at once and queues the next ones', async () => {
    const run = createConcurrencyLimiter({ limit: 2, queueSize: 2 });
    const gate = deferred();
    let running = 0;
    let mostRunning = 0;
    const task = async () => {
      mostRunning = Math.max(mostRunning, ++running);
      await gate.promise;
      running--;
      return 'done';
    };

    const results = [run(task), run(task), run(task), run(task)];
    gate.resolve();

    expect(await Promise.all(results)).toEqual(['done', 'done', 'done', 'done']);
    expect(mostRunning).toBe(2);
  });

  it('turns tasks away when the queue is full', async () => {
    const run = createConcurrencyLimiter({ limit: 1, queueSize: 1 });
    const gate = deferred();

    const running = run(() => gate.promise);
    const queued = run(() => gate.promise);
    const turnedAway = run(() => gate.promise);

    expect(turnedAway).toBeUndefined();
    gate.resolve();
    await Promise.all([running, queued]);
  });

  it('frees the slot of a task that fails', async () => {
    const run = createConcurrencyLimiter({ limit: 1, queueSize: 0 });

    await expect(run(() => Promise.reject(new Error('BRouter is down')))).rejects.toThrow('BRouter is down');

    expect(await run(async () => 'done')).toBe('done');
  });
});
