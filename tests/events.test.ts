import { describe, expect, it } from 'vitest';
import {
  formatConsoleSummary,
  formatTelegramMessage,
  makeNdjsonEntry,
  previewContent
} from '../src/events.js';

const tweetEvent = {
  jsonrpc: '2.0',
  method: 'twitter.event',
  params: {
    id: 123,
    twAccount: 'elonmusk',
    twUserName: 'Elon Musk',
    profileUrl: 'https://twitter.com/elonmusk',
    eventType: 'NEW_TWEET',
    createdAt: '2026-04-27T01:02:03Z',
    content: {
      id: 'tweet-1',
      text: 'This is a long tweet body for preview testing',
      userScreenName: 'elonmusk',
      urls: [{ expandedUrl: 'https://example.com/post' }]
    }
  }
};

const followEvent = {
  jsonrpc: '2.0',
  method: 'twitter.event',
  params: {
    id: 456,
    twAccount: 'alice',
    twUserName: 'Alice',
    profileUrl: 'https://twitter.com/alice',
    eventType: 'NEW_FOLLOWER',
    createdAt: '2026-04-27T03:04:05Z',
    content: [
      {
        twAccount: 'bob',
        twUserName: 'Bob Builder',
        profileUrl: 'https://twitter.com/bob',
        followerCount: 1234
      }
    ]
  }
};

describe('event formatting', () => {
  it('previews string content with truncation', () => {
    expect(previewContent('abcdefghijklmnopqrstuvwxyz', 12)).toBe('abcdefghi...');
  });

  it('previews array content with count and first item', () => {
    const preview = previewContent([{ twAccount: 'alice', followerCount: 10 }], 100);

    expect(preview).toContain('items=1');
    expect(preview).toContain('alice');
  });

  it('previews object content using useful fields', () => {
    const preview = previewContent(tweetEvent.params.content, 160);

    expect(preview).toContain('This is a long tweet body');
    expect(preview).toContain('tweet-1');
    expect(preview).toContain('elonmusk');
  });

  it('formats a one-line console summary', () => {
    expect(formatConsoleSummary(tweetEvent)).toBe(
      '[NEW_TWEET] @elonmusk 2026-04-27T01:02:03Z This is a long tweet body for preview testing | id=tweet-1 | user=elonmusk | url=https://example.com/post'
    );
  });

  it('formats a Telegram message', () => {
    expect(formatTelegramMessage(tweetEvent)).toContain('[OpenTwitter] NEW_TWEET');
    expect(formatTelegramMessage(tweetEvent)).toContain('Account: @elonmusk (Elon Musk)');
    expect(formatTelegramMessage(tweetEvent)).toContain('Profile: https://twitter.com/elonmusk');
  });

  it('formats a monitored account follow event clearly', () => {
    expect(formatConsoleSummary(followEvent)).toBe(
      '[NEW_FOLLOWER] @alice followed @bob (Bob Builder) 2026-04-27T03:04:05Z'
    );

    const telegramMessage = formatTelegramMessage(followEvent);

    expect(telegramMessage).toContain('[OpenTwitter] NEW_FOLLOWER');
    expect(telegramMessage).toContain('Monitored account: @alice (Alice)');
    expect(telegramMessage).toContain('Followed: @bob (Bob Builder)');
    expect(telegramMessage).toContain('Target profile: https://twitter.com/bob');
  });

  it('wraps raw messages in an NDJSON entry with receive time', () => {
    expect(makeNdjsonEntry(tweetEvent, '2026-04-27T10:00:00.000Z')).toEqual({
      receivedAt: '2026-04-27T10:00:00.000Z',
      message: tweetEvent
    });
  });
});
