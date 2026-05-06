import type { EventLog, Prisma, PrismaClient } from '@prisma/client';
import type { RedisHelpers } from '../store/redis.js';

export interface RecordEventInput {
  sourceId: number | null;
  eventType: string;
  dedupeKey: string;
  rawJson: unknown;
  occurredAt?: Date;
}

export interface RecordEventResult {
  event: EventLog | null;
  deduped: boolean;
}

export interface RecordDeliveryInput {
  eventLogId: number | null;
  destinationId: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface EventService {
  recordEvent(input: RecordEventInput): Promise<RecordEventResult>;
  recordDelivery(input: RecordDeliveryInput): Promise<void>;
}

export function createEventService(
  prisma: PrismaClient,
  redis: Pick<RedisHelpers, 'tryClaimDedupe'>
): EventService {
  return {
    async recordEvent(input) {
      const claimed = await redis.tryClaimDedupe(input.dedupeKey);
      if (!claimed) {
        return { event: null, deduped: true };
      }
      try {
        const event = await prisma.eventLog.create({
          data: {
            sourceId: input.sourceId ?? null,
            eventType: input.eventType,
            dedupeKey: input.dedupeKey,
            rawJson: input.rawJson as Prisma.InputJsonValue,
            occurredAt: input.occurredAt ?? null
          }
        });
        return { event, deduped: false };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { event: null, deduped: true };
        }
        throw error;
      }
    },
    async recordDelivery(input) {
      await prisma.deliveryLog.create({
        data: {
          eventLogId: input.eventLogId,
          destinationId: input.destinationId,
          status: input.status,
          error: input.error ?? null,
          sentAt: new Date()
        }
      });
    }
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}
