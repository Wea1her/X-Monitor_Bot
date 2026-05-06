import type { Destination, PrismaClient, Subscription } from '@prisma/client';

export type SubscriptionWithDestination = Subscription & { destination: Destination };

export interface SubscriptionService {
  subscribe(sourceId: number, destinationId: number): Promise<void>;
  unsubscribe(sourceId: number, destinationId: number): Promise<boolean>;
  listDestinationsForSource(sourceId: number): Promise<SubscriptionWithDestination[]>;
  listDestinationIdsForSource(sourceId: number): Promise<number[]>;
}

export function createSubscriptionService(prisma: PrismaClient): SubscriptionService {
  return {
    async subscribe(sourceId, destinationId) {
      await prisma.subscription.upsert({
        where: { sourceId_destinationId: { sourceId, destinationId } },
        create: { sourceId, destinationId, enabled: true },
        update: { enabled: true }
      });
    },
    async unsubscribe(sourceId, destinationId) {
      const result = await prisma.subscription.deleteMany({
        where: { sourceId, destinationId }
      });
      return result.count > 0;
    },
    listDestinationsForSource(sourceId) {
      return prisma.subscription.findMany({
        where: { sourceId, enabled: true, destination: { enabled: true } },
        include: { destination: true }
      }) as Promise<SubscriptionWithDestination[]>;
    },
    async listDestinationIdsForSource(sourceId) {
      const rows = await prisma.subscription.findMany({
        where: { sourceId },
        select: { destinationId: true }
      });
      return rows.map((row) => row.destinationId);
    }
  };
}
