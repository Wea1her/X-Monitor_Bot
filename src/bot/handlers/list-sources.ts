import type { Context } from 'grammy';
import type { SourceService } from '../../services/source-service.js';
import { sourceListKeyboard } from '../keyboards.js';
import { describeSourceLine } from '../messages.js';

export function createListSourcesHandler(sourceService: SourceService) {
  return async function listSources(ctx: Context): Promise<void> {
    const sources = await sourceService.list();
    if (sources.length === 0) {
      await ctx.reply('无监控源。点击 ➕ 添加监控 来创建第一个。', { reply_markup: sourceListKeyboard([]) });
      return;
    }
    const text = ['监控源：', ...sources.map(describeSourceLine)].join('\n');
    await ctx.reply(text, { reply_markup: sourceListKeyboard(sources) });
  };
}
