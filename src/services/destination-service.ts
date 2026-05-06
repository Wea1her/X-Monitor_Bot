import type { Destination, PrismaClient } from '@prisma/client';

export interface DiscoverInput {
  telegramChatId: string;
  type: string;
  title: string | null;
  username: string | null;
}

export interface DiscoverResult {
  destination: Destination;
  isNew: boolean;
}

export interface DestinationService {
  discover(input: DiscoverInput): Promise<DiscoverResult>;
  list(): Promise<Destination[]>;
  listEnabled(): Promise<Destination[]>;
  setEnabled(id: number, enabled: boolean): Promise<Destination>;
  remove(id: number): Promise<void>;
  findById(id: number): Promise<Destination | null>;
}

export function createDestinationService(prisma: PrismaClient): DestinationService {
  return {
    async discover(input) {
      const before = await prisma.destination.findUnique({
        where: { telegramChatId: input.telegramChatId }
      });
      const destination = await prisma.destination.upsert({
        where: { telegramChatId: input.telegramChatId },
        create: {
          telegramChatId: input.telegramChatId,
          type: input.type,
          title: input.title,
          username: input.username,
          enabled: false
        },
        update: {
          type: input.type,
          title: input.title,
          username: input.username
        }
      });
      return { destination, isNew: before == null };
    },
    list() {
      return prisma.destination.findMany({ orderBy: { id: 'asc' } });
    },
    listEnabled() {
      return prisma.destination.findMany({
        where: { enabled: true },
        orderBy: { id: 'asc' }
      });
    },
    setEnabled(id, enabled) {
      return prisma.destination.update({ where: { id }, data: { enabled } });
    },
    async remove(id) {
      await prisma.destination.delete({ where: { id } });
    },
    findById(id) {
      return prisma.destination.findUnique({ where: { id } });
    }
  };
}
