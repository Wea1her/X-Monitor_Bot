import { describe, expect, it, vi } from 'vitest';
import { createSourceActionsHandler } from '../../src/bot/handlers/source-actions.js';

function fakeSource(overrides = {}) {
  return {
    id: 1,
    type: 'twitter',
    target: 'elonmusk',
    normalizedTarget: 'elonmusk',
    configJson: {},
    enabled: true,
    remoteWatchStatus: 'synced',
    remoteWatchError: null,
    remoteWatchSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeServices() {
  const source = fakeSource();
  return {
    sourceService: {
      findById: vi.fn().mockResolvedValue(source),
      setEnabled: vi.fn().mockResolvedValue({ ...source, enabled: false }),
      remove: vi.fn().mockResolvedValue(undefined),
      markRemoteWatchSynced: vi.fn().mockResolvedValue(source),
      markRemoteWatchError: vi.fn().mockResolvedValue(source)
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

function fakeCtx() {
  return {
    reply: vi.fn(),
    answerCallbackQuery: vi.fn(),
    editMessageReplyMarkup: vi.fn(),
    editMessageText: vi.fn()
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

  it('deletes remote watch before disabling a twitter source', async () => {
    const services = makeServices();
    const source = fakeSource({ enabled: true, type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.setEnabled.mockResolvedValue({ ...source, enabled: false });
    services.sourceService.markRemoteWatchSynced.mockResolvedValue(source);
    const unregisterWatch = vi.fn().mockResolvedValue({ ok: true, alreadyMissing: false });
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(unregisterWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(source.id, false);
  });

  it('does not disable locally when remote watch delete fails', async () => {
    const services = makeServices();
    const source = fakeSource({ enabled: true, type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.markRemoteWatchError.mockResolvedValue(source);
    const unregisterWatch = vi.fn().mockResolvedValue({ ok: false, error: 'bad token' });
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(services.sourceService.setEnabled).not.toHaveBeenCalled();
    expect(services.sourceService.markRemoteWatchError).toHaveBeenCalledWith(source.id, 'bad token');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('6551 同步失败'));
  });

  it('adds remote watch before enabling a twitter source', async () => {
    const services = makeServices();
    const source = fakeSource({ enabled: false, type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.setEnabled.mockResolvedValue({ ...source, enabled: true });
    services.sourceService.markRemoteWatchSynced.mockResolvedValue(source);
    const registerWatch = vi.fn().mockResolvedValue({ ok: true, alreadyExists: false });
    const handler = createSourceActionsHandler(services as never, { registerWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(registerWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(source.id, true);
  });

  it('deletes remote watch before removing a twitter source', async () => {
    const services = makeServices();
    const source = fakeSource({ type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.remove.mockResolvedValue(undefined);
    services.sourceService.markRemoteWatchSynced.mockResolvedValue(source);
    const unregisterWatch = vi.fn().mockResolvedValue({ ok: true, alreadyMissing: false });
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.delete(ctx as never, source.id);

    expect(unregisterWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.remove).toHaveBeenCalledWith(source.id);
  });

  it('does not call 6551 for non-twitter source toggle', async () => {
    const services = makeServices();
    const source = fakeSource({ type: 'website', enabled: true, normalizedTarget: 'https://example.com/' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.setEnabled.mockResolvedValue({ ...source, enabled: false });
    const unregisterWatch = vi.fn();
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(unregisterWatch).not.toHaveBeenCalled();
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(source.id, false);
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
