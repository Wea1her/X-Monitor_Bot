import type { TelegramConfig } from './config.js';

interface TelegramDeps {
  fetch?: typeof fetch;
  warn?: (message: string) => void;
}

export async function sendTelegramMessage(
  config: TelegramConfig | undefined,
  text: string,
  deps: TelegramDeps = {}
): Promise<void> {
  if (!config) {
    return;
  }

  const fetchImpl = deps.fetch ?? fetch;
  const warn = deps.warn ?? console.warn;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      warn(`Telegram send failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    warn(
      `Telegram send failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
