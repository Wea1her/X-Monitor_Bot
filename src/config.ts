export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface AppConfig {
  twitterToken: string;
  watchAccounts: string[];
  logDir: string;
  telegram?: TelegramConfig;
}

type EnvLike = Record<string, string | undefined>;

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, '').trim();
}

export function parseConfig(env: EnvLike): AppConfig {
  const twitterToken = env.TWITTER_TOKEN?.trim();
  if (!twitterToken) {
    throw new Error('TWITTER_TOKEN is required');
  }

  const watchAccounts = (env.WATCH_ACCOUNTS ?? '')
    .split(',')
    .map(normalizeUsername)
    .filter((username) => username.length > 0);

  if (watchAccounts.length === 0) {
    throw new Error('WATCH_ACCOUNTS must include at least one username');
  }

  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim();

  return {
    twitterToken,
    watchAccounts,
    logDir: env.LOG_DIR?.trim() || 'logs',
    telegram:
      telegramBotToken && telegramChatId
        ? { botToken: telegramBotToken, chatId: telegramChatId }
        : undefined
  };
}
