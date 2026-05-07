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
        enabled: true,
        remoteWatchStatus: 'pending',
        remoteWatchError: null,
        remoteWatchSyncedAt: null
      }
    });
  });

  it('initializes twitter source remote watch status as pending', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.create.mockResolvedValue(fakeRow);

    await createSourceService(prisma).create({ type: 'twitter', input: '@ElonMusk' });

    expect(prisma.monitorSource.create).toHaveBeenCalledWith({
      data: {
        type: 'twitter',
        target: 'ElonMusk',
        normalizedTarget: 'elonmusk',
        configJson: {},
        enabled: true,
        remoteWatchStatus: 'pending',
        remoteWatchError: null,
        remoteWatchSyncedAt: null
      }
    });
  });

  it('initializes non-twitter source remote watch status as not_applicable', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.create.mockResolvedValue({
      ...fakeRow,
      type: 'website',
      target: 'https://example.com/',
      normalizedTarget: 'https://example.com/',
      remoteWatchStatus: 'not_applicable'
    });

    await createSourceService(prisma).create({ type: 'website', input: 'https://example.com' });

    expect(prisma.monitorSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'website',
        remoteWatchStatus: 'not_applicable',
        remoteWatchError: null,
        remoteWatchSyncedAt: null
      })
    });
  });

  it('marks remote watch sync success', async () => {
    const syncedAt = new Date('2026-05-06T10:00:00Z');
    prisma.monitorSource.findUnique.mockResolvedValue(fakeRow);
    prisma.monitorSource.update.mockResolvedValue({
      ...fakeRow,
      remoteWatchStatus: 'synced',
      remoteWatchSyncedAt: syncedAt
    });

    const result = await createSourceService(prisma).markRemoteWatchSynced(7, syncedAt);

    expect(result.remoteWatchStatus).toBe('synced');
    expect(prisma.monitorSource.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        remoteWatchStatus: 'synced',
        remoteWatchError: null,
        remoteWatchSyncedAt: syncedAt
      }
    });
  });

  it('rejects remote watch sync success for non-twitter source', async () => {
    const websiteRow = {
      ...fakeRow,
      type: 'website',
      target: 'https://example.com/',
      normalizedTarget: 'https://example.com/',
      remoteWatchStatus: 'not_applicable'
    };
    prisma.monitorSource.findUnique.mockResolvedValue(websiteRow);
    prisma.monitorSource.update.mockResolvedValue(websiteRow);

    await expect(createSourceService(prisma).markRemoteWatchSynced(7)).rejects.toThrow(
      'Remote watch sync state is only supported for twitter sources'
    );
    expect(prisma.monitorSource.update).not.toHaveBeenCalled();
  });

  it('rejects remote watch sync success for missing source', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.update.mockResolvedValue(fakeRow);

    await expect(createSourceService(prisma).markRemoteWatchSynced(7)).rejects.toThrow(
      'Remote watch sync state is only supported for twitter sources'
    );
    expect(prisma.monitorSource.update).not.toHaveBeenCalled();
  });

  it('marks remote watch sync error', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(fakeRow);
    prisma.monitorSource.update.mockResolvedValue({
      ...fakeRow,
      remoteWatchStatus: 'error',
      remoteWatchError: 'bad token'
    });

    const result = await createSourceService(prisma).markRemoteWatchError(7, 'bad token');

    expect(result.remoteWatchStatus).toBe('error');
    expect(prisma.monitorSource.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        remoteWatchStatus: 'error',
        remoteWatchError: 'bad token'
      }
    });
  });

  it('rejects remote watch sync error for non-twitter source', async () => {
    const websiteRow = {
      ...fakeRow,
      type: 'website',
      target: 'https://example.com/',
      normalizedTarget: 'https://example.com/',
      remoteWatchStatus: 'not_applicable'
    };
    prisma.monitorSource.findUnique.mockResolvedValue(websiteRow);
    prisma.monitorSource.update.mockResolvedValue(websiteRow);

    await expect(createSourceService(prisma).markRemoteWatchError(7, 'bad token')).rejects.toThrow(
      'Remote watch sync state is only supported for twitter sources'
    );
    expect(prisma.monitorSource.update).not.toHaveBeenCalled();
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
