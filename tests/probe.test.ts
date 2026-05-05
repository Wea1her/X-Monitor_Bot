import { describe, expect, it, vi } from 'vitest';
import {
  buildSubscribeMessage,
  buildWebSocketUrl,
  getReconnectDelayMs,
  handleWebSocketPayload
} from '../src/probe.js';

describe('probe helpers', () => {
  it('builds the authenticated WebSocket URL', () => {
    expect(buildWebSocketUrl('abc 123')).toBe(
      'wss://ai.6551.io/open/twitter_wss?token=abc%20123'
    );
  });

  it('builds the JSON-RPC subscribe message', () => {
    expect(buildSubscribeMessage()).toBe(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'twitter.subscribe'
      })
    );
  });

  it('caps exponential reconnect delay at 30 seconds', () => {
    expect(getReconnectDelayMs(0)).toBe(1000);
    expect(getReconnectDelayMs(1)).toBe(2000);
    expect(getReconnectDelayMs(10)).toBe(30000);
  });
});

describe('handleWebSocketPayload', () => {
  it('logs and forwards monitored NEW_FOLLOWER messages', async () => {
    const appendEventLog = vi.fn().mockResolvedValue(undefined);
    const sendTelegramMessage = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const warn = vi.fn();
    const message = {
      jsonrpc: '2.0',
      method: 'twitter.event',
      params: {
        twAccount: 'elonmusk',
        twUserName: 'Elon Musk',
        eventType: 'NEW_FOLLOWER',
        createdAt: '2026-04-27T01:02:03Z',
        content: [{ twAccount: 'jack', twUserName: 'Jack', profileUrl: 'https://twitter.com/jack' }]
      }
    };

    await handleWebSocketPayload(JSON.stringify(message), {
      logDir: 'logs',
      telegram: { botToken: 'bot', chatId: 'chat' },
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog,
      sendTelegramMessage,
      info,
      warn
    });

    expect(info).toHaveBeenCalledWith(
      '[NEW_FOLLOWER] @elonmusk followed @jack (Jack) 2026-04-27T01:02:03Z'
    );
    expect(appendEventLog).toHaveBeenCalledWith('logs', {
      receivedAt: '2026-04-27T10:00:00.000Z',
      message
    });
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs invalid JSON and keeps running', async () => {
    const warn = vi.fn();

    await handleWebSocketPayload('{not-json', {
      logDir: 'logs',
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog: vi.fn(),
      sendTelegramMessage: vi.fn(),
      info: vi.fn(),
      warn
    });

    expect(warn).toHaveBeenCalledWith('Invalid WSS message JSON ignored');
  });

  it('drops NEW_FOLLOWER messages outside configured watch accounts', async () => {
    const appendEventLog = vi.fn().mockResolvedValue(undefined);
    const sendTelegramMessage = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const warn = vi.fn();
    const message = {
      jsonrpc: '2.0',
      method: 'twitter.event',
      params: {
        twAccount: 'CNNnews18',
        eventType: 'NEW_FOLLOWER',
        createdAt: '2026-04-27T01:02:03Z',
        content: [{ twAccount: 'someone' }]
      }
    };

    await handleWebSocketPayload(JSON.stringify(message), {
      logDir: 'logs',
      watchAccounts: ['jaycupup'],
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog,
      sendTelegramMessage,
      info,
      warn
    });

    expect(info).toHaveBeenCalledWith('WSS event filtered: [NEW_FOLLOWER] CNNnews18');
    expect(appendEventLog).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps NEW_FOLLOWER messages from configured watch accounts case-insensitively', async () => {
    const appendEventLog = vi.fn().mockResolvedValue(undefined);
    const sendTelegramMessage = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const message = {
      jsonrpc: '2.0',
      method: 'twitter.event',
      params: {
        twAccount: 'JayCupUp',
        eventType: 'NEW_FOLLOWER',
        createdAt: '2026-04-27T01:02:03Z',
        content: [{ twAccount: 'newtarget' }]
      }
    };

    await handleWebSocketPayload(JSON.stringify(message), {
      logDir: 'logs',
      watchAccounts: ['jaycupup'],
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog,
      sendTelegramMessage,
      info,
      warn: vi.fn()
    });

    expect(info).toHaveBeenCalledWith(
      '[NEW_FOLLOWER] @JayCupUp followed @newtarget 2026-04-27T01:02:03Z'
    );
    expect(appendEventLog).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('drops non-follow twitter.event messages from configured watch accounts', async () => {
    const appendEventLog = vi.fn().mockResolvedValue(undefined);
    const sendTelegramMessage = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const message = {
      jsonrpc: '2.0',
      method: 'twitter.event',
      params: {
        twAccount: 'JayCupUp',
        eventType: 'NEW_TWEET',
        createdAt: '2026-04-27T01:02:03Z',
        content: 'ignored'
      }
    };

    await handleWebSocketPayload(JSON.stringify(message), {
      logDir: 'logs',
      watchAccounts: ['jaycupup'],
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog,
      sendTelegramMessage,
      info,
      warn: vi.fn()
    });

    expect(info).toHaveBeenCalledWith('WSS event filtered: [NEW_TWEET] JayCupUp');
    expect(appendEventLog).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('logs and forwards monitored NEW_UNFOLLOWER messages', async () => {
    const appendEventLog = vi.fn().mockResolvedValue(undefined);
    const sendTelegramMessage = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const message = {
      jsonrpc: '2.0',
      method: 'twitter.event',
      params: {
        twAccount: 'elonmusk',
        twUserName: 'Elon Musk',
        eventType: 'NEW_UNFOLLOWER',
        createdAt: '2026-04-27T01:02:03Z',
        content: [{ twAccount: 'jack', twUserName: 'Jack', profileUrl: 'https://twitter.com/jack' }]
      }
    };

    await handleWebSocketPayload(JSON.stringify(message), {
      logDir: 'logs',
      telegram: { botToken: 'bot', chatId: 'chat' },
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog,
      sendTelegramMessage,
      info,
      warn: vi.fn()
    });

    expect(info).toHaveBeenCalledWith(
      '[NEW_UNFOLLOWER] @elonmusk unfollowed @jack (Jack) 2026-04-27T01:02:03Z'
    );
    expect(appendEventLog).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores non twitter.event messages after printing them', async () => {
    const info = vi.fn();

    await handleWebSocketPayload('{"jsonrpc":"2.0","id":1,"result":{"success":true}}', {
      logDir: 'logs',
      now: () => '2026-04-27T10:00:00.000Z',
      appendEventLog: vi.fn(),
      sendTelegramMessage: vi.fn(),
      info,
      warn: vi.fn()
    });

    expect(info).toHaveBeenCalledWith(
      'WSS message: {"jsonrpc":"2.0","id":1,"result":{"success":true}}'
    );
  });
});
