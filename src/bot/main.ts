import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import {
  conversations,
  createConversation,
  type ConversationFlavor
} from '@grammyjs/conversations';
import { Bot, session, type Context, type SessionFlavor } from 'grammy';
import { parseBotConfig } from '../config.js';
import {
  addWatchAccount,
  deleteWatchAccount,
  type AddWatchAccountResult,
  type DeleteWatchAccountResult,
  type WatchMutationOptions
} from '../open-twitter.js';
import { createDispatcher } from '../routing/dispatcher.js';
import { createDestinationService } from '../services/destination-service.js';
import { createEventService } from '../services/event-service.js';
import { createMutualFollowService } from '../services/mutual-follow-service.js';
import { createSourceService, type SourceService } from '../services/source-service.js';
import { createSubscriptionService } from '../services/subscription-service.js';
import { getPrismaClient, disconnectPrisma } from '../store/prisma.js';
import { createRedisClient, createRedisHelpers } from '../store/redis.js';
import { startTwitterWorker } from '../workers/twitter-worker.js';
import { decodeCallback } from './callback-data.js';
import {
  ADD_SOURCE_CONVERSATION,
  createAddSourceConversation,
  createAddSourceEntry,
  performAddSource
} from './handlers/add-source.js';
import { handleChatMemberUpdate } from './handlers/chat-member.js';
import { createDestinationsHandler } from './handlers/destinations.js';
import { createListSourcesHandler } from './handlers/list-sources.js';
import { createSourceActionsHandler, type ServicesBundle } from './handlers/source-actions.js';
import { handleStart } from './handlers/start.js';
import { mainMenu } from './keyboards.js';
import { attachErrorHandler } from './middleware/error-handler.js';
import { createOwnerGuard } from './middleware/owner-guard.js';
import { CANCELLED, RETRY, STALE_BUTTON } from './messages.js';

type SessionData = Record<string, never>;
type BaseContext = Context & SessionFlavor<SessionData>;
type AppContext = ConversationFlavor<BaseContext>;

const ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'my_chat_member',
  'edited_message'
] as const;

interface WatchSynchronizerDeps {
  addWatchAccount?: (options: WatchMutationOptions) => Promise<AddWatchAccountResult>;
  deleteWatchAccount?: (options: WatchMutationOptions) => Promise<DeleteWatchAccountResult>;
}

export function createWatchSynchronizer(twitterToken: string, deps: WatchSynchronizerDeps = {}) {
  const add = deps.addWatchAccount ?? addWatchAccount;
  const remove = deps.deleteWatchAccount ?? deleteWatchAccount;
  return {
    registerWatch: (account: string) => add({ token: twitterToken, account }),
    unregisterWatch: (account: string) => remove({ token: twitterToken, account })
  };
}

type SourceActions = Pick<ReturnType<typeof createSourceActionsHandler>, 'show' | 'toggle'>;

export async function handleExplicitSourceEnabledCommand(
  ctx: Context,
  sourceService: Pick<SourceService, 'findById'>,
  sourceActions: SourceActions,
  sourceId: number,
  enabled: boolean
): Promise<void> {
  const source = await sourceService.findById(sourceId);
  if (!source) {
    await ctx.reply(STALE_BUTTON);
    return;
  }
  if (source.enabled !== enabled) {
    await sourceActions.toggle(ctx, sourceId);
    return;
  }
  await sourceActions.show(ctx, sourceId);
}

async function replayPendingUpdates(bot: Bot<AppContext>, offset: number): Promise<void> {
  let nextOffset = offset;
  let handledAny = false;

  for (;;) {
    const updates = await bot.api.getUpdates({
      offset: nextOffset,
      limit: 100,
      timeout: 0,
      allowed_updates: ALLOWED_UPDATES
    });
    if (updates.length === 0) {
      break;
    }
    for (const update of updates) {
      await bot.handleUpdate(update);
      nextOffset = update.update_id + 1;
      handledAny = true;
    }
  }

  if (handledAny) {
    await bot.api.getUpdates({ offset: nextOffset, limit: 1, timeout: 0 });
  }
}

export async function main(): Promise<void> {
  const config = parseBotConfig(process.env);

  const prisma = getPrismaClient();
  await prisma.$connect();

  const redis = createRedisClient(config.redisUrl);
  await redis.ping();
  const redisHelpers = createRedisHelpers(redis);

  const sourceService = createSourceService(prisma);
  const destinationService = createDestinationService(prisma);
  const subscriptionService = createSubscriptionService(prisma);
  const eventService = createEventService(prisma, redisHelpers);
  const mutualFollowService = createMutualFollowService(prisma);

  const services: ServicesBundle = {
    sourceService,
    destinationService,
    subscriptionService
  };
  const watchSynchronizer = createWatchSynchronizer(config.twitterToken);

  const bot = new Bot<AppContext>(config.telegramBotToken);
  attachErrorHandler(bot);

  const listSources = createListSourcesHandler(sourceService);
  const sourceActions = createSourceActionsHandler(services, watchSynchronizer);
  const destinations = createDestinationsHandler(destinationService);
  const addSourceEntry = createAddSourceEntry();

  const dispatcher = createDispatcher({
    sendMessage: async (chatId, text) => {
      await bot.api.sendMessage(chatId, text);
    },
    listDestinationsForSource: (sourceId) => subscriptionService.listDestinationsForSource(sourceId),
    recordDelivery: (delivery) => eventService.recordDelivery(delivery)
  });

  // Track the most recent update id so polling progress can be persisted.
  let lastUpdateId: number | undefined;
  bot.use(async (ctx, next) => {
    lastUpdateId = ctx.update.update_id;
    await next();
  });

  bot.on('my_chat_member', async (ctx) => {
    await handleChatMemberUpdate(ctx.myChatMember, {
      botId: bot.botInfo.id,
      ownerUserIds: config.ownerUserIds,
      discover: destinationService.discover,
      api: bot.api
    });
  });

  bot.use(createOwnerGuard(config.ownerUserIds));
  bot.use(session<SessionData, Context>({ initial: () => ({}) }));
  bot.use(conversations<BaseContext, Context>());
  bot.use(
    createConversation<BaseContext, Context>(
      createAddSourceConversation(services, watchSynchronizer),
      ADD_SOURCE_CONVERSATION
    )
  );

  bot.command(['start', 'menu'], (ctx) => handleStart.start(ctx));
  bot.command('help', (ctx) => handleStart.help(ctx));
  bot.command('cancel', async (ctx) => {
    await ctx.conversation.exitAll();
    await ctx.reply(CANCELLED, { reply_markup: mainMenu() });
  });
  bot.command('list', listSources);
  bot.command('destinations', destinations.list);

  bot.command('add', async (ctx) => {
    const args = (ctx.match ?? '').toString().trim().split(/\s+/);
    if (args.length < 2 || !args[0] || !args[1]) {
      await ctx.reply('用法：/add <type> <target>');
      return;
    }
    const [type, ...rest] = args;
    const result = await performAddSource(services, type, rest.join(' '), watchSynchronizer);
    await ctx.reply(result.message, { reply_markup: mainMenu() });
  });

  bot.command('remove', async (ctx) => {
    const id = Number.parseInt((ctx.match ?? '').toString().trim(), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply('用法：/remove <id>');
      return;
    }
    await sourceActions.delete(ctx, id);
  });

  bot.command('enable', async (ctx) => {
    const id = Number.parseInt((ctx.match ?? '').toString().trim(), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply('用法：/enable <id>');
      return;
    }
    await handleExplicitSourceEnabledCommand(ctx, sourceService, sourceActions, id, true);
  });

  bot.command('disable', async (ctx) => {
    const id = Number.parseInt((ctx.match ?? '').toString().trim(), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply('用法：/disable <id>');
      return;
    }
    await handleExplicitSourceEnabledCommand(ctx, sourceService, sourceActions, id, false);
  });

  bot.callbackQuery(/.+/, async (ctx) => {
    const payload = decodeCallback(ctx.callbackQuery.data ?? '');
    if (!payload) {
      await ctx.answerCallbackQuery({ text: STALE_BUTTON });
      return;
    }
    try {
      switch (payload.action) {
        case 'menu':
          await ctx.answerCallbackQuery();
          await handleStart.start(ctx);
          break;
        case 'help':
          await ctx.answerCallbackQuery();
          await handleStart.help(ctx);
          break;
        case 'src.list':
          await ctx.answerCallbackQuery();
          await listSources(ctx);
          break;
        case 'src.show':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.show(ctx, payload.id);
          break;
        case 'src.toggle':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.toggle(ctx, payload.id);
          break;
        case 'src.delete':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.delete(ctx, payload.id);
          break;
        case 'src.subs':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.subscriptionPicker(ctx, payload.id);
          break;
        case 'src.sub.toggle':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined && payload.arg) {
            const destId = Number.parseInt(payload.arg, 10);
            if (Number.isFinite(destId)) {
              await sourceActions.toggleSubscription(ctx, payload.id, destId);
            }
          }
          break;
        case 'dest.list':
          await ctx.answerCallbackQuery();
          await destinations.list(ctx);
          break;
        case 'dest.toggle':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await destinations.toggle(ctx, payload.id);
          break;
        case 'dest.ignore':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await destinations.ignore(ctx, payload.id);
          break;
        case 'add.start':
          await ctx.answerCallbackQuery();
          await addSourceEntry(ctx);
          break;
        case 'add.type':
          await ctx.answerCallbackQuery();
          break;
        default:
          await ctx.answerCallbackQuery({ text: STALE_BUTTON });
      }
    } catch (error) {
      console.error('callback handler failed:', error);
      try {
        await ctx.reply(RETRY);
      } catch {
        // Ignore reply errors in fallback path.
      }
    }
  });

  await bot.init();
  await bot.api.setMyCommands([
    { command: 'start', description: '主菜单' },
    { command: 'menu', description: '主菜单' },
    { command: 'help', description: '使用说明' },
    { command: 'list', description: '监控源列表' },
    { command: 'destinations', description: '推送目标列表' },
    { command: 'add', description: '添加监控：/add <type> <target>' },
    { command: 'remove', description: '删除：/remove <id>' },
    { command: 'enable', description: '启用：/enable <id>' },
    { command: 'disable', description: '停用：/disable <id>' },
    { command: 'cancel', description: '取消向导' }
  ]);

  const initialOffset = await redisHelpers.getOffset();
  if (typeof initialOffset === 'number') {
    await replayPendingUpdates(bot, initialOffset);
  }

  const stopWorker = await startTwitterWorker({
    twitterToken: config.twitterToken,
    watchAccounts: (await sourceService.listEnabledTwitterSources()).map((source) => source.normalizedTarget),
    deps: {
      findSourceIdByAccount: async (account) => {
        const source = await prisma.monitorSource.findUnique({
          where: { type_normalizedTarget: { type: 'twitter', normalizedTarget: account.toLowerCase() } }
        });
        return source && source.enabled ? source.id : null;
      },
      recordEvent: (input) => eventService.recordEvent(input),
      recordMutualFollow: (input) => mutualFollowService.record(input),
      fanOut: dispatcher.fanOut
    }
  });

  const persistOffset = setInterval(async () => {
    if (typeof lastUpdateId === 'number') {
      await redisHelpers.setOffset(lastUpdateId + 1);
    }
  }, 5_000);

  const polling = bot.start({
    onStart: () => console.info(`Bot @${bot.botInfo.username ?? bot.botInfo.first_name} started`),
    drop_pending_updates: false,
    allowed_updates: ALLOWED_UPDATES
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`Received ${signal}, shutting down`);
    clearInterval(persistOffset);
    stopWorker();
    await bot.stop();
    await redis.quit();
    await disconnectPrisma();
    await polling.catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
