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

export interface BotConfig {
  telegramBotToken: string;
  ownerUserIds: number[];
  twitterToken: string;
  databaseUrl: string;
  redisUrl: string;
}

function requireString(env: EnvLike, key: string, message: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function parseOwnerUserIds(raw: string): number[] {
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (ids.length === 0) {
    throw new Error('OWNER_USER_IDS must include at least one user id');
  }

  return ids.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error('OWNER_USER_IDS must contain only numeric ids');
    }
    return Number.parseInt(part, 10);
  });
}

export function parseBotConfig(env: EnvLike): BotConfig {
  const telegramBotToken = requireString(env, 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN is required');
  const ownerRaw = requireString(env, 'OWNER_USER_IDS', 'OWNER_USER_IDS must include at least one user id');
  const ownerUserIds = parseOwnerUserIds(ownerRaw);
  const twitterToken = requireString(env, 'TWITTER_TOKEN', 'TWITTER_TOKEN is required');
  const databaseUrl = requireString(env, 'DATABASE_URL', 'DATABASE_URL is required');
  const redisUrl = requireString(env, 'REDIS_URL', 'REDIS_URL is required');

  return { telegramBotToken, ownerUserIds, twitterToken, databaseUrl, redisUrl };
}
