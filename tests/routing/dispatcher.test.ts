import { describe, expect, it, vi } from 'vitest';
import type { Destination } from '@prisma/client';
import { createDispatcher, type DispatcherDeps } from '../../src/routing/dispatcher.js';

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: 1,
  telegramChatId: '-100',
  type: 'group',
  title: 't',
  username: null,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over
});

function makeDeps(over: Partial<DispatcherDeps> = {}): DispatcherDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    listDestinationsForSource: vi.fn().mockResolvedValue([
      { destination: dest({ id: 1, telegramChatId: '-100' }) },
      { destination: dest({ id: 2, telegramChatId: '-200' }) }
    ]),
    recordDelivery: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    ...over
  };
}

describe('dispatcher.fanOut', () => {
  it('sends to every subscribed destination and records ok', async () => {
    const deps = makeDeps();
    const dispatcher = createDispatcher(deps);
    await dispatcher.fanOut({ eventLogId: 99, sourceId: 10, text: 'hi' });

    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
    expect(deps.sendMessage).toHaveBeenNthCalledWith(1, '-100', 'hi');
    expect(deps.sendMessage).toHaveBeenNthCalledWith(2, '-200', 'hi');
    expect(deps.recordDelivery).toHaveBeenCalledTimes(2);
    expect(deps.recordDelivery).toHaveBeenNthCalledWith(1, {
      eventLogId: 99,
      destinationId: 1,
      status: 'ok'
    });
  });

  it('records error and continues when one destination fails', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    });
    const dispatcher = createDispatcher(deps);
    await dispatcher.fanOut({ eventLogId: 99, sourceId: 10, text: 'hi' });

    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
    expect(deps.recordDelivery).toHaveBeenNthCalledWith(1, {
      eventLogId: 99,
      destinationId: 1,
      status: 'error',
      error: 'boom'
    });
    expect(deps.recordDelivery).toHaveBeenNthCalledWith(2, {
      eventLogId: 99,
      destinationId: 2,
      status: 'ok'
    });
    expect(deps.warn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when source has no subscriptions', async () => {
    const deps = makeDeps({ listDestinationsForSource: vi.fn().mockResolvedValue([]) });
    const dispatcher = createDispatcher(deps);
    await dispatcher.fanOut({ eventLogId: 99, sourceId: 10, text: 'hi' });
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.recordDelivery).not.toHaveBeenCalled();
  });
});
