import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createMutualFollowService } from '../../src/services/mutual-follow-service.js';

let prisma: DeepMockProxy<PrismaClient>;

const firstSeen = new Date('2026-05-06T01:00:00Z');

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

function row(account: string, name?: string) {
  return {
    id: account.charCodeAt(0),
    targetAccount: 'target',
    targetName: 'Target',
    targetProfileUrl: 'https://twitter.com/target',
    targetBio: 'Target bio',
    followerAccount: account,
    followerName: name ?? account.toUpperCase(),
    sourceId: account.charCodeAt(0),
    firstSeenAt: firstSeen,
    lastSeenAt: firstSeen
  };
}

describe('mutualFollowService.record', () => {
  it('stores the first monitor follow without notification', async () => {
    prisma.mutualFollow.findUnique.mockResolvedValue(null);
    prisma.mutualFollow.create.mockResolvedValue(row('a', 'A'));
    prisma.mutualFollow.findMany.mockResolvedValue([row('a', 'A')]);

    const service = createMutualFollowService(prisma);
    const result = await service.record({
      sourceId: 1,
      followerAccount: '@A',
      followerName: 'A',
      targetAccount: '@Target',
      targetName: 'Target',
      targetProfileUrl: 'https://twitter.com/target',
      targetBio: 'Target bio'
    });

    expect(result).toEqual({
      inserted: true,
      total: 1,
      accounts: [{ account: 'a', name: 'A' }],
      emphasis: 'none',
      shouldNotify: false
    });
    expect(prisma.mutualFollow.create).toHaveBeenCalledWith({
      data: {
        sourceId: 1,
        followerAccount: 'a',
        followerName: 'A',
        targetAccount: 'target',
        targetName: 'Target',
        targetProfileUrl: 'https://twitter.com/target',
        targetBio: 'Target bio'
      }
    });
  });

  it('notifies when the second monitor follows the same target', async () => {
    prisma.mutualFollow.findUnique.mockResolvedValue(null);
    prisma.mutualFollow.create.mockResolvedValue(row('b', 'B'));
    prisma.mutualFollow.findMany.mockResolvedValue([row('a', 'A'), row('b', 'B')]);

    const result = await createMutualFollowService(prisma).record({
      sourceId: 2,
      followerAccount: 'b',
      followerName: 'B',
      targetAccount: 'target'
    });

    expect(result.total).toBe(2);
    expect(result.shouldNotify).toBe(true);
    expect(result.emphasis).toBe('none');
    expect(result.accounts.map((account) => account.account)).toEqual(['a', 'b']);
  });

  it('marks third and fourth monitor follows as warming', async () => {
    prisma.mutualFollow.findUnique.mockResolvedValue(null);
    prisma.mutualFollow.create.mockResolvedValue(row('c', 'C'));
    prisma.mutualFollow.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);

    const result = await createMutualFollowService(prisma).record({
      sourceId: 3,
      followerAccount: 'c',
      targetAccount: 'target'
    });

    expect(result.total).toBe(3);
    expect(result.shouldNotify).toBe(true);
    expect(result.emphasis).toBe('warming');
  });

  it('marks five or more monitor follows as hot', async () => {
    prisma.mutualFollow.findUnique.mockResolvedValue(null);
    prisma.mutualFollow.create.mockResolvedValue(row('e', 'E'));
    prisma.mutualFollow.findMany.mockResolvedValue([row('a'), row('b'), row('c'), row('d'), row('e')]);

    const result = await createMutualFollowService(prisma).record({
      sourceId: 5,
      followerAccount: 'e',
      targetAccount: 'target'
    });

    expect(result.total).toBe(5);
    expect(result.emphasis).toBe('hot');
  });

  it('does not notify duplicate target/follower relationships', async () => {
    prisma.mutualFollow.findUnique.mockResolvedValue(row('a', 'A'));
    prisma.mutualFollow.update.mockResolvedValue(row('a', 'A'));
    prisma.mutualFollow.findMany.mockResolvedValue([row('a'), row('b')]);

    const result = await createMutualFollowService(prisma).record({
      sourceId: 1,
      followerAccount: 'a',
      targetAccount: 'target'
    });

    expect(result.inserted).toBe(false);
    expect(result.shouldNotify).toBe(false);
    expect(prisma.mutualFollow.create).not.toHaveBeenCalled();
  });
});
