import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('parses required Twitter token and normalized watch accounts', () => {
    const config = parseConfig({
      TWITTER_TOKEN: 'token-123',
      WATCH_ACCOUNTS: ' @elonmusk, VitalikButerin ,,jack ',
      LOG_DIR: 'custom-logs'
    });

    expect(config).toEqual({
      twitterToken: 'token-123',
      watchAccounts: ['elonmusk', 'VitalikButerin', 'jack'],
      logDir: 'custom-logs',
      telegram: undefined
    });
  });

  it('uses logs as the default log directory', () => {
    const config = parseConfig({
      TWITTER_TOKEN: 'token-123',
      WATCH_ACCOUNTS: 'elonmusk'
    });

    expect(config.logDir).toBe('logs');
  });

  it('includes Telegram config only when both Telegram values exist', () => {
    const config = parseConfig({
      TWITTER_TOKEN: 'token-123',
      WATCH_ACCOUNTS: 'elonmusk',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: 'chat-id'
    });

    expect(config.telegram).toEqual({
      botToken: 'bot-token',
      chatId: 'chat-id'
    });
  });

  it('fails when TWITTER_TOKEN is missing', () => {
    expect(() =>
      parseConfig({
        WATCH_ACCOUNTS: 'elonmusk'
      })
    ).toThrow('TWITTER_TOKEN is required');
  });

  it('fails when WATCH_ACCOUNTS has no usable usernames', () => {
    expect(() =>
      parseConfig({
        TWITTER_TOKEN: 'token-123',
        WATCH_ACCOUNTS: ' , @ , '
      })
    ).toThrow('WATCH_ACCOUNTS must include at least one username');
  });
});
