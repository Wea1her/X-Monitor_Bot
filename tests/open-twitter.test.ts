import { describe, expect, it, vi } from 'vitest';
import { addWatchAccounts, buildWatchAddPayload } from '../src/open-twitter.js';

describe('buildWatchAddPayload', () => {
  it('enables new follow and unfollow observation for a username', () => {
    expect(buildWatchAddPayload('elonmusk')).toEqual({
      username: 'elonmusk',
      newTweetBol: false,
      newFlwBol: true,
      newUnFlwBol: true,
      newTweetReplyBol: false,
      newTweetQuoteBol: false,
      newRetweetBol: false,
      updateNameBol: false,
      updateDescBol: false,
      updateAvatarBol: false,
      updateBannerBol: false,
      newCaBol: false,
      tweetToppingBol: false
    });
  });
});

describe('addWatchAccounts', () => {
  it('posts every account with Bearer authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}'
    });

    await addWatchAccounts({
      token: 'token-123',
      accounts: ['elonmusk', 'jack'],
      fetch: fetchMock,
      info: vi.fn(),
      warn: vi.fn()
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://ai.6551.io/open/twitter_watch_add',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildWatchAddPayload('elonmusk'))
      }
    );
  });

  it('logs one account failure and continues with the next account', async () => {
    const warnMock = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server error'
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"ok":true}'
      });

    await addWatchAccounts({
      token: 'token-123',
      accounts: ['bad', 'good'],
      fetch: fetchMock,
      info: vi.fn(),
      warn: warnMock
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith(
      'watch-add failed for @bad: 500 server error'
    );
  });
});
