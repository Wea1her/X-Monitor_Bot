export interface TwitterEventParams {
  id?: number | string;
  twAccount?: string;
  twUserName?: string;
  profileUrl?: string;
  eventType?: string;
  content?: unknown;
  createdAt?: string;
  [key: string]: unknown;
}

export interface TwitterEventMessage {
  jsonrpc?: string;
  method?: string;
  params?: TwitterEventParams;
  [key: string]: unknown;
}

export interface NdjsonEntry {
  receivedAt: string;
  message: TwitterEventMessage;
}

const FOLLOW_EVENT_TYPE = 'NEW_FOLLOWER';
const UNFOLLOW_EVENT_TYPE = 'NEW_UNFOLLOWER';

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeAccount(value: string): string {
  return value.trim().replace(/^@+/, '').trim();
}

function accountLabel(account: string | undefined, name: string | undefined): string {
  const normalizedAccount = account ? normalizeAccount(account) : '';
  const normalizedName = name?.trim() ?? '';

  if (normalizedAccount && normalizedName) {
    return `@${normalizedAccount} (${normalizedName})`;
  }
  if (normalizedAccount) {
    return `@${normalizedAccount}`;
  }
  if (normalizedName) {
    return normalizedName;
  }
  return '@unknown';
}

function stringValue(
  value: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function objectPreview(value: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof value.text === 'string') {
    parts.push(value.text);
  }
  if (typeof value.id === 'string' || typeof value.id === 'number') {
    parts.push(`id=${value.id}`);
  }
  if (typeof value.userScreenName === 'string') {
    parts.push(`user=${value.userScreenName}`);
  }

  const urls = value.urls;
  if (Array.isArray(urls)) {
    const firstUrl = urls.find((item) => item && typeof item === 'object');
    if (firstUrl && typeof firstUrl === 'object') {
      const urlObject = firstUrl as Record<string, unknown>;
      const url = urlObject.expandedUrl ?? urlObject.url ?? urlObject.displayUrl;
      if (typeof url === 'string') {
        parts.push(`url=${url}`);
      }
    }
  }

  return parts.length > 0 ? parts.join(' | ') : stableJson(value);
}

function contentRecords(content: unknown): Record<string, unknown>[] {
  const values = Array.isArray(content) ? content : [content];

  return values.filter(
    (value): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

function followTargetLabel(value: Record<string, unknown>): string {
  const account = stringValue(value, [
    'twAccount',
    'username',
    'screenName',
    'userScreenName',
    'account'
  ]);
  const name = stringValue(value, [
    'twUserName',
    'userName',
    'displayName',
    'name'
  ]);

  return accountLabel(account, name);
}

function formatFollowTargets(content: unknown): string {
  const records = contentRecords(content);
  const labels = records.map(followTargetLabel).filter((label) => label !== '@unknown');

  if (labels.length > 0) {
    return labels.join(', ');
  }

  const preview = previewContent(content, 300);
  return preview || '@unknown';
}

function firstFollowTargetProfileUrl(content: unknown): string | undefined {
  for (const record of contentRecords(content)) {
    const profileUrl = stringValue(record, ['profileUrl', 'profileURL', 'url']);
    if (profileUrl) {
      return profileUrl;
    }
  }

  return undefined;
}

function firstFollowTargetBio(content: unknown): string | undefined {
  for (const record of contentRecords(content)) {
    const bio = stringValue(record, [
      'description',
      'desc',
      'bio',
      'profileDescription',
      'userDescription',
      'twDescription'
    ]);
    if (bio) {
      return bio;
    }
  }

  return undefined;
}

export function previewContent(content: unknown, maxLength = 240): string {
  if (content === undefined || content === null) {
    return '';
  }

  if (typeof content === 'string') {
    return truncate(content, maxLength);
  }

  if (Array.isArray(content)) {
    const first = content[0];
    return truncate(`items=${content.length} first=${stableJson(first)}`, maxLength);
  }

  if (typeof content === 'object') {
    return truncate(objectPreview(content as Record<string, unknown>), maxLength);
  }

  return truncate(String(content), maxLength);
}

export function formatConsoleSummary(message: TwitterEventMessage): string {
  const params = message.params ?? {};
  const eventType = params.eventType ?? 'UNKNOWN_EVENT';
  const account = accountLabel(params.twAccount, undefined);
  const createdAt = params.createdAt ?? 'unknown-time';

  if (eventType === FOLLOW_EVENT_TYPE) {
    return `[${eventType}] ${account} followed ${formatFollowTargets(params.content)} ${createdAt}`;
  }

  if (eventType === UNFOLLOW_EVENT_TYPE) {
    return `[${eventType}] ${account} unfollowed ${formatFollowTargets(params.content)} ${createdAt}`;
  }

  const preview = previewContent(params.content);

  return `[${eventType}] ${account} ${createdAt}${preview ? ` ${preview}` : ''}`;
}

export function formatTelegramMessage(message: TwitterEventMessage): string {
  const params = message.params ?? {};
  const eventType = params.eventType ?? 'UNKNOWN_EVENT';
  const account = accountLabel(params.twAccount, params.twUserName);
  const createdAt = params.createdAt ?? 'unknown-time';
  const profileUrl = params.profileUrl ?? '';

  if (eventType === FOLLOW_EVENT_TYPE) {
    const targetProfileUrl = firstFollowTargetProfileUrl(params.content);
    const targetBio = firstFollowTargetBio(params.content);

    return [
      '[OpenTwitter] 新增关注',
      `监控账号：${account}`,
      `关注了：${formatFollowTargets(params.content)}`,
      targetBio ? `简介：${targetBio}` : '',
      targetProfileUrl ? `目标主页：${targetProfileUrl}` : ''
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  if (eventType === UNFOLLOW_EVENT_TYPE) {
    const targetProfileUrl = firstFollowTargetProfileUrl(params.content);
    const targetBio = firstFollowTargetBio(params.content);

    return [
      '[OpenTwitter] 取消关注',
      `监控账号：${account}`,
      `取关了：${formatFollowTargets(params.content)}`,
      targetBio ? `简介：${targetBio}` : '',
      targetProfileUrl ? `目标主页：${targetProfileUrl}` : ''
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  const content = previewContent(params.content, 900);

  return [
    `[OpenTwitter] ${eventType}`,
    `账号：${account}`,
    `时间：${createdAt}`,
    `主页：${profileUrl}`,
    `内容：${content}`
  ].join('\n');
}

export function makeNdjsonEntry(
  message: TwitterEventMessage,
  receivedAt = new Date().toISOString()
): NdjsonEntry {
  return { receivedAt, message };
}
