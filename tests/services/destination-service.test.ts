import { describe, expect, it, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createDestinationService } from '../../src/services/destination-service.js';

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

const fakeRow = {
  id: 5,
  telegramChatId: '-1001234567890',
  type: 'group',
  title: 'my_alerts',
  username: null,
  enabled: false,
  createdAt: new Date('2026-05-05'),
  updatedAt: new Date('2026-05-05')
};

describe('destinationService', () => {
  it('upserts auto-discovered destination as disabled', async () => {
    prisma.destination.upsert.mockResolvedValue(fakeRow);
    const service = createDestinationService(prisma);
    const result = await service.discover({
      telegramChatId: '-1001234567890',
      type: 'group',
      title: 'my_alerts',
      username: null
    });
    expect(result).toEqual({ destination: fakeRow, isNew: true });
    expect(prisma.destination.upsert).toHaveBeenCalledWith({
      where: { telegramChatId: '-1001234567890' },
      create: {
        telegramChatId: '-1001234567890',
        type: 'group',
        title: 'my_alerts',
        username: null,
        enabled: false
      },
      update: { type: 'group', title: 'my_alerts', username: null }
    });
  });

  it('reports isNew=false when discover hits existing record', async () => {
    prisma.destination.findUnique.mockResolvedValue(fakeRow);
    prisma.destination.upsert.mockResolvedValue(fakeRow);
    const service = createDestinationService(prisma);
    const { isNew } = await service.discover({
      telegramChatId: '-1001234567890',
      type: 'group',
      title: 'my_alerts',
      username: null
    });
    expect(isNew).toBe(false);
  });

  it('lists destinations ordered by id', async () => {
    prisma.destination.findMany.mockResolvedValue([fakeRow]);
    const service = createDestinationService(prisma);
    expect(await service.list()).toEqual([fakeRow]);
  });

  it('toggles enabled', async () => {
    prisma.destination.update.mockResolvedValue({ ...fakeRow, enabled: true });
    const service = createDestinationService(prisma);
    const updated = await service.setEnabled(5, true);
    expect(updated.enabled).toBe(true);
  });

  it('lists enabled destinations only', async () => {
    prisma.destination.findMany.mockResolvedValue([{ ...fakeRow, enabled: true }]);
    const service = createDestinationService(prisma);
    await service.listEnabled();
    expect(prisma.destination.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: { id: 'asc' }
    });
  });

  it('removes a destination', async () => {
    prisma.destination.delete.mockResolvedValue(fakeRow);
    const service = createDestinationService(prisma);
    await service.remove(5);
    expect(prisma.destination.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});
