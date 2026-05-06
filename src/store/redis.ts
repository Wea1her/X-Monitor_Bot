import { Redis } from 'ioredis';

export interface RedisLike {
  set(key: string, value: string, mode: 'EX', seconds: number, condition: 'NX'): Promise<'OK' | null>;
  set(key: string, value: string): Promise<'OK'>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

const DEDUPE_PREFIX = 'dedupe:event:';
const OFFSET_KEY = 'tg:offset';
const DEDUPE_TTL_SECONDS = 86_400;

export interface RedisHelpers {
  tryClaimDedupe(key: string): Promise<boolean>;
  getOffset(): Promise<number | undefined>;
  setOffset(value: number): Promise<void>;
}

export function createRedisClient(url: string): Redis {
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
}

export function createRedisHelpers(redis: RedisLike): RedisHelpers {
  return {
    async tryClaimDedupe(key: string): Promise<boolean> {
      try {
        const result = await redis.set(`${DEDUPE_PREFIX}${key}`, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
        return result === 'OK';
      } catch {
        return true;
      }
    },
    async getOffset(): Promise<number | undefined> {
      try {
        const raw = await redis.get(OFFSET_KEY);
        if (!raw) return undefined;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    async setOffset(value: number): Promise<void> {
      try {
        await redis.set(OFFSET_KEY, String(value));
      } catch {
        /* swallow: offset is best-effort */
      }
    }
  };
}
