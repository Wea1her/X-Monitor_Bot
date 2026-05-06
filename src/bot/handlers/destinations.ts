import type { Context } from 'grammy';
import type { DestinationService } from '../../services/destination-service.js';
import { destinationListKeyboard } from '../keyboards.js';
import { describeDestinationLine, STALE_BUTTON } from '../messages.js';

export function createDestinationsHandler(service: DestinationService) {
  return {
    async list(ctx: Context): Promise<void> {
      const destinations = await service.list();
      if (destinations.length === 0) {
        await ctx.reply('暂无推送目标。把 bot 拉进群/频道即可自动发现。');
        return;
      }
      const text = ['推送目标：', ...destinations.map(describeDestinationLine)].join('\n');
      await ctx.reply(text, { reply_markup: destinationListKeyboard(destinations) });
    },
    async toggle(ctx: Context, destinationId: number): Promise<void> {
      const current = await service.findById(destinationId);
      if (!current) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      const updated = await service.setEnabled(destinationId, !current.enabled);
      await ctx.reply(`已${updated.enabled ? '启用' : '停用'} ${describeDestinationLine(updated)}`);
    },
    async ignore(ctx: Context, destinationId: number): Promise<void> {
      await service.remove(destinationId);
      await ctx.reply(`已忽略并删除 #${destinationId}`);
    }
  };
}
