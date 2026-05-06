import type { Context, NextFunction } from 'grammy';

export function createOwnerGuard(ownerUserIds: number[]) {
  const owners = new Set(ownerUserIds);
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;
    if (userId === undefined || !owners.has(userId)) {
      return;
    }
    await next();
  };
}
