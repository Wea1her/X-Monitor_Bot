import { describe, expect, it, vi } from 'vitest';
import { performAddSource } from '../../src/bot/handlers/add-source.js';

const services = {
  sourceService: {
    create: vi.fn(),
    markRemoteWatchSynced: vi.fn(),
    markRemoteWatchError: vi.fn()
  }
};

function sourceRow(overrides = {}) {
  return {
    id: 7,
    type: 'twitter',
    target: 'elonmusk',
    normalizedTarget: 'elonmusk',
    configJson: {},
    enabled: true,
    remoteWatchStatus: 'pending',
    remoteWatchError: null,
    remoteWatchSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe('performAddSource', () => {
  it('creates source via service and returns success message', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: false
    });
    const result = await performAddSource(services as never, 'twitter', '@elonmusk');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已添加');
  });

  it('returns "already exists" when duplicate', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: true
    });
    const result = await performAddSource(services as never, 'twitter', 'elonmusk');
    expect(result.message).toContain('已存在 #7');
  });

  it('appends worker-not-available hint for website', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow({
        id: 8,
        type: 'website',
        target: 'https://x.com',
        normalizedTarget: 'https://x.com',
        remoteWatchStatus: 'not_applicable'
      }),
      alreadyExisted: false
    });
    const result = await performAddSource(services as never, 'website', 'https://x.com');
    expect(result.message).toContain('worker 暂未上线');
  });

  it('returns failure with adapter error message on validation error', async () => {
    services.sourceService.create = vi.fn().mockRejectedValue(new Error('Twitter 用户名仅允许字母...'));
    const result = await performAddSource(services as never, 'twitter', 'bad-user');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Twitter 用户名仅允许');
  });

  it('syncs a newly-created twitter source to 6551', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: false
    });
    services.sourceService.markRemoteWatchSynced = vi
      .fn()
      .mockResolvedValue(sourceRow({ remoteWatchStatus: 'synced' }));
    const registerWatch = vi.fn().mockResolvedValue({ ok: true, alreadyExists: false });

    const result = await performAddSource(services as never, 'twitter', '@elonmusk', { registerWatch });

    expect(registerWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.markRemoteWatchSynced).toHaveBeenCalledWith(7);
    expect(result.message).toContain('已同步到 6551');
  });

  it('does not sync an already-existing twitter source', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: true
    });
    const registerWatch = vi.fn();

    await performAddSource(services as never, 'twitter', '@elonmusk', { registerWatch });

    expect(registerWatch).not.toHaveBeenCalled();
  });

  it('records sync failure after local twitter source creation', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: false
    });
    services.sourceService.markRemoteWatchError = vi.fn().mockResolvedValue(sourceRow({ remoteWatchStatus: 'error' }));
    const registerWatch = vi.fn().mockResolvedValue({ ok: false, error: 'bad token' });

    const result = await performAddSource(services as never, 'twitter', '@elonmusk', { registerWatch });

    expect(services.sourceService.markRemoteWatchError).toHaveBeenCalledWith(7, 'bad token');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('6551 同步失败');
  });

  it('does not call 6551 for non-twitter sources', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow({
        id: 8,
        type: 'website',
        target: 'https://x.com',
        normalizedTarget: 'https://x.com',
        remoteWatchStatus: 'not_applicable'
      }),
      alreadyExisted: false
    });
    const registerWatch = vi.fn();

    await performAddSource(services as never, 'website', 'https://x.com', { registerWatch });

    expect(registerWatch).not.toHaveBeenCalled();
  });
});
