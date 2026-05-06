import { describe, expect, it, vi } from 'vitest';
import { createListSourcesHandler } from '../../src/bot/handlers/list-sources.js';

const fakeSource = {
  id: 1,
  type: 'twitter',
  target: 'elonmusk',
  normalizedTarget: 'elonmusk',
  configJson: {},
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date()
} as never;

describe('listSources handler', () => {
  it('replies "无监控源" when list empty', async () => {
    const reply = vi.fn();
    const handler = createListSourcesHandler({ list: vi.fn().mockResolvedValue([]) } as never);
    await handler({ reply } as never);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('无监控源'), expect.anything());
  });

  it('renders one button per source', async () => {
    const reply = vi.fn();
    const handler = createListSourcesHandler({
      list: vi.fn().mockResolvedValue([fakeSource])
    } as never);
    await handler({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('监控源'),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
