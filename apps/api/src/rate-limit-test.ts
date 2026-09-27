import { createConcurrencyLimiter, createRateLimiter } from './rate-limit.ts';

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

  it('allows the limit of requests from an address in a window, then asks to retry when the window ends', () => {
    const limit = createRateLimiter({ limit: 3, windowMs: TEN_MINUTES });

    const allowed = [limit('203.0.113.1'), limit('203.0.113.1'), limit('203.0.113.1')];
    vi.advanceTimersByTime(4 * 60 * 1000);
    const rejected = limit('203.0.113.1');

    expect(allowed).toEqual([{ allowed: true }, { allowed: true }, { allowed: true }]);
    expect(rejected).toEqual({ allowed: false, retryAfter: 6 * 60 });
  });

  it('counts each address on its own', () => {
    const limit = createRateLimiter({ limit: 1, windowMs: TEN_MINUTES });

    limit('203.0.113.1');

    expect(limit('203.0.113.1').allowed).toBe(false);
    expect(limit('203.0.113.2').allowed).toBe(true);
  });

  it('forgets every address when a new window starts', () => {
    const limit = createRateLimiter({ limit: 1, windowMs: TEN_MINUTES });
    limit('203.0.113.1');

    vi.advanceTimersByTime(TEN_MINUTES);

    expect(limit('203.0.113.1').allowed).toBe(true);
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
