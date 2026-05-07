import type { Context } from 'grammy';
import type { DestinationService } from '../../services/destination-service.js';
import type { SourceService } from '../../services/source-service.js';
import type { SubscriptionService } from '../../services/subscription-service.js';
import { sourceActionsKeyboard, subscriptionPickerKeyboard } from '../keyboards.js';
import { describeSourceLine, RETRY, STALE_BUTTON } from '../messages.js';

export interface ServicesBundle {
  sourceService: SourceService;
  destinationService: DestinationService;
  subscriptionService: SubscriptionService;
}

export interface WatchSyncDeps {
  registerWatch?: (account: string) => Promise<{ ok: true; alreadyExists?: boolean } | { ok: false; error: string }>;
  unregisterWatch?: (account: string) => Promise<{ ok: true; alreadyMissing?: boolean } | { ok: false; error: string }>;
}

export function createSourceActionsHandler(services: ServicesBundle, watchDeps: WatchSyncDeps = {}) {
  async function syncBeforeToggle(source: {
    id: number;
    type: string;
    normalizedTarget: string;
    enabled: boolean;
  }): Promise<string | null> {
    if (source.type !== 'twitter') return null;
    const sync = source.enabled ? watchDeps.unregisterWatch : watchDeps.registerWatch;
    if (!sync) return null;
    const result = await sync(source.normalizedTarget);
    if (result.ok) {
      await services.sourceService.markRemoteWatchSynced(source.id);
      return null;
    }
    await services.sourceService.markRemoteWatchError(source.id, result.error);
    return result.error;
  }

  async function syncBeforeDelete(source: { id: number; type: string; normalizedTarget: string }): Promise<string | null> {
    if (source.type !== 'twitter' || !watchDeps.unregisterWatch) return null;
    const result = await watchDeps.unregisterWatch(source.normalizedTarget);
    if (result.ok) {
      await services.sourceService.markRemoteWatchSynced(source.id);
      return null;
    }
    await services.sourceService.markRemoteWatchError(source.id, result.error);
    return result.error;
  }

  return {
    async show(ctx: Context, sourceId: number): Promise<void> {
      const source = await services.sourceService.findById(sourceId);
      if (!source) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      await ctx.reply(describeSourceLine(source), { reply_markup: sourceActionsKeyboard(source) });
    },
    async toggle(ctx: Context, sourceId: number): Promise<void> {
      const source = await services.sourceService.findById(sourceId);
      if (!source) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      const syncError = await syncBeforeToggle(source);
      if (syncError) {
        await ctx.reply(`6551 同步失败：${syncError}`);
        return;
      }
      const updated = await services.sourceService.setEnabled(sourceId, !source.enabled);
      await ctx.reply(`已${updated.enabled ? '启用' : '停用'} ${describeSourceLine(updated)}`, {
        reply_markup: sourceActionsKeyboard(updated)
      });
    },
    async delete(ctx: Context, sourceId: number): Promise<void> {
      try {
        const source = await services.sourceService.findById(sourceId);
        if (!source) {
          await ctx.reply(STALE_BUTTON);
          return;
        }
        const syncError = await syncBeforeDelete(source);
        if (syncError) {
          await ctx.reply(`6551 同步失败：${syncError}`);
          return;
        }
        await services.sourceService.remove(sourceId);
        await ctx.reply(`已删除 #${sourceId}`);
      } catch {
        await ctx.reply(RETRY);
      }
    },
    async subscriptionPicker(ctx: Context, sourceId: number): Promise<void> {
      const destinations = await services.destinationService.listEnabled();
      if (destinations.length === 0) {
        await ctx.reply('暂无启用的推送目标。先把 bot 拉进群/频道并启用它。');
        return;
      }
      const selected = new Set(await services.subscriptionService.listDestinationIdsForSource(sourceId));
      await ctx.reply('勾选要订阅的目标：', {
        reply_markup: subscriptionPickerKeyboard(sourceId, destinations, selected)
      });
    },
    async toggleSubscription(ctx: Context, sourceId: number, destinationId: number): Promise<void> {
      const current = new Set(await services.subscriptionService.listDestinationIdsForSource(sourceId));
      if (current.has(destinationId)) {
        await services.subscriptionService.unsubscribe(sourceId, destinationId);
      } else {
        await services.subscriptionService.subscribe(sourceId, destinationId);
      }
      const destinations = await services.destinationService.listEnabled();
      const updated = new Set(await services.subscriptionService.listDestinationIdsForSource(sourceId));
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: subscriptionPickerKeyboard(sourceId, destinations, updated)
        });
      } catch {
        // editMessageReplyMarkup 在某些场景下不可用：忽略
      }
    }
  };
}
