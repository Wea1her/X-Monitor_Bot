import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createEventService } from '../../src/services/event-service.js';

let prisma: DeepMockProxy<PrismaClient>;
const redisHelpers = {
  tryClaimDedupe: vi.fn<(key: string) => Promise<boolean>>(),
  getOffset: vi.fn(),
  setOffset: vi.fn()
};

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  redisHelpers.tryClaimDedupe.mockReset();
});

const fakeEvent = {
  id: 1,
  sourceId: 10,
  eventType: 'NEW_TWEET',
  dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
  rawJson: { foo: 'bar' },
  occurredAt: null,
  receivedAt: new Date()
};

describe('eventService.recordEvent', () => {
  it('claims dedupe and writes event_log', async () => {
    redisHelpers.tryClaimDedupe.mockResolvedValue(true);
    prisma.eventLog.create.mockResolvedValue(fakeEvent);
    const service = createEventService(prisma, redisHelpers);
    const out = await service.recordEvent({
      sourceId: 10,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
      rawJson: { foo: 'bar' }
    });
    expect(out).toEqual({ event: fakeEvent, deduped: false });
  });

  it('returns deduped=true when dedupe claim fails (redis says dup)', async () => {
    redisHelpers.tryClaimDedupe.mockResolvedValue(false);
    const service = createEventService(prisma, redisHelpers);
    const out = await service.recordEvent({
      sourceId: 10,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
      rawJson: {}
    });
    expect(out).toEqual({ event: null, deduped: true });
    expect(prisma.eventLog.create).not.toHaveBeenCalled();
  });

  it('falls back to PG unique-constraint dedupe when redis allowed but PG conflicts', async () => {
    redisHelpers.tryClaimDedupe.mockResolvedValue(true);
    const error = Object.assign(new Error('unique violation'), { code: 'P2002' });
    prisma.eventLog.create.mockRejectedValue(error);
    const service = createEventService(prisma, redisHelpers);
    const out = await service.recordEvent({
      sourceId: 10,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
      rawJson: {}
    });
    expect(out).toEqual({ event: null, deduped: true });
  });
});

describe('eventService.recordDelivery', () => {
  it('writes delivery_log success row', async () => {
    prisma.deliveryLog.create.mockResolvedValue({
      id: 1,
      eventLogId: 1,
      destinationId: 5,
      status: 'ok',
      error: null,
      sentAt: new Date()
    });
    const service = createEventService(prisma, redisHelpers);
    await service.recordDelivery({ eventLogId: 1, destinationId: 5, status: 'ok' });
    expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventLogId: 1,
        destinationId: 5,
        status: 'ok',
        error: null
      })
    });
  });

  it('writes delivery_log error row with message', async () => {
    prisma.deliveryLog.create.mockResolvedValue({
      id: 2,
      eventLogId: 1,
      destinationId: 5,
      status: 'error',
      error: 'boom',
      sentAt: new Date()
    });
    const service = createEventService(prisma, redisHelpers);
    await service.recordDelivery({ eventLogId: 1, destinationId: 5, status: 'error', error: 'boom' });
    expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'error', error: 'boom' })
    });
  });
});
