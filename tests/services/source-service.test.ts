import { describe, expect, it, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createSourceService } from '../../src/services/source-service.js';

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

const fakeRow = {
  id: 1,
  type: 'twitter',
  target: 'elonmusk',
  normalizedTarget: 'elonmusk',
  configJson: {},
  enabled: true,
  remoteWatchStatus: 'pending',
  remoteWatchError: null,
  remoteWatchSyncedAt: null,
  createdAt: new Date('2026-05-05'),
  updatedAt: new Date('2026-05-05')
};

describe('sourceService.create', () => {
  it('validates via adapter and creates a new source', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.create.mockResolvedValue(fakeRow);

    const service = createSourceService(prisma);
    const created = await service.create({ type: 'twitter', input: '@ElonMusk' });

    expect(created).toEqual({ source: fakeRow, alreadyExisted: false });
    expect(prisma.monitorSource.create).toHaveBeenCalledWith({
      data: {
        type: 'twitter',
        target: 'ElonMusk',
        normalizedTarget: 'elonmusk',
        configJson: {},
        enabled: true
      }
    });
  });

  it('returns existing source when duplicate', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(fakeRow);

    const service = createSourceService(prisma);
    const result = await service.create({ type: 'twitter', input: 'elonmusk' });

    expect(result).toEqual({ source: fakeRow, alreadyExisted: true });
    expect(prisma.monitorSource.create).not.toHaveBeenCalled();
  });

  it('throws ValidationError for unknown type', async () => {
    const service = createSourceService(prisma);
    await expect(service.create({ type: 'btc', input: 'foo' })).rejects.toThrow('Unknown monitor type: btc');
  });

  it('lists sources sorted by id', async () => {
    prisma.monitorSource.findMany.mockResolvedValue([fakeRow]);
    const service = createSourceService(prisma);
    expect(await service.list()).toEqual([fakeRow]);
    expect(prisma.monitorSource.findMany).toHaveBeenCalledWith({ orderBy: { id: 'asc' } });
  });

  it('toggles enabled', async () => {
    prisma.monitorSource.update.mockResolvedValue({ ...fakeRow, enabled: false });
    const service = createSourceService(prisma);
    const updated = await service.setEnabled(1, false);
    expect(updated.enabled).toBe(false);
    expect(prisma.monitorSource.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { enabled: false } });
  });

  it('removes a source', async () => {
    prisma.monitorSource.delete.mockResolvedValue(fakeRow);
    const service = createSourceService(prisma);
    await service.remove(1);
    expect(prisma.monitorSource.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('lists enabled twitter sources for the worker', async () => {
    prisma.monitorSource.findMany.mockResolvedValue([fakeRow]);
    const service = createSourceService(prisma);
    expect(await service.listEnabledTwitterSources()).toEqual([fakeRow]);
    expect(prisma.monitorSource.findMany).toHaveBeenCalledWith({
      where: { type: 'twitter', enabled: true },
      orderBy: { id: 'asc' }
    });
  });
});
