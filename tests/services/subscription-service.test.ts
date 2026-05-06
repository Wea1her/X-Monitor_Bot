import { describe, expect, it, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createSubscriptionService } from '../../src/services/subscription-service.js';

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe('subscriptionService', () => {
  it('upserts subscription idempotently', async () => {
    prisma.subscription.upsert.mockResolvedValue({
      id: 1,
      sourceId: 10,
      destinationId: 20,
      enabled: true,
      createdAt: new Date()
    });
    const service = createSubscriptionService(prisma);
    await service.subscribe(10, 20);
    expect(prisma.subscription.upsert).toHaveBeenCalledWith({
      where: { sourceId_destinationId: { sourceId: 10, destinationId: 20 } },
      create: { sourceId: 10, destinationId: 20, enabled: true },
      update: { enabled: true }
    });
  });

  it('removes subscription if exists', async () => {
    prisma.subscription.deleteMany.mockResolvedValue({ count: 1 });
    const service = createSubscriptionService(prisma);
    expect(await service.unsubscribe(10, 20)).toBe(true);
    expect(prisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { sourceId: 10, destinationId: 20 }
    });
  });

  it('reports false when nothing to unsubscribe', async () => {
    prisma.subscription.deleteMany.mockResolvedValue({ count: 0 });
    const service = createSubscriptionService(prisma);
    expect(await service.unsubscribe(10, 20)).toBe(false);
  });

  it('lists destinations subscribed to a source (only enabled)', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    const service = createSubscriptionService(prisma);
    await service.listDestinationsForSource(10);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { sourceId: 10, enabled: true, destination: { enabled: true } },
      include: { destination: true }
    });
  });

  it('lists destinations subscribed to a source by id list', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    const service = createSubscriptionService(prisma);
    await service.listDestinationIdsForSource(10);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { sourceId: 10 },
      select: { destinationId: true }
    });
  });
});
