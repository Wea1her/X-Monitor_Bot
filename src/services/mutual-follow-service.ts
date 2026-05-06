import type { MutualFollow, PrismaClient } from '@prisma/client';

export type MutualFollowEmphasis = 'none' | 'warming' | 'hot';

export interface RecordMutualFollowInput {
  sourceId: number;
  followerAccount: string;
  followerName?: string;
  targetAccount: string;
  targetName?: string;
  targetProfileUrl?: string;
  targetBio?: string;
}

export interface MutualFollowAccount {
  account: string;
  name?: string;
}

export interface MutualFollowResult {
  inserted: boolean;
  total: number;
  accounts: MutualFollowAccount[];
  emphasis: MutualFollowEmphasis;
  shouldNotify: boolean;
}

export interface MutualFollowService {
  record(input: RecordMutualFollowInput): Promise<MutualFollowResult>;
}

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, '').trim().toLowerCase();
}

export function createMutualFollowService(prisma: PrismaClient): MutualFollowService {
  return {
    async record(input) {
      const targetAccount = normalizeHandle(input.targetAccount);
      const followerAccount = normalizeHandle(input.followerAccount);
      const where = { targetAccount_followerAccount: { targetAccount, followerAccount } };
      const existing = await prisma.mutualFollow.findUnique({ where });

      let inserted = false;
      if (existing) {
        await prisma.mutualFollow.update({
          where,
          data: {
            sourceId: input.sourceId,
            followerName: input.followerName ?? existing.followerName,
            targetName: input.targetName ?? existing.targetName,
            targetProfileUrl: input.targetProfileUrl ?? existing.targetProfileUrl,
            targetBio: input.targetBio ?? existing.targetBio
          }
        });
      } else {
        inserted = true;
        await prisma.mutualFollow.create({
          data: {
            sourceId: input.sourceId,
            followerAccount,
            followerName: input.followerName,
            targetAccount,
            targetName: input.targetName,
            targetProfileUrl: input.targetProfileUrl,
            targetBio: input.targetBio
          }
        });
      }

      const rows = await prisma.mutualFollow.findMany({
        where: {
          targetAccount,
          source: { is: { type: 'twitter', enabled: true } }
        },
        orderBy: { firstSeenAt: 'asc' }
      });
      return toResult(inserted, rows);
    }
  };
}

function toResult(inserted: boolean, rows: MutualFollow[]): MutualFollowResult {
  const accounts = rows.map((row) => ({
    account: row.followerAccount,
    name: row.followerName ?? undefined
  }));
  const total = accounts.length;
  return {
    inserted,
    total,
    accounts,
    emphasis: getEmphasis(total),
    shouldNotify: inserted && total >= 2
  };
}

function getEmphasis(total: number): MutualFollowEmphasis {
  if (total >= 5) return 'hot';
  if (total >= 3) return 'warming';
  return 'none';
}
