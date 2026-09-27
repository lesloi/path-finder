import { createHash, randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';

export type Admission = { admitted: true } | { admitted: false; retryAfter: number };

/**
 * Hosts usually get a whole IPv6 /64, so it counts as one address; IPv4 clients reaching an
 * IPv6 socket show up as `::ffff:a.b.c.d`.
 */
function addressKey(address: string): string {
  const unmapped = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (!isIPv6(unmapped)) return unmapped;
  const [head, tail] = unmapped.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  // An IPv4 tail such as `198.51.100.1` fills two groups.
  const tailWidth = tailGroups.length + (tail?.includes('.') ? 1 : 0);
  const zeros = tail === undefined ? [] : Array<string>(8 - headGroups.length - tailWidth).fill('0');
  const prefix = [...headGroups, ...zeros, ...tailGroups].slice(0, 4);
  return `${prefix.map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

/**
 * Counts requests per address in fixed windows. Addresses are kept only as hashes salted
 * with a random salt that changes with each window, and all of them are forgotten when it ends.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  let windowStart = Date.now();
  let salt = randomBytes(16);
  const counts = new Map<string, number>();
  // On a timer rather than on the next request, so an idle server forgets addresses too.
  setInterval(() => {
    windowStart = Date.now();
    salt = randomBytes(16);
    counts.clear();
  }, windowMs).unref();

  return (address: string): Admission => {
    const now = Date.now();
    const key = createHash('sha256').update(salt).update(addressKey(address)).digest('base64');
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count <= limit) return { admitted: true };
    return { admitted: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
  };
}

/** Returns undefined, without running the task, when the queue is full. */
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
