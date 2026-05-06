import { PrismaClient } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDispatcher } from '../../src/routing/dispatcher.js';
import { createEventService } from '../../src/services/event-service.js';
import { createSubscriptionService } from '../../src/services/subscription-service.js';
import { createRedisHelpers, type RedisLike } from '../../src/store/redis.js';

const url = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_monitor';
const prisma = new PrismaClient({ datasources: { db: { url } } });
const redis = new RedisMock() as unknown as RedisLike;
const redisHelpers = createRedisHelpers(redis);
const TEST_SOURCE_TARGET = '__test_dispatcher_e2e__';
const TEST_DEST_CHAT_ID = '-200001';
const TEST_DEDUPE_KEY = 'tw:__test_dispatcher_e2e__:NEW_TWEET:1';

async function cleanup(): Promise<void> {
  const events = await prisma.eventLog.findMany({
    where: { dedupeKey: TEST_DEDUPE_KEY },
    select: { id: true }
  });
  const destinations = await prisma.destination.findMany({
    where: { telegramChatId: TEST_DEST_CHAT_ID },
    select: { id: true }
  });
  await prisma.deliveryLog.deleteMany({
    where: {
      OR: [
        { eventLogId: { in: events.map((event) => event.id) } },
        { destinationId: { in: destinations.map((destination) => destination.id) } }
      ]
    }
  });
  await prisma.eventLog.deleteMany({ where: { dedupeKey: TEST_DEDUPE_KEY } });
  await prisma.subscription.deleteMany({
    where: {
      OR: [
        { source: { normalizedTarget: TEST_SOURCE_TARGET } },
        { destination: { telegramChatId: TEST_DEST_CHAT_ID } }
      ]
    }
  });
  await prisma.monitorSource.deleteMany({ where: { normalizedTarget: TEST_SOURCE_TARGET } });
  await prisma.destination.deleteMany({ where: { telegramChatId: TEST_DEST_CHAT_ID } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('dispatcher end-to-end (real PG + mock redis + mock telegram)', () => {
  it('records event and fans out to all enabled destinations', async () => {
    const source = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: TEST_SOURCE_TARGET,
        normalizedTarget: TEST_SOURCE_TARGET,
        configJson: {},
        enabled: true
      }
    });
    const dest = await prisma.destination.create({
      data: { telegramChatId: TEST_DEST_CHAT_ID, type: 'group', enabled: true }
    });
    await prisma.subscription.create({ data: { sourceId: source.id, destinationId: dest.id, enabled: true } });

    const subscriptionService = createSubscriptionService(prisma);
    const eventService = createEventService(prisma, redisHelpers);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createDispatcher({
      sendMessage,
      listDestinationsForSource: subscriptionService.listDestinationsForSource,
      recordDelivery: eventService.recordDelivery
    });

    const recorded = await eventService.recordEvent({
      sourceId: source.id,
      eventType: 'NEW_TWEET',
      dedupeKey: TEST_DEDUPE_KEY,
      rawJson: { hello: 'world' }
    });
    expect(recorded.deduped).toBe(false);
    expect(recorded.event).not.toBeNull();
    await dispatcher.fanOut({ eventLogId: recorded.event!.id, sourceId: source.id, text: 'hi' });

    expect(sendMessage).toHaveBeenCalledWith(TEST_DEST_CHAT_ID, 'hi');
    const deliveries = await prisma.deliveryLog.findMany({ where: { eventLogId: recorded.event!.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('ok');

    const second = await eventService.recordEvent({
      sourceId: source.id,
      eventType: 'NEW_TWEET',
      dedupeKey: TEST_DEDUPE_KEY,
      rawJson: {}
    });
    expect(second.deduped).toBe(true);
  });
});
