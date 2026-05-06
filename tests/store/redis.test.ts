import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import { createRedisHelpers, type RedisLike } from '../../src/store/redis.js';

function makeRedis(): RedisLike {
  return new RedisMock() as unknown as RedisLike;
}

describe('redis helpers', () => {
  it('SETNX-style dedupe: first call wins, second call loses', async () => {
    const redis = makeRedis();
    const helpers = createRedisHelpers(redis);
    expect(await helpers.tryClaimDedupe('k1')).toBe(true);
    expect(await helpers.tryClaimDedupe('k1')).toBe(false);
  });

  it('falls back to true when redis throws (do not block dispatch)', async () => {
    const failing: RedisLike = {
      set: async () => {
        throw new Error('connection lost');
      },
      get: async () => null,
      del: async () => 0
    } as unknown as RedisLike;
    const helpers = createRedisHelpers(failing);
    expect(await helpers.tryClaimDedupe('k1')).toBe(true);
  });

  it('persists and retrieves Telegram polling offset', async () => {
    const redis = makeRedis();
    const helpers = createRedisHelpers(redis);
    expect(await helpers.getOffset()).toBeUndefined();
    await helpers.setOffset(42);
    expect(await helpers.getOffset()).toBe(42);
  });

  it('returns undefined offset on redis read failure', async () => {
    const failing: RedisLike = {
      set: async () => 'OK',
      get: async () => {
        throw new Error('boom');
      },
      del: async () => 0
    } as unknown as RedisLike;
    const helpers = createRedisHelpers(failing);
    expect(await helpers.getOffset()).toBeUndefined();
  });
});
