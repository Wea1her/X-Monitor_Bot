import type { Bot, Context } from 'grammy';
import { GrammyError, HttpError } from 'grammy';

export function attachErrorHandler<C extends Context>(bot: Bot<C>): void {
  bot.catch((err) => {
    const ctx = err.ctx;
    const update = ctx.update.update_id;
    if (err.error instanceof GrammyError) {
      console.warn(`bot grammy error (update ${update}):`, err.error.description);
      return;
    }
    if (err.error instanceof HttpError) {
      console.warn(`bot http error (update ${update}):`, err.error.message);
      return;
    }
    console.error(`bot unhandled error (update ${update}):`, err.error);
  });
}
