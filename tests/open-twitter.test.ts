import { describe, expect, it, vi } from 'vitest';
import {
  addWatchAccount,
  addWatchAccounts,
  buildWatchAddPayload,
  deleteWatchAccount
} from '../src/open-twitter.js';

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

describe('addWatchAccount', () => {
  it('returns synced when watch-add succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"success":true}'
    });

    const result = await addWatchAccount({
      token: 'token-123',
      account: 'elonmusk',
      fetch: fetchMock
    });

    expect(result).toEqual({ ok: true, alreadyExists: false });
    expect(fetchMock).toHaveBeenCalledWith('https://ai.6551.io/open/twitter_watch_add', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildWatchAddPayload('elonmusk'))
    });
  });

  it('treats already-in-watch-list as success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"该Twitter账号已在监控列表中","success":false}'
    });

    await expect(addWatchAccount({ token: 'token-123', account: 'elonmusk', fetch: fetchMock })).resolves.toEqual({
      ok: true,
      alreadyExists: true
    });
  });

  it('returns an error for unexpected watch-add failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error'
    });

    await expect(addWatchAccount({ token: 'token-123', account: 'bad', fetch: fetchMock })).resolves.toEqual({
      ok: false,
      error: 'watch-add failed for @bad: 500 server error'
    });
  });

  it('does not treat a 500 already-in-watch-list response as success', async () => {
    const body = '{"error":"该Twitter账号已在监控列表中","success":false}';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => body
    });

    await expect(addWatchAccount({ token: 'token-123', account: 'elonmusk', fetch: fetchMock })).resolves.toEqual({
      ok: false,
      error: `watch-add failed for @elonmusk: 500 ${body}`
    });
  });
});

describe('deleteWatchAccount', () => {
  it('posts username to twitter_watch_delete', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"success":true}'
    });

    const result = await deleteWatchAccount({
      token: 'token-123',
      account: 'elonmusk',
      fetch: fetchMock
    });

    expect(result).toEqual({ ok: true, alreadyMissing: false });
    expect(fetchMock).toHaveBeenCalledWith('https://ai.6551.io/open/twitter_watch_delete', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'elonmusk' })
    });
  });

  it('treats missing remote watch as delete success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"该Twitter账号不在监控列表中","success":false}'
    });

    await expect(deleteWatchAccount({ token: 'token-123', account: 'elonmusk', fetch: fetchMock })).resolves.toEqual({
      ok: true,
      alreadyMissing: true
    });
  });

  it('does not treat a 500 missing-watch response as success', async () => {
    const body = '{"error":"该Twitter账号不在监控列表中","success":false}';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => body
    });

    await expect(deleteWatchAccount({ token: 'token-123', account: 'elonmusk', fetch: fetchMock })).resolves.toEqual({
      ok: false,
      error: `watch-delete failed for @elonmusk: 500 ${body}`
    });
  });
});
