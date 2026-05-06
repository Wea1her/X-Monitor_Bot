import { describe, expect, it, vi } from 'vitest';
import { createSourceActionsHandler } from '../../src/bot/handlers/source-actions.js';

const fakeSource = {
  id: 1,
  type: 'twitter',
  target: 'elonmusk',
  normalizedTarget: 'elonmusk',
  configJson: {},
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

function makeServices() {
  return {
    sourceService: {
      findById: vi.fn().mockResolvedValue(fakeSource),
      setEnabled: vi.fn().mockResolvedValue({ ...fakeSource, enabled: false }),
      remove: vi.fn().mockResolvedValue(undefined)
    },
    destinationService: {
      listEnabled: vi.fn().mockResolvedValue([])
    },
    subscriptionService: {
      listDestinationIdsForSource: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(true)
    }
  };
}

describe('source-actions handler', () => {
  it('shows source detail with action keyboard', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services as never);
    const reply = vi.fn();
    await handler.show({ reply, answerCallbackQuery: vi.fn() } as never, 1);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('#1'),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('toggles enabled', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services as never);
    const reply = vi.fn();
    await handler.toggle({ reply, answerCallbackQuery: vi.fn() } as never, 1);
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(1, false);
  });

  it('deletes source', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services as never);
    const reply = vi.fn();
    await handler.delete({ reply, answerCallbackQuery: vi.fn() } as never, 1);
    expect(services.sourceService.remove).toHaveBeenCalledWith(1);
  });

  it('subscribe-toggle adds subscription if missing', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services as never);
    await handler.toggleSubscription(
      { answerCallbackQuery: vi.fn(), editMessageReplyMarkup: vi.fn(), editMessageText: vi.fn() } as never,
      1,
      5
    );
    expect(services.subscriptionService.subscribe).toHaveBeenCalledWith(1, 5);
  });

  it('subscribe-toggle removes subscription if present', async () => {
    const services = makeServices();
    services.subscriptionService.listDestinationIdsForSource = vi.fn().mockResolvedValue([5]);
    const handler = createSourceActionsHandler(services as never);
    await handler.toggleSubscription(
      { answerCallbackQuery: vi.fn(), editMessageReplyMarkup: vi.fn(), editMessageText: vi.fn() } as never,
      1,
      5
    );
    expect(services.subscriptionService.unsubscribe).toHaveBeenCalledWith(1, 5);
  });
});
