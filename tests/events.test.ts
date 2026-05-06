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
        description: 'Building useful things.',
        followerCount: 1234
      }
    ]
  }
};

const unfollowEvent = {
  jsonrpc: '2.0',
  method: 'twitter.event',
  params: {
    id: 789,
    twAccount: 'alice',
    twUserName: 'Alice',
    profileUrl: 'https://twitter.com/alice',
    eventType: 'NEW_UNFOLLOWER',
    createdAt: '2026-04-27T05:06:07Z',
    content: [
      {
        twAccount: 'charlie',
        twUserName: 'Charlie',
        profileUrl: 'https://twitter.com/charlie',
        bio: 'Independent researcher.'
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
    expect(formatTelegramMessage(tweetEvent)).toBe(
      [
        '[OpenTwitter] NEW_TWEET',
        '账号：@elonmusk (Elon Musk)',
        '时间：2026-04-27T01:02:03Z',
        '主页：https://twitter.com/elonmusk',
        '内容：This is a long tweet body for preview testing | id=tweet-1 | user=elonmusk | url=https://example.com/post'
      ].join('\n')
    );
  });

  it('formats a monitored account follow event clearly', () => {
    expect(formatConsoleSummary(followEvent)).toBe(
      '[NEW_FOLLOWER] @alice followed @bob (Bob Builder) 2026-04-27T03:04:05Z'
    );

    const telegramMessage = formatTelegramMessage(followEvent);

    expect(telegramMessage).toBe(
      [
        '[OpenTwitter] 新增关注',
        '监控账号：@alice (Alice)',
        '关注了：@bob (Bob Builder)',
        '简介：Building useful things.',
        '目标主页：https://twitter.com/bob'
      ].join('\n')
    );
  });

  it('formats a monitored account unfollow event clearly in Chinese', () => {
    expect(formatTelegramMessage(unfollowEvent)).toBe(
      [
        '[OpenTwitter] 取消关注',
        '监控账号：@alice (Alice)',
        '取关了：@charlie (Charlie)',
        '简介：Independent researcher.',
        '目标主页：https://twitter.com/charlie'
      ].join('\n')
    );
  });

  it('wraps raw messages in an NDJSON entry with receive time', () => {
    expect(makeNdjsonEntry(tweetEvent, '2026-04-27T10:00:00.000Z')).toEqual({
      receivedAt: '2026-04-27T10:00:00.000Z',
      message: tweetEvent
    });
  });
});
