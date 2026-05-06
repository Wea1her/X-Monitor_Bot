import type { MonitorSource, Prisma, PrismaClient } from '@prisma/client';
import { getAdapter } from '../monitors/registry.js';

export interface CreateSourceInput {
  type: string;
  input: string;
}

export interface CreateSourceResult {
  source: MonitorSource;
  alreadyExisted: boolean;
}

export type RemoteWatchStatus = 'pending' | 'synced' | 'error' | 'not_applicable';

export interface SourceService {
  create(input: CreateSourceInput): Promise<CreateSourceResult>;
  list(): Promise<MonitorSource[]>;
  setEnabled(id: number, enabled: boolean): Promise<MonitorSource>;
  remove(id: number): Promise<void>;
  listEnabledTwitterSources(): Promise<MonitorSource[]>;
  findById(id: number): Promise<MonitorSource | null>;
  markRemoteWatchSynced(id: number, syncedAt?: Date): Promise<MonitorSource>;
  markRemoteWatchError(id: number, error: string): Promise<MonitorSource>;
}

export function createSourceService(prisma: PrismaClient): SourceService {
  return {
    async create({ type, input }) {
      const adapter = getAdapter(type);
      const normalized = await adapter.validateTarget(input);
      const existing = await prisma.monitorSource.findUnique({
        where: { type_normalizedTarget: { type, normalizedTarget: normalized.normalizedTarget } }
      });
      if (existing) {
        return { source: existing, alreadyExisted: true };
      }
      const created = await prisma.monitorSource.create({
        data: {
          type,
          target: normalized.target,
          normalizedTarget: normalized.normalizedTarget,
          configJson: normalized.configJson as Prisma.InputJsonValue,
          enabled: true,
          remoteWatchStatus: type === 'twitter' ? 'pending' : 'not_applicable',
          remoteWatchError: null,
          remoteWatchSyncedAt: null
        }
      });
      return { source: created, alreadyExisted: false };
    },
    list() {
      return prisma.monitorSource.findMany({ orderBy: { id: 'asc' } });
    },
    setEnabled(id, enabled) {
      return prisma.monitorSource.update({ where: { id }, data: { enabled } });
    },
    async remove(id) {
      await prisma.monitorSource.delete({ where: { id } });
    },
    listEnabledTwitterSources() {
      return prisma.monitorSource.findMany({
        where: { type: 'twitter', enabled: true },
        orderBy: { id: 'asc' }
      });
    },
    findById(id) {
      return prisma.monitorSource.findUnique({ where: { id } });
    },
    markRemoteWatchSynced(id, syncedAt = new Date()) {
      return prisma.monitorSource.update({
        where: { id },
        data: {
          remoteWatchStatus: 'synced',
          remoteWatchError: null,
          remoteWatchSyncedAt: syncedAt
        }
      });
    },
    markRemoteWatchError(id, error) {
      return prisma.monitorSource.update({
        where: { id },
        data: {
          remoteWatchStatus: 'error',
          remoteWatchError: error
        }
      });
    }
  };
}
