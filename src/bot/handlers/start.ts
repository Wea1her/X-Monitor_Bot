import type { Context } from 'grammy';
import { mainMenu } from '../keyboards.js';
import { HELP, WELCOME } from '../messages.js';

export const handleStart = {
  async start(ctx: Context): Promise<void> {
    await ctx.reply(WELCOME, { reply_markup: mainMenu() });
  },
  async help(ctx: Context): Promise<void> {
    await ctx.reply(HELP);
  }
};
