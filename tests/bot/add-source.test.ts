import { describe, expect, it, vi } from 'vitest';
import { performAddSource } from '../../src/bot/handlers/add-source.js';

const services = {
  sourceService: {
    create: vi.fn()
  }
};

describe('performAddSource', () => {
  it('creates source via service and returns success message', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: {
        id: 7,
        type: 'twitter',
        target: 'elonmusk',
        normalizedTarget: 'elonmusk',
        configJson: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      alreadyExisted: false
    });
    const result = await performAddSource(services as never, 'twitter', '@elonmusk');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已添加');
  });

  it('returns "already exists" when duplicate', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: {
        id: 7,
        type: 'twitter',
        target: 'elonmusk',
        normalizedTarget: 'elonmusk',
        configJson: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      alreadyExisted: true
    });
    const result = await performAddSource(services as never, 'twitter', 'elonmusk');
    expect(result.message).toContain('已存在 #7');
  });

  it('appends worker-not-available hint for website', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: {
        id: 8,
        type: 'website',
        target: 'https://x.com',
        normalizedTarget: 'https://x.com',
        configJson: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
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
});
