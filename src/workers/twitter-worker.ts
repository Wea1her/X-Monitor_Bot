import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import {
  extractFirstFollowTarget,
  formatTelegramMessage,
  type MutualFollowSummary,
  type TwitterEventMessage
} from '../events.js';
import { addWatchAccounts } from '../open-twitter.js';
import { getBackoffDelayMs } from '../util/backoff.js';

const FOLLOW_EVENT_TYPE = 'NEW_FOLLOWER';

export interface HandleWorkerDeps {
  findSourceIdByAccount(account: string): Promise<number | null>;
  recordEvent(input: {
    sourceId: number;
    eventType: string;
    dedupeKey: string;
    rawJson: unknown;
  }): Promise<{ event: { id: number } | null; deduped: boolean }>;
  recordMutualFollow(input: {
    sourceId: number;
    followerAccount: string;
    followerName?: string;
    targetAccount: string;
    targetName?: string;
    targetProfileUrl?: string;
    targetBio?: string;
  }): Promise<MutualFollowSummary & { inserted: boolean; shouldNotify: boolean }>;
  fanOut(event: { eventLogId: number; sourceId: number; text: string }): Promise<void>;
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export function buildDedupeKey(message: TwitterEventMessage): string {
  const params = message.params ?? {};
  const account = params.twAccount ?? 'unknown';
  const eventType = params.eventType ?? 'UNKNOWN';
  const content = params.content as Record<string, unknown> | undefined;
  const id = content && typeof content === 'object' ? content.id : undefined;
  if (typeof id === 'string' || typeof id === 'number') {
    return `tw:${account}:${eventType}:${id}`;
  }
  const digest = createHash('sha1').update(JSON.stringify(content ?? null)).digest('hex');
  return `tw:${account}:${eventType}:${digest}`;
}

export function buildEventText(message: TwitterEventMessage, mutualFollow?: MutualFollowSummary): string {
  return formatTelegramMessage(message, mutualFollow);
}

export async function handleWorkerPayload(raw: string, deps: HandleWorkerDeps): Promise<void> {
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
  const account = message.params?.twAccount;
  if (!account) {
    warn('twitter.event missing twAccount');
    return;
  }
  const sourceId = await deps.findSourceIdByAccount(account);
  if (sourceId === null) {
    info(`twitter.event for unmonitored account @${account}`);
    return;
  }
  const dedupeKey = buildDedupeKey(message);
  const eventType = message.params?.eventType ?? 'UNKNOWN';
  const recorded = await deps.recordEvent({
    sourceId,
    eventType,
    dedupeKey,
    rawJson: message
  });
  if (recorded.deduped || !recorded.event) {
    info(`event deduped: ${dedupeKey}`);
    return;
  }

  if (eventType === FOLLOW_EVENT_TYPE) {
    const target = extractFirstFollowTarget(message.params?.content);
    if (!target) {
      warn('NEW_FOLLOWER missing target account');
      return;
    }
    const mutualFollow = await deps.recordMutualFollow({
      sourceId,
      followerAccount: account,
      followerName: message.params?.twUserName,
      targetAccount: target.account,
      targetName: target.name,
      targetProfileUrl: target.profileUrl,
      targetBio: target.bio
    });
    if (!mutualFollow.shouldNotify) {
      info(`mutual follow stored without notification: @${account} -> @${target.account}`);
      return;
    }
    await deps.fanOut({
      eventLogId: recorded.event.id,
      sourceId,
      text: buildEventText(message, mutualFollow)
    });
    return;
  }

  await deps.fanOut({
    eventLogId: recorded.event.id,
    sourceId,
    text: buildEventText(message)
  });
}

export interface StartTwitterWorkerOptions {
  twitterToken: string;
  watchAccounts: string[];
  deps: HandleWorkerDeps;
  webSocketFactory?: (url: string) => WebSocket;
}

export function buildWebSocketUrl(token: string): string {
  return `wss://ai.6551.io/open/twitter_wss?token=${encodeURIComponent(token)}`;
}

export function buildSubscribeMessage(): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'twitter.subscribe' });
}

export async function startTwitterWorker(options: StartTwitterWorkerOptions): Promise<() => void> {
  await addWatchAccounts({
    token: options.twitterToken,
    accounts: options.watchAccounts
  });

  let closedByUser = false;
  let attempt = 0;
  let socket: WebSocket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const factory = options.webSocketFactory ?? ((url) => new WebSocket(url));

  const connect = (): void => {
    socket = factory(buildWebSocketUrl(options.twitterToken));
    socket.on('open', () => {
      attempt = 0;
      console.info('Twitter worker WSS connected');
      socket?.send(buildSubscribeMessage());
    });
    socket.on('message', (data) => {
      void handleWorkerPayload(data.toString(), options.deps);
    });
    socket.on('error', (error) => {
      console.warn(`Twitter worker WSS error: ${error instanceof Error ? error.message : String(error)}`);
    });
    socket.on('close', () => {
      if (closedByUser) return;
      const delay = getBackoffDelayMs(attempt);
      attempt += 1;
      console.warn(`Twitter worker WSS disconnected, reconnecting in ${Math.round(delay)}ms`);
      reconnectTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return () => {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
