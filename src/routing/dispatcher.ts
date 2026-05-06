import type { Destination } from '@prisma/client';

export interface DispatchEvent {
  eventLogId: number;
  sourceId: number;
  text: string;
}

export interface DispatcherDeps {
  sendMessage(chatId: string, text: string): Promise<void>;
  listDestinationsForSource(sourceId: number): Promise<Array<{ destination: Destination }>>;
  recordDelivery(input: {
    eventLogId: number;
    destinationId: number;
    status: 'ok' | 'error';
    error?: string;
  }): Promise<void>;
  warn?: (message: string) => void;
}

export interface Dispatcher {
  fanOut(event: DispatchEvent): Promise<void>;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const warn = deps.warn ?? console.warn;
  return {
    async fanOut(event) {
      const rows = await deps.listDestinationsForSource(event.sourceId);
      for (const row of rows) {
        try {
          await deps.sendMessage(row.destination.telegramChatId, event.text);
          await deps.recordDelivery({
            eventLogId: event.eventLogId,
            destinationId: row.destination.id,
            status: 'ok'
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warn(`dispatcher send failed for chat ${row.destination.telegramChatId}: ${message}`);
          await deps.recordDelivery({
            eventLogId: event.eventLogId,
            destinationId: row.destination.id,
            status: 'error',
            error: message
          });
        }
      }
    }
  };
}
