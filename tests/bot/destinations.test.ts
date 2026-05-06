import { describe, expect, it, vi } from 'vitest';
import { createDestinationsHandler } from '../../src/bot/handlers/destinations.js';

const fakeDest = {
  id: 5,
  telegramChatId: '-100',
  type: 'group',
  title: 't',
  username: null,
  enabled: false,
  createdAt: new Date(),
  updatedAt: new Date()
};

function makeService() {
  return {
    list: vi.fn().mockResolvedValue([fakeDest]),
    setEnabled: vi.fn().mockResolvedValue({ ...fakeDest, enabled: true }),
    findById: vi.fn().mockResolvedValue(fakeDest),
    remove: vi.fn().mockResolvedValue(undefined)
  };
}

describe('destinations handler', () => {
  it('lists destinations', async () => {
    const service = makeService();
    const handler = createDestinationsHandler(service as never);
    const reply = vi.fn();
    await handler.list({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('推送目标'),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('toggles enabled', async () => {
    const service = makeService();
    const handler = createDestinationsHandler(service as never);
    const reply = vi.fn();
    await handler.toggle({ reply } as never, 5);
    expect(service.setEnabled).toHaveBeenCalledWith(5, true);
  });

  it('ignores destination by deleting it', async () => {
    const service = makeService();
    const handler = createDestinationsHandler(service as never);
    const reply = vi.fn();
    await handler.ignore({ reply } as never, 5);
    expect(service.remove).toHaveBeenCalledWith(5);
  });
});
