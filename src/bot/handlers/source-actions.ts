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

export function createSourceActionsHandler(services: ServicesBundle) {
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
      const updated = await services.sourceService.setEnabled(sourceId, !source.enabled);
      await ctx.reply(`已${updated.enabled ? '启用' : '停用'} ${describeSourceLine(updated)}`, {
        reply_markup: sourceActionsKeyboard(updated)
      });
    },
    async delete(ctx: Context, sourceId: number): Promise<void> {
      try {
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
