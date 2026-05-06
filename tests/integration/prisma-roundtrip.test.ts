import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_monitor';
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TEST_SOURCE_TARGETS = [
  '__test_prisma_roundtrip_integration_user__',
  '__test_prisma_roundtrip_tmp__',
  '__test_prisma_roundtrip_dupe__'
];
const TEST_DEST_CHAT_IDS = ['-100777001'];

async function cleanup(): Promise<void> {
  await prisma.subscription.deleteMany({
    where: {
      OR: [
        { source: { normalizedTarget: { in: TEST_SOURCE_TARGETS } } },
        { destination: { telegramChatId: { in: TEST_DEST_CHAT_IDS } } }
      ]
    }
  });
  await prisma.monitorSource.deleteMany({ where: { normalizedTarget: { in: TEST_SOURCE_TARGETS } } });
  await prisma.destination.deleteMany({ where: { telegramChatId: { in: TEST_DEST_CHAT_IDS } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('prisma roundtrip', () => {
  it('creates and reads MonitorSource via unique key', async () => {
    const created = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: '__test_prisma_roundtrip_integration_user__',
        normalizedTarget: '__test_prisma_roundtrip_integration_user__',
        configJson: {},
        enabled: true
      }
    });
    const found = await prisma.monitorSource.findUnique({
      where: {
        type_normalizedTarget: {
          type: 'twitter',
          normalizedTarget: '__test_prisma_roundtrip_integration_user__'
        }
      }
    });
    expect(found?.id).toBe(created.id);
  });

  it('cascades subscription when source is deleted', async () => {
    const source = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: '__test_prisma_roundtrip_tmp__',
        normalizedTarget: '__test_prisma_roundtrip_tmp__',
        configJson: {},
        enabled: true
      }
    });
    const dest = await prisma.destination.create({
      data: { telegramChatId: '-100777001', type: 'group', enabled: true }
    });
    await prisma.subscription.create({ data: { sourceId: source.id, destinationId: dest.id, enabled: true } });
    await prisma.monitorSource.delete({ where: { id: source.id } });
    expect(await prisma.subscription.count({ where: { sourceId: source.id } })).toBe(0);
  });

  it('rejects duplicate normalized target via unique constraint', async () => {
    await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: '__test_prisma_roundtrip_dupe__',
        normalizedTarget: '__test_prisma_roundtrip_dupe__',
        configJson: {},
        enabled: true
      }
    });
    await expect(
      prisma.monitorSource.create({
        data: {
          type: 'twitter',
          target: '__test_prisma_roundtrip_dupe__',
          normalizedTarget: '__test_prisma_roundtrip_dupe__',
          configJson: {},
          enabled: true
        }
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
