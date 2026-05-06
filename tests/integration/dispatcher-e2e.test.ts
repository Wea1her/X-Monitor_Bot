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

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.deliveryLog.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.monitorSource.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.$disconnect();
});

describe('dispatcher end-to-end (real PG + mock redis + mock telegram)', () => {
  it('records event and fans out to all enabled destinations', async () => {
    const source = await prisma.monitorSource.create({
      data: { type: 'twitter', target: 'e2e', normalizedTarget: 'e2e', configJson: {}, enabled: true }
    });
    const dest = await prisma.destination.create({
      data: { telegramChatId: '-200', type: 'group', enabled: true }
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
      dedupeKey: 'tw:e2e:NEW_TWEET:1',
      rawJson: { hello: 'world' }
    });
    expect(recorded.deduped).toBe(false);
    expect(recorded.event).not.toBeNull();
    await dispatcher.fanOut({ eventLogId: recorded.event!.id, sourceId: source.id, text: 'hi' });

    expect(sendMessage).toHaveBeenCalledWith('-200', 'hi');
    const deliveries = await prisma.deliveryLog.findMany({ where: { eventLogId: recorded.event!.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('ok');

    const second = await eventService.recordEvent({
      sourceId: source.id,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:e2e:NEW_TWEET:1',
      rawJson: {}
    });
    expect(second.deduped).toBe(true);
  });
});
