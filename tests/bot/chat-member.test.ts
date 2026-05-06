import { describe, expect, it, vi } from 'vitest';
import { handleChatMemberUpdate } from '../../src/bot/handlers/chat-member.js';

function makeUpdate(over: Record<string, unknown> = {}) {
  return {
    chat: { id: -1001234567890, type: 'group', title: 'my_alerts', username: undefined },
    new_chat_member: { user: { id: 999 }, status: 'member' },
    old_chat_member: { user: { id: 999 }, status: 'left' },
    ...over
  };
}

describe('handleChatMemberUpdate', () => {
  it('upserts destination and notifies owner when bot was added', async () => {
    const discover = vi.fn().mockResolvedValue({ destination: { id: 1 }, isNew: true });
    const sendMessage = vi.fn();
    await handleChatMemberUpdate(makeUpdate() as never, {
      botId: 999,
      ownerUserIds: [42],
      discover,
      api: { sendMessage } as never
    });
    expect(discover).toHaveBeenCalledWith({
      telegramChatId: '-1001234567890',
      type: 'group',
      title: 'my_alerts',
      username: null
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores updates not about this bot', async () => {
    const discover = vi.fn();
    await handleChatMemberUpdate(
      makeUpdate({ new_chat_member: { user: { id: 1 }, status: 'member' } }) as never,
      { botId: 999, ownerUserIds: [42], discover, api: { sendMessage: vi.fn() } as never }
    );
    expect(discover).not.toHaveBeenCalled();
  });

  it('ignores when bot was removed (kicked/left)', async () => {
    const discover = vi.fn();
    await handleChatMemberUpdate(
      makeUpdate({ new_chat_member: { user: { id: 999 }, status: 'left' } }) as never,
      { botId: 999, ownerUserIds: [42], discover, api: { sendMessage: vi.fn() } as never }
    );
    expect(discover).not.toHaveBeenCalled();
  });
});
