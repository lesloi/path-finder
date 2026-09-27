import { createHash } from 'node:crypto';

export interface RateLimitResult {
  allowed: boolean;
}

export interface ConcurrencyLimitResult {
  status: 503;
  retryAfter: number;
}

export function createRateLimiter({
  threshold,
  salt,
}: {
  threshold: number;
  salt: string;
}): (ip: string) => RateLimitResult {
  const counts = new Map<string, number>();

  return (ip: string) => {
    const hash = createHash('sha256').update(`${salt}:${ip}`).digest('hex');
    const count = (counts.get(hash) ?? 0) + 1;
    counts.set(hash, count);

    return {
      allowed: count <= threshold,
    };
  };
}

export function createConcurrencyLimiter({
  limit,
  queueSize = 10,
}: {
  limit: number;
  queueSize?: number;
}): <T>(task: () => Promise<T>) => Promise<T> | ConcurrencyLimitResult {
  let active = 0;
  let queued = 0;
  const taskQueue: Array<{
    task: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  const processNext = () => {
    if (active >= limit || taskQueue.length === 0) {
      return;
    }

    const { task, resolve, reject } = taskQueue.shift()!;
    active++;
    queued--;

    task()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        active--;
        processNext();
      });
  };

  return <T>(
    task: () => Promise<T>,
  ): Promise<T> | ConcurrencyLimitResult => {
    if (active >= limit) {
      if (queued >= queueSize) {
        return {
          status: 503,
          retryAfter: Math.ceil(Math.random() * 5) + 1,
        };
      }

      queued++;
      return new Promise<T>((resolve, reject) => {
        taskQueue.push({ task, resolve, reject });
      });
    }

    active++;
    return task().finally(() => {
      active--;
      processNext();
    });
  };
}

export function createDailySalt(): string {
  const now = new Date();
  const day = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return createHash('sha256').update(day).digest('hex').slice(0, 16);
}
