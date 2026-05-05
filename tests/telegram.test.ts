import { describe, expect, it, vi } from 'vitest';
import { sendTelegramMessage } from '../src/telegram.js';

describe('sendTelegramMessage', () => {
  it('does nothing when Telegram config is absent', async () => {
    const fetchMock = vi.fn();
    const warnMock = vi.fn();

    await sendTelegramMessage(undefined, 'hello', {
      fetch: fetchMock,
      warn: warnMock
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('sends configured messages to Telegram Bot API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}'
    });

    await sendTelegramMessage(
      { botToken: 'bot-token', chatId: 'chat-id' },
      'hello',
      { fetch: fetchMock, warn: vi.fn() }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: 'chat-id',
          text: 'hello',
          disable_web_page_preview: true
        })
      }
    );
  });

  it('logs Telegram API failures without throwing', async () => {
    const warnMock = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests'
    });

    await expect(
      sendTelegramMessage(
        { botToken: 'bot-token', chatId: 'chat-id' },
        'hello',
        { fetch: fetchMock, warn: warnMock }
      )
    ).resolves.toBeUndefined();

    expect(warnMock).toHaveBeenCalledWith(
      'Telegram send failed: 429 Too Many Requests'
    );
  });

  it('logs network failures without throwing', async () => {
    const warnMock = vi.fn();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));

    await sendTelegramMessage(
      { botToken: 'bot-token', chatId: 'chat-id' },
      'hello',
      { fetch: fetchMock, warn: warnMock }
    );

    expect(warnMock).toHaveBeenCalledWith('Telegram send failed: network down');
  });
});
