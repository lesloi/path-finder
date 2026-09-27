import { describe, it, expect } from 'vitest';
import { createRateLimiter, createConcurrencyLimiter } from './rate-limit.ts';

describe('rate limiting', () => {
  describe('per-IP rate limiter', () => {
    it('allows requests up to the threshold', async () => {
      const limiter = createRateLimiter({ threshold: 10, salt: 'test-salt' });

      for (let i = 0; i < 10; i++) {
        const result = limiter('127.0.0.1');
        expect(result.allowed).toBe(true);
      }
    });

    it('rejects requests beyond the threshold', () => {
      const limiter = createRateLimiter({ threshold: 3, salt: 'test-salt' });

      limiter('127.0.0.1');
      limiter('127.0.0.1');
      limiter('127.0.0.1');

      const result = limiter('127.0.0.1');
      expect(result.allowed).toBe(false);
    });

    it('tracks different IPs separately', () => {
      const limiter = createRateLimiter({ threshold: 2, salt: 'test-salt' });

      limiter('127.0.0.1');
      limiter('127.0.0.1');
      const result1 = limiter('127.0.0.1');
      expect(result1.allowed).toBe(false);

      const result2 = limiter('192.168.1.1');
      expect(result2.allowed).toBe(true);
    });

    it('resets on new salt', () => {
      const limiter1 = createRateLimiter({ threshold: 2, salt: 'salt-1' });

      limiter1('127.0.0.1');
      limiter1('127.0.0.1');
      expect(limiter1('127.0.0.1').allowed).toBe(false);

      const limiter2 = createRateLimiter({ threshold: 2, salt: 'salt-2' });
      expect(limiter2('127.0.0.1').allowed).toBe(true);
    });
  });

  describe('global concurrency limiter', () => {
    it('allows tasks up to the limit', async () => {
      const limiter = createConcurrencyLimiter({ limit: 2 });

      const task1 = limiter(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'done1';
      });

      const task2 = limiter(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'done2';
      });

      const [result1, result2] = await Promise.all([task1, task2]);
      expect(result1).toBe('done1');
      expect(result2).toBe('done2');
    });

    it('queues tasks when limit is reached', async () => {
      const limiter = createConcurrencyLimiter({ limit: 1, queueSize: 2 });
      const order: number[] = [];

      const results = await Promise.all([
        limiter(async () => {
          order.push(1);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }),
        limiter(async () => {
          order.push(2);
        }),
        limiter(async () => {
          order.push(3);
        }),
      ]);

      expect(results.length).toBe(3);
      expect(order).toEqual([1, 2, 3]);
    });

    it('returns 503 when queue is full', () => {
      const limiter = createConcurrencyLimiter({ limit: 1, queueSize: 1 });

      // First task runs immediately
      limiter(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Second task is queued
      limiter(async () => {});

      // Third task should overflow the queue
      const result = limiter(async () => {});

      if (typeof result === 'object' && 'status' in result) {
        expect(result.status).toBe(503);
        expect(result.retryAfter).toBeGreaterThan(0);
      } else {
        throw new Error('Expected error result, got Promise');
      }
    });

    it('rejects immediately without queuing', async () => {
      const limiter = createConcurrencyLimiter({ limit: 1, queueSize: 0 });

      // First task runs
      const task1 = limiter(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Any other task should be rejected
      const result = limiter(async () => {});

      if (typeof result === 'object' && 'status' in result) {
        expect(result.status).toBe(503);
      } else {
        throw new Error('Expected error result, got Promise');
      }

      await task1;
    });
  });
});
