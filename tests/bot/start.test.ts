import { describe, expect, it, vi } from 'vitest';
import { handleStart } from '../../src/bot/handlers/start.js';
import { HELP, WELCOME } from '../../src/bot/messages.js';

function makeCtx() {
  return { reply: vi.fn().mockResolvedValue(undefined) };
}

describe('handleStart', () => {
  it('sends welcome with main menu', async () => {
    const ctx = makeCtx();
    await handleStart.start(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(WELCOME, expect.objectContaining({ reply_markup: expect.anything() }));
  });

  it('sends help text', async () => {
    const ctx = makeCtx();
    await handleStart.help(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(HELP);
  });
});
