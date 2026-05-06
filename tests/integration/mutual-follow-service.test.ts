import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMutualFollowService } from '../../src/services/mutual-follow-service.js';

const url = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_monitor';
const prisma = new PrismaClient({ datasources: { db: { url } } });
const target = '__test_mutual_follow_target__';
const sourceA = '__test_mutual_follow_a__';
const sourceB = '__test_mutual_follow_b__';
const sourceC = '__test_mutual_follow_c__';
const targets = [target];
const sourceTargets = [sourceA, sourceB, sourceC];

async function cleanup(): Promise<void> {
  await prisma.mutualFollow.deleteMany({
    where: {
      OR: [
        { targetAccount: { in: targets } },
        { followerAccount: { in: sourceTargets } }
      ]
    }
  });
  await prisma.monitorSource.deleteMany({ where: { normalizedTarget: { in: sourceTargets } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('mutual follow service integration', () => {
  it('stores first follow silently and notifies on the second enabled source', async () => {
    const a = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: sourceA,
        normalizedTarget: sourceA,
        configJson: {},
        enabled: true
      }
    });
    const b = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: sourceB,
        normalizedTarget: sourceB,
        configJson: {},
        enabled: true
      }
    });
    const service = createMutualFollowService(prisma);

    const first = await service.record({
      sourceId: a.id,
      followerAccount: sourceA,
      targetAccount: target
    });

    expect(first.shouldNotify).toBe(false);
    expect(first.total).toBe(1);

    const second = await service.record({
      sourceId: b.id,
      followerAccount: sourceB,
      targetAccount: target
    });

    expect(second.shouldNotify).toBe(true);
    expect(second.total).toBe(2);
    expect(second.accounts.map((account) => account.account)).toEqual([sourceA, sourceB]);
  });

  it('does not count disabled sources in later totals', async () => {
    await prisma.monitorSource.update({
      where: { type_normalizedTarget: { type: 'twitter', normalizedTarget: sourceA } },
      data: { enabled: false }
    });
    const c = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: sourceC,
        normalizedTarget: sourceC,
        configJson: {},
        enabled: true
      }
    });

    const result = await createMutualFollowService(prisma).record({
      sourceId: c.id,
      followerAccount: sourceC,
      targetAccount: target
    });

    expect(result.total).toBe(2);
    expect(result.accounts.map((account) => account.account)).toEqual([sourceB, sourceC]);
  });
});
