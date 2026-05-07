import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import { addTypePickerKeyboard, mainMenu } from '../keyboards.js';
import { addTargetPrompt, CANCELLED, workerNotAvailableHint } from '../messages.js';
import type { ServicesBundle } from './source-actions.js';

export interface AddResult {
  ok: boolean;
  message: string;
}

export interface WatchRegistrationDeps {
  registerWatch?: (account: string) => Promise<{ ok: true; alreadyExists?: boolean } | { ok: false; error: string }>;
}

export async function performAddSource(
  services: ServicesBundle,
  type: string,
  input: string,
  watchDeps: WatchRegistrationDeps = {}
): Promise<AddResult> {
  try {
    const { source, alreadyExisted } = await services.sourceService.create({ type, input });
    const head = alreadyExisted
      ? `ℹ️ 已存在 #${source.id} ${type}:${source.normalizedTarget}`
      : `✅ 已添加 #${source.id} ${type}:${source.normalizedTarget}`;
    if (source.type === 'twitter' && !alreadyExisted && watchDeps.registerWatch) {
      const synced = await watchDeps.registerWatch(source.normalizedTarget);
      if (synced.ok) {
        await services.sourceService.markRemoteWatchSynced(source.id);
        return { ok: true, message: `${head}\n✅ 已同步到 6551 监控` };
      }
      await services.sourceService.markRemoteWatchError(source.id, synced.error);
      return { ok: true, message: `${head}\n⚠️ 6551 同步失败：${synced.error}` };
    }
    const hint = workerNotAvailableHint(type);
    return { ok: true, message: hint ? `${head}\n${hint}` : head };
  } catch (error) {
    return { ok: false, message: `❌ ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const ADD_SOURCE_CONVERSATION = 'add-source';

export function createAddSourceConversation(services: ServicesBundle, watchDeps: WatchRegistrationDeps = {}) {
  return async function addSource(conversation: Conversation, ctx: Context): Promise<void> {
    await ctx.reply('选择监控类型：', { reply_markup: addTypePickerKeyboard() });
    const typeUpdate = await conversation.waitForCallbackQuery(/^add\.type\|a=/);
    const arg = typeUpdate.callbackQuery.data?.split('|a=')[1] ?? '';
    if (!['twitter', 'website', 'contract'].includes(arg)) {
      await ctx.reply(CANCELLED, { reply_markup: mainMenu() });
      return;
    }
    await typeUpdate.answerCallbackQuery();
    await ctx.reply(addTargetPrompt(arg));
    const text = await conversation.waitFor('message:text');
    const input = text.message.text.trim();
    if (!input || input === '/cancel') {
      await ctx.reply(CANCELLED, { reply_markup: mainMenu() });
      return;
    }
    const result = await performAddSource(services, arg, input, watchDeps);
    await ctx.reply(result.message, { reply_markup: mainMenu() });
  };
}

export function createAddSourceEntry() {
  return async function entry(ctx: ConversationFlavor<Context>): Promise<void> {
    await ctx.conversation.enter(ADD_SOURCE_CONVERSATION);
  };
}
