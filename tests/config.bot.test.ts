import { describe, expect, it } from 'vitest';
import { parseBotConfig } from '../src/config.js';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'bot-token',
  OWNER_USER_IDS: '111,222',
  TWITTER_TOKEN: 'tw-token',
  DATABASE_URL: 'postgresql://x:x@localhost:5432/x_monitor',
  REDIS_URL: 'redis://localhost:6379'
};

describe('parseBotConfig', () => {
  it('parses required values into typed config', () => {
    expect(parseBotConfig(baseEnv)).toEqual({
      telegramBotToken: 'bot-token',
      ownerUserIds: [111, 222],
      twitterToken: 'tw-token',
      databaseUrl: 'postgresql://x:x@localhost:5432/x_monitor',
      redisUrl: 'redis://localhost:6379'
    });
  });

  it('trims whitespace and ignores empty owner ids', () => {
    expect(
      parseBotConfig({ ...baseEnv, OWNER_USER_IDS: ' 333 , , 444 ' }).ownerUserIds
    ).toEqual([333, 444]);
  });

  it('rejects missing TELEGRAM_BOT_TOKEN', () => {
    const env = { ...baseEnv, TELEGRAM_BOT_TOKEN: '' };
    expect(() => parseBotConfig(env)).toThrow('TELEGRAM_BOT_TOKEN is required');
  });

  it('rejects missing OWNER_USER_IDS', () => {
    const env = { ...baseEnv, OWNER_USER_IDS: '' };
    expect(() => parseBotConfig(env)).toThrow('OWNER_USER_IDS must include at least one user id');
  });

  it('rejects non-numeric owner id', () => {
    const env = { ...baseEnv, OWNER_USER_IDS: '111,abc' };
    expect(() => parseBotConfig(env)).toThrow('OWNER_USER_IDS must contain only numeric ids');
  });

  it('rejects missing TWITTER_TOKEN', () => {
    const env = { ...baseEnv, TWITTER_TOKEN: '' };
    expect(() => parseBotConfig(env)).toThrow('TWITTER_TOKEN is required');
  });

  it('rejects missing DATABASE_URL', () => {
    const env = { ...baseEnv, DATABASE_URL: '' };
    expect(() => parseBotConfig(env)).toThrow('DATABASE_URL is required');
  });

  it('rejects missing REDIS_URL', () => {
    const env = { ...baseEnv, REDIS_URL: '' };
    expect(() => parseBotConfig(env)).toThrow('REDIS_URL is required');
  });
});
