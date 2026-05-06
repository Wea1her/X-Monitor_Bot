import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_monitor';
const prisma = new PrismaClient({ datasources: { db: { url } } });

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

describe('prisma roundtrip', () => {
  it('creates and reads MonitorSource via unique key', async () => {
    const created = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: 'integration-user',
        normalizedTarget: 'integration-user',
        configJson: {},
        enabled: true
      }
    });
    const found = await prisma.monitorSource.findUnique({
      where: { type_normalizedTarget: { type: 'twitter', normalizedTarget: 'integration-user' } }
    });
    expect(found?.id).toBe(created.id);
  });

  it('cascades subscription when source is deleted', async () => {
    const source = await prisma.monitorSource.create({
      data: { type: 'twitter', target: 'tmp', normalizedTarget: 'tmp', configJson: {}, enabled: true }
    });
    const dest = await prisma.destination.create({
      data: { telegramChatId: '-100777', type: 'group', enabled: true }
    });
    await prisma.subscription.create({ data: { sourceId: source.id, destinationId: dest.id, enabled: true } });
    await prisma.monitorSource.delete({ where: { id: source.id } });
    expect(await prisma.subscription.count({ where: { sourceId: source.id } })).toBe(0);
  });

  it('rejects duplicate normalized target via unique constraint', async () => {
    await prisma.monitorSource.create({
      data: { type: 'twitter', target: 'dupe', normalizedTarget: 'dupe', configJson: {}, enabled: true }
    });
    await expect(
      prisma.monitorSource.create({
        data: { type: 'twitter', target: 'dupe', normalizedTarget: 'dupe', configJson: {}, enabled: true }
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
