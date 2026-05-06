import { describe, expect, it, vi } from 'vitest';
import { createOwnerGuard } from '../../src/bot/middleware/owner-guard.js';

function makeCtx(userId: number | undefined) {
  return { from: userId === undefined ? undefined : { id: userId } } as never;
}

describe('createOwnerGuard', () => {
  it('calls next when user is owner', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const guard = createOwnerGuard([100, 200]);
    await guard(makeCtx(100), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('silently drops non-owner', async () => {
    const next = vi.fn();
    const guard = createOwnerGuard([100]);
    await guard(makeCtx(999), next);
    expect(next).not.toHaveBeenCalled();
  });

  it('drops updates without sender', async () => {
    const next = vi.fn();
    const guard = createOwnerGuard([100]);
    await guard(makeCtx(undefined), next);
    expect(next).not.toHaveBeenCalled();
  });
});
