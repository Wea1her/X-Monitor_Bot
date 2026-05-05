import WebSocket from 'ws';
import type { AppConfig, TelegramConfig } from './config.js';
import { appendEventLog as appendEventLogImpl } from './event-log.js';
import {
  formatConsoleSummary,
  formatTelegramMessage,
  makeNdjsonEntry,
  type NdjsonEntry,
  type TwitterEventMessage
} from './events.js';
import { sendTelegramMessage as sendTelegramMessageImpl } from './telegram.js';

export interface HandlePayloadDeps {
  logDir: string;
  telegram?: TelegramConfig;
  watchAccounts?: string[];
  now?: () => string;
  appendEventLog?: (logDir: string, entry: NdjsonEntry) => Promise<void>;
  sendTelegramMessage?: (
    telegram: TelegramConfig | undefined,
    text: string
  ) => Promise<void>;
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export function buildWebSocketUrl(token: string): string {
  return `wss://ai.6551.io/open/twitter_wss?token=${encodeURIComponent(token)}`;
}

export function buildSubscribeMessage(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'twitter.subscribe'
  });
}

export function getReconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

const FOLLOW_EVENT_TYPES = new Set(['NEW_FOLLOWER', 'NEW_UNFOLLOWER']);

function shouldKeepEvent(
  message: TwitterEventMessage,
  watchAccounts: string[] | undefined
): boolean {
  const eventType = message.params?.eventType;
  if (!eventType || !FOLLOW_EVENT_TYPES.has(eventType)) {
    return false;
  }

  if (!watchAccounts || watchAccounts.length === 0) {
    return true;
  }

  const account = message.params?.twAccount;
  if (!account) {
    return false;
  }

  const normalizedAccount = account.toLowerCase();
  return watchAccounts.some((watchAccount) => watchAccount.toLowerCase() === normalizedAccount);
}

export async function handleWebSocketPayload(
  raw: string,
  deps: HandlePayloadDeps
): Promise<void> {
  const info = deps.info ?? console.info;
  const warn = deps.warn ?? console.warn;
  let message: TwitterEventMessage;

  try {
    message = JSON.parse(raw) as TwitterEventMessage;
  } catch {
    warn('Invalid WSS message JSON ignored');
    return;
  }

  if (message.method !== 'twitter.event') {
    info(`WSS message: ${JSON.stringify(message)}`);
    return;
  }

  if (!shouldKeepEvent(message, deps.watchAccounts)) {
    info(`WSS event filtered: [${message.params?.eventType}] ${message.params?.twAccount ?? 'unknown'}`);
    return;
  }

  info(formatConsoleSummary(message));

  const entry = makeNdjsonEntry(
    message,
    deps.now ? deps.now() : new Date().toISOString()
  );
  await (deps.appendEventLog ?? appendEventLogImpl)(deps.logDir, entry);
  await (deps.sendTelegramMessage ?? sendTelegramMessageImpl)(
    deps.telegram,
    formatTelegramMessage(message)
  );
}

export function startWebSocketProbe(config: AppConfig): () => void {
  let closedByUser = false;
  let reconnectAttempt = 0;
  let socket: WebSocket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const connect = () => {
    socket = new WebSocket(buildWebSocketUrl(config.twitterToken));

    socket.on('open', () => {
      reconnectAttempt = 0;
      console.info('OpenTwitter WSS connected');
      socket?.send(buildSubscribeMessage());
    });

    socket.on('message', (data) => {
      void handleWebSocketPayload(data.toString(), {
        logDir: config.logDir,
        telegram: config.telegram,
        watchAccounts: config.watchAccounts
      });
    });

    socket.on('error', (error) => {
      console.warn(
        `OpenTwitter WSS error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

    socket.on('close', () => {
      if (closedByUser) {
        return;
      }
      const delay = getReconnectDelayMs(reconnectAttempt);
      reconnectAttempt += 1;
      console.warn(`OpenTwitter WSS disconnected, reconnecting in ${delay}ms`);
      reconnectTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return () => {
    closedByUser = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    socket?.close();
  };
}
