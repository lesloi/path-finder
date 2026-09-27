import { createHash, randomBytes } from 'node:crypto';

export type RateLimit = { allowed: true } | { allowed: false; retryAfter: number };

/**
 * Counts requests per address in fixed windows. Addresses are kept only as hashes salted
 * with a random salt that changes with each window, and all of them are forgotten when it ends.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  let windowStart = Date.now();
  let salt = randomBytes(16);
  const counts = new Map<string, number>();

  return (address: string): RateLimit => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      salt = randomBytes(16);
      counts.clear();
    }
    const key = createHash('sha256').update(salt).update(address).digest('base64');
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count <= limit) return { allowed: true };
    return { allowed: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
  };
}

/** Runs up to `limit` tasks at once and queues up to `queueSize` more; returns undefined when the queue is full. */
export function createConcurrencyLimiter({ limit, queueSize }: { limit: number; queueSize: number }) {
  let running = 0;
  const waiting: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    // A finishing task hands its slot straight to the next one, so `running` stays the same.
    if (running < limit) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  }

  return <T>(task: () => Promise<T>): Promise<T> | undefined =>
    running >= limit && waiting.length >= queueSize ? undefined : run(task);
}
