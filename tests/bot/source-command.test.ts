import { describe, expect, it, vi } from 'vitest';
import { handleExplicitSourceEnabledCommand } from '../../src/bot/main.js';

describe('handleExplicitSourceEnabledCommand', () => {
  it('uses source-actions toggle when the requested enabled state changes', async () => {
    const ctx = { reply: vi.fn() };
    const sourceService = {
      findById: vi.fn().mockResolvedValue({ id: 7, enabled: false })
    };
    const sourceActions = {
      toggle: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined)
    };

    await handleExplicitSourceEnabledCommand(ctx as never, sourceService as never, sourceActions as never, 7, true);

    expect(sourceActions.toggle).toHaveBeenCalledWith(ctx, 7);
    expect(sourceActions.show).not.toHaveBeenCalled();
  });

  it('shows the source without toggling when it is already in the requested state', async () => {
    const ctx = { reply: vi.fn() };
    const sourceService = {
      findById: vi.fn().mockResolvedValue({ id: 7, enabled: true })
    };
    const sourceActions = {
      toggle: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined)
    };

    await handleExplicitSourceEnabledCommand(ctx as never, sourceService as never, sourceActions as never, 7, true);

    expect(sourceActions.toggle).not.toHaveBeenCalled();
    expect(sourceActions.show).toHaveBeenCalledWith(ctx, 7);
  });
});
