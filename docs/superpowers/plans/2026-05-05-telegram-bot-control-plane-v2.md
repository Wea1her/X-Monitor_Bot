# Telegram Monitor Bot Control Plane v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Telegram 私聊驱动的单 owner 监控 bot 控制面，落地 PostgreSQL + Redis 持久化，接通 Twitter 事件分发；website / contract 类型只走控制面校验，不接 worker。

**Architecture:** 现有 probe 保留为诊断工具不动；新 bot 进程独立入口。三层架构：grammY bot 层 → service 层 → Prisma + ioredis 持久层；中间夹 monitor adapter registry 与 dispatcher。Twitter worker 复用 probe 的 WSS 逻辑（抽出 jitter helper 后共享）。

**Tech Stack:** TypeScript / tsx / Vitest / grammY / @grammyjs/conversations / Prisma / ioredis / PostgreSQL 16 / Redis 7 / Docker Compose / vitest-mock-extended / ioredis-mock。

---

## 文件结构

**新增（按依赖顺序）：**

- Create: `docker-compose.yml` — Postgres + Redis 容器编排。
- Modify: `package.json` — 新增 scripts/deps。
- Modify: `.env.example` — 加入 bot 所需新变量。
- Create: `prisma/schema.prisma` — 数据模型。
- Create: `prisma/migrations/*` — `prisma migrate dev` 自动生成。
- Create: `src/util/backoff.ts` — 共享指数退避 + jitter helper。
- Modify: `src/probe.ts` — 复用 backoff helper（可选，最后一个任务内一起做）。
- Create: `src/store/prisma.ts` — PrismaClient 单例。
- Create: `src/store/redis.ts` — ioredis 单例 + dedupe/offset helper。
- Modify: `src/config.ts` — 拆出 `parseBotConfig`，原 `parseConfig` 改名 `parseProbeConfig` 同时保留 `parseConfig` 旧别名。
- Create: `src/monitors/adapter.ts` — `MonitorAdapter` 接口、`ValidationError`、`NormalizedTarget`。
- Create: `src/monitors/registry.ts` — type → adapter map。
- Create: `src/monitors/twitter-adapter.ts` — Twitter target 校验/描述/watch-add。
- Create: `src/monitors/website-adapter.ts` — URL 校验/描述。
- Create: `src/monitors/contract-adapter.ts` — chain+address 校验/描述。
- Create: `src/services/source-service.ts` — source CRUD。
- Create: `src/services/destination-service.ts` — destination CRUD + 自动发现 upsert。
- Create: `src/services/subscription-service.ts` — subscription CRUD + 查询。
- Create: `src/services/event-service.ts` — event_logs + dedupe + delivery_logs。
- Create: `src/routing/dispatcher.ts` — event → fan-out → Telegram → 投递日志。
- Create: `src/workers/twitter-worker.ts` — 6551 WSS 长连 + watch-add + 调 event-service / dispatcher。
- Create: `src/bot/callback-data.ts` — callback data 编/解码 + 校验。
- Create: `src/bot/keyboards.ts` — inline keyboard 渲染。
- Create: `src/bot/messages.ts` — 用户可见文案（中文）。
- Create: `src/bot/middleware/owner-guard.ts` — 非 owner 静默丢弃。
- Create: `src/bot/middleware/error-handler.ts` — 全局错误兜底。
- Create: `src/bot/handlers/start.ts` — `/start`、`/menu`、`/help`。
- Create: `src/bot/handlers/list-sources.ts` — `/list` + 主菜单"监控列表"。
- Create: `src/bot/handlers/source-actions.ts` — 单条 source 详情、订阅、启停、删除。
- Create: `src/bot/handlers/add-source.ts` — 添加监控向导（conversation）。
- Create: `src/bot/handlers/destinations.ts` — `/destinations` + 启停。
- Create: `src/bot/handlers/chat-member.ts` — `my_chat_member` 自动发现 + DM owner。
- Create: `src/bot/main.ts` — 装配 bot、启动 polling + worker + dispatcher。
- Modify: `README.md` — 新增 bot 使用说明，标注 probe 仅诊断。

**测试：**

- Create: `tests/util/backoff.test.ts`
- Create: `tests/store/redis.test.ts`
- Create: `tests/config.bot.test.ts`（不动旧 `tests/config.test.ts`）
- Create: `tests/monitors/twitter-adapter.test.ts`
- Create: `tests/monitors/website-adapter.test.ts`
- Create: `tests/monitors/contract-adapter.test.ts`
- Create: `tests/monitors/registry.test.ts`
- Create: `tests/services/source-service.test.ts`
- Create: `tests/services/destination-service.test.ts`
- Create: `tests/services/subscription-service.test.ts`
- Create: `tests/services/event-service.test.ts`
- Create: `tests/routing/dispatcher.test.ts`
- Create: `tests/workers/twitter-worker.test.ts`
- Create: `tests/bot/callback-data.test.ts`
- Create: `tests/bot/owner-guard.test.ts`
- Create: `tests/bot/start.test.ts`
- Create: `tests/bot/list-sources.test.ts`
- Create: `tests/bot/source-actions.test.ts`
- Create: `tests/bot/add-source.test.ts`
- Create: `tests/bot/destinations.test.ts`
- Create: `tests/bot/chat-member.test.ts`
- Create: `tests/integration/prisma-roundtrip.test.ts`
- Create: `tests/integration/dispatcher-e2e.test.ts`

---

## Task 1：基础设施 — docker-compose、deps、env

**Files:**
- Create: `docker-compose.yml`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1：写 docker-compose.yml**

`docker-compose.yml`：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: x-monitor-postgres
    environment:
      POSTGRES_USER: x
      POSTGRES_PASSWORD: x
      POSTGRES_DB: x_monitor
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U x -d x_monitor"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: x-monitor-redis
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    command: ["redis-server", "--save", "60", "1", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  redisdata:
```

- [ ] **Step 2：更新 package.json**

替换 `scripts` 与 `dependencies`/`devDependencies` 区段为：

```json
{
  "name": "x-monitor-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "bot": "tsx src/bot/main.ts",
    "test": "vitest run",
    "test:unit": "vitest run --exclude tests/integration/**",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:up": "docker compose up -d postgres redis",
    "db:down": "docker compose down"
  },
  "dependencies": {
    "@grammyjs/conversations": "^2.0.1",
    "@prisma/client": "^6.1.0",
    "dotenv": "^16.4.7",
    "grammy": "^1.32.0",
    "ioredis": "^5.4.2",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "ioredis-mock": "^8.9.0",
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "vitest-mock-extended": "^2.0.2"
  }
}
```

- [ ] **Step 3：更新 .env.example**

```env
# Telegram bot 控制面（新增）
TELEGRAM_BOT_TOKEN=
OWNER_USER_IDS=

# 6551 / Twitter（保留，bot worker 复用）
TWITTER_TOKEN=

# 数据库（新增）
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor
REDIS_URL=redis://localhost:6379

# 仅 npm run dev 老 probe 使用
WATCH_ACCOUNTS=elonmusk,VitalikButerin
TELEGRAM_CHAT_ID=
LOG_DIR=logs
```

- [ ] **Step 4：安装依赖**

Run：

```bash
npm install
```

Expected：成功安装；`package-lock.json` 更新；无 peer dep 警告阻塞。

- [ ] **Step 5：起容器并验证**

Run：

```bash
npm run db:up
docker compose ps
```

Expected：两个容器状态均为 `(healthy)`。如果 5432/6379 端口被占用，停掉占用进程或改 compose 端口映射后重试。

- [ ] **Step 6：提交基础设施**

```bash
git add docker-compose.yml package.json package-lock.json .env.example
git commit -m "chore: add docker compose, prisma/grammy/ioredis deps, bot env vars"
```

---

## Task 2：Prisma schema + 初始迁移

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/*`（自动生成）

- [ ] **Step 1：写 schema**

`prisma/schema.prisma`：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model MonitorSource {
  id                Int                @id @default(autoincrement())
  type              String
  target            String
  normalizedTarget  String             @map("normalized_target")
  configJson        Json               @map("config_json")
  enabled           Boolean            @default(true)
  createdAt         DateTime           @default(now()) @map("created_at")
  updatedAt         DateTime           @updatedAt      @map("updated_at")

  subscriptions     Subscription[]
  events            EventLog[]

  @@unique([type, normalizedTarget])
  @@map("monitor_sources")
}

model Destination {
  id              Int            @id @default(autoincrement())
  telegramChatId  String         @unique @map("telegram_chat_id")
  type            String
  title           String?
  username        String?
  enabled         Boolean        @default(true)
  createdAt       DateTime       @default(now()) @map("created_at")
  updatedAt       DateTime       @updatedAt      @map("updated_at")

  subscriptions   Subscription[]
  deliveries      DeliveryLog[]

  @@map("destinations")
}

model Subscription {
  id            Int           @id @default(autoincrement())
  sourceId      Int           @map("source_id")
  destinationId Int           @map("destination_id")
  enabled       Boolean       @default(true)
  createdAt     DateTime      @default(now()) @map("created_at")

  source        MonitorSource @relation(fields: [sourceId],      references: [id], onDelete: Cascade)
  destination   Destination   @relation(fields: [destinationId], references: [id], onDelete: Cascade)

  @@unique([sourceId, destinationId])
  @@map("subscriptions")
}

model EventLog {
  id          Int             @id @default(autoincrement())
  sourceId    Int?            @map("source_id")
  eventType   String          @map("event_type")
  dedupeKey   String?         @unique @map("dedupe_key")
  rawJson     Json            @map("raw_json")
  occurredAt  DateTime?       @map("occurred_at")
  receivedAt  DateTime        @default(now()) @map("received_at")

  source      MonitorSource?  @relation(fields: [sourceId], references: [id], onDelete: SetNull)
  deliveries  DeliveryLog[]

  @@index([sourceId, receivedAt])
  @@map("event_logs")
}

model DeliveryLog {
  id            Int          @id @default(autoincrement())
  eventLogId    Int?         @map("event_log_id")
  destinationId Int          @map("destination_id")
  status        String
  error         String?
  sentAt        DateTime?    @map("sent_at")

  event         EventLog?    @relation(fields: [eventLogId],    references: [id], onDelete: SetNull)
  destination   Destination  @relation(fields: [destinationId], references: [id], onDelete: Cascade)

  @@index([destinationId, sentAt])
  @@map("delivery_logs")
}
```

- [ ] **Step 2：先确保 .gitignore 不漏过敏感目录**

`.gitignore` 应包含 `node_modules/`、`dist/`、`.env`、`logs/`（已存在则跳过）。Prisma 不需要忽略迁移文件——`prisma/migrations/` 必须入库。

- [ ] **Step 3：起容器并跑首个迁移**

Run：

```bash
npm run db:up
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npx prisma migrate dev --name init
```

Expected：
- 生成 `prisma/migrations/<timestamp>_init/migration.sql`。
- Prisma Client 自动生成到 `node_modules/@prisma/client`。
- 容器内出现 5 张表。

- [ ] **Step 4：用 prisma studio 抽检（可选）**

Run（前台命令，验证后 Ctrl+C 退出）：

```bash
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npx prisma studio
```

Expected：浏览器打开 `http://localhost:5555`，5 张表均可见且为空。

- [ ] **Step 5：提交 schema 与迁移**

```bash
git add prisma/
git commit -m "feat: add prisma schema and initial migration"
```

---

## Task 3：共享 backoff helper

**Files:**
- Create: `tests/util/backoff.test.ts`
- Create: `src/util/backoff.ts`

- [ ] **Step 1：写失败测试**

`tests/util/backoff.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { getBackoffDelayMs } from '../../src/util/backoff.js';

describe('getBackoffDelayMs', () => {
  it('returns base delay times jitter at attempt 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getBackoffDelayMs(0)).toBe(800);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(getBackoffDelayMs(0)).toBeCloseTo(1200, -1);
  });

  it('doubles each attempt with jitter window', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(getBackoffDelayMs(1)).toBe(2000);
    expect(getBackoffDelayMs(2)).toBe(4000);
    expect(getBackoffDelayMs(3)).toBe(8000);
  });

  it('caps base delay at 30000ms before jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // jitter -> 0.8x
    expect(getBackoffDelayMs(20)).toBe(24_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(getBackoffDelayMs(20)).toBeCloseTo(36_000, -2);
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/util/backoff.test.ts
```

Expected：FAIL，`Cannot find module '../../src/util/backoff.js'`。

- [ ] **Step 3：写最小实现**

`src/util/backoff.ts`：

```ts
export function getBackoffDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  const jitter = 0.8 + Math.random() * 0.4;
  return base * jitter;
}
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/util/backoff.test.ts
```

Expected：PASS，3 个测试通过。

- [ ] **Step 5：提交**

```bash
git add src/util/backoff.ts tests/util/backoff.test.ts
git commit -m "feat: add shared exponential backoff with jitter helper"
```

---

## Task 4：bot 配置解析

**Files:**
- Create: `tests/config.bot.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1：写失败测试（不动旧 tests/config.test.ts）**

`tests/config.bot.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseBotConfig } from '../src/config.js';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'bot-token',
  OWNER_USER_IDS: '111,222',
  TWITTER_TOKEN: 'tw-token',
  DATABASE_URL: 'postgresql://x:x@localhost:5432/x_monitor',
  REDIS_URL: 'redis://localhost:6379'
};

describe('parseBotConfig', () => {
  it('parses required values into typed config', () => {
    expect(parseBotConfig(baseEnv)).toEqual({
      telegramBotToken: 'bot-token',
      ownerUserIds: [111, 222],
      twitterToken: 'tw-token',
      databaseUrl: 'postgresql://x:x@localhost:5432/x_monitor',
      redisUrl: 'redis://localhost:6379'
    });
  });

  it('trims whitespace and ignores empty owner ids', () => {
    expect(
      parseBotConfig({ ...baseEnv, OWNER_USER_IDS: ' 333 , , 444 ' }).ownerUserIds
    ).toEqual([333, 444]);
  });

  it('rejects missing TELEGRAM_BOT_TOKEN', () => {
    const env = { ...baseEnv, TELEGRAM_BOT_TOKEN: '' };
    expect(() => parseBotConfig(env)).toThrow('TELEGRAM_BOT_TOKEN is required');
  });

  it('rejects missing OWNER_USER_IDS', () => {
    const env = { ...baseEnv, OWNER_USER_IDS: '' };
    expect(() => parseBotConfig(env)).toThrow('OWNER_USER_IDS must include at least one user id');
  });

  it('rejects non-numeric owner id', () => {
    const env = { ...baseEnv, OWNER_USER_IDS: '111,abc' };
    expect(() => parseBotConfig(env)).toThrow('OWNER_USER_IDS must contain only numeric ids');
  });

  it('rejects missing TWITTER_TOKEN', () => {
    const env = { ...baseEnv, TWITTER_TOKEN: '' };
    expect(() => parseBotConfig(env)).toThrow('TWITTER_TOKEN is required');
  });

  it('rejects missing DATABASE_URL', () => {
    const env = { ...baseEnv, DATABASE_URL: '' };
    expect(() => parseBotConfig(env)).toThrow('DATABASE_URL is required');
  });

  it('rejects missing REDIS_URL', () => {
    const env = { ...baseEnv, REDIS_URL: '' };
    expect(() => parseBotConfig(env)).toThrow('REDIS_URL is required');
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/config.bot.test.ts
```

Expected：FAIL，`parseBotConfig is not exported`。

- [ ] **Step 3：在 config.ts 末尾追加 BotConfig 与 parseBotConfig**

打开 `src/config.ts`，**保留** `TelegramConfig`、`AppConfig`、`parseConfig`（旧 probe 仍用）；在文件末尾追加：

```ts
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
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/config.bot.test.ts tests/config.test.ts
```

Expected：两个文件都 PASS（确认旧 probe 配置解析未被破坏）。

- [ ] **Step 5：提交**

```bash
git add src/config.ts tests/config.bot.test.ts
git commit -m "feat: parse bot config from environment"
```

---

## Task 5：Store 层 — Prisma 与 Redis 单例

**Files:**
- Create: `tests/store/redis.test.ts`
- Create: `src/store/prisma.ts`
- Create: `src/store/redis.ts`

- [ ] **Step 1：写失败测试（仅 redis helper 行为，prisma 单例不需要单测）**

`tests/store/redis.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import { createRedisHelpers, type RedisLike } from '../../src/store/redis.js';

function makeRedis(): RedisLike {
  return new RedisMock() as unknown as RedisLike;
}

describe('redis helpers', () => {
  it('SETNX-style dedupe: first call wins, second call loses', async () => {
    const redis = makeRedis();
    const helpers = createRedisHelpers(redis);
    expect(await helpers.tryClaimDedupe('k1')).toBe(true);
    expect(await helpers.tryClaimDedupe('k1')).toBe(false);
  });

  it('falls back to true when redis throws (do not block dispatch)', async () => {
    const failing: RedisLike = {
      set: async () => {
        throw new Error('connection lost');
      },
      get: async () => null,
      del: async () => 0
    } as unknown as RedisLike;
    const helpers = createRedisHelpers(failing);
    expect(await helpers.tryClaimDedupe('k1')).toBe(true);
  });

  it('persists and retrieves Telegram polling offset', async () => {
    const redis = makeRedis();
    const helpers = createRedisHelpers(redis);
    expect(await helpers.getOffset()).toBeUndefined();
    await helpers.setOffset(42);
    expect(await helpers.getOffset()).toBe(42);
  });

  it('returns undefined offset on redis read failure', async () => {
    const failing: RedisLike = {
      set: async () => 'OK',
      get: async () => {
        throw new Error('boom');
      },
      del: async () => 0
    } as unknown as RedisLike;
    const helpers = createRedisHelpers(failing);
    expect(await helpers.getOffset()).toBeUndefined();
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/store/redis.test.ts
```

Expected：FAIL，模块未找到。

- [ ] **Step 3：写最小实现 — Redis helper**

`src/store/redis.ts`：

```ts
import Redis from 'ioredis';

export interface RedisLike {
  set(key: string, value: string, mode: 'EX', seconds: number, condition: 'NX'): Promise<'OK' | null>;
  set(key: string, value: string): Promise<'OK'>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

const DEDUPE_PREFIX = 'dedupe:event:';
const OFFSET_KEY = 'tg:offset';
const DEDUPE_TTL_SECONDS = 86_400;

export interface RedisHelpers {
  tryClaimDedupe(key: string): Promise<boolean>;
  getOffset(): Promise<number | undefined>;
  setOffset(value: number): Promise<void>;
}

export function createRedisClient(url: string): Redis {
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
}

export function createRedisHelpers(redis: RedisLike): RedisHelpers {
  return {
    async tryClaimDedupe(key: string): Promise<boolean> {
      try {
        const result = await redis.set(`${DEDUPE_PREFIX}${key}`, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
        return result === 'OK';
      } catch {
        return true;
      }
    },
    async getOffset(): Promise<number | undefined> {
      try {
        const raw = await redis.get(OFFSET_KEY);
        if (!raw) return undefined;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    async setOffset(value: number): Promise<void> {
      try {
        await redis.set(OFFSET_KEY, String(value));
      } catch {
        /* swallow: offset is best-effort */
      }
    }
  };
}
```

- [ ] **Step 4：写 Prisma 单例（无独立单测）**

`src/store/prisma.ts`：

```ts
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ log: ['warn', 'error'] });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
```

- [ ] **Step 5：跑测试 + typecheck**

Run：

```bash
npm test tests/store/redis.test.ts
npm run typecheck
```

Expected：4 个测试通过；typecheck 干净（前提：Task 2 已生成 Prisma Client）。

- [ ] **Step 6：提交**

```bash
git add src/store/ tests/store/
git commit -m "feat: add prisma and redis store singletons with dedupe/offset helpers"
```

---

## Task 6：Monitor adapter 接口 + 三个 adapter

**Files:**
- Create: `tests/monitors/twitter-adapter.test.ts`
- Create: `tests/monitors/website-adapter.test.ts`
- Create: `tests/monitors/contract-adapter.test.ts`
- Create: `tests/monitors/registry.test.ts`
- Create: `src/monitors/adapter.ts`
- Create: `src/monitors/twitter-adapter.ts`
- Create: `src/monitors/website-adapter.ts`
- Create: `src/monitors/contract-adapter.ts`
- Create: `src/monitors/registry.ts`

- [ ] **Step 1：写所有失败测试**

`tests/monitors/twitter-adapter.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { twitterAdapter } from '../../src/monitors/twitter-adapter.js';
import { ValidationError } from '../../src/monitors/adapter.js';

describe('twitterAdapter', () => {
  it('strips leading @ and trims whitespace', async () => {
    expect(await twitterAdapter.validateTarget('  @ElonMusk  ')).toEqual({
      target: 'ElonMusk',
      normalizedTarget: 'elonmusk',
      configJson: {}
    });
  });

  it('rejects empty input', async () => {
    await expect(twitterAdapter.validateTarget('   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects illegal handle characters', async () => {
    await expect(twitterAdapter.validateTarget('elon-musk')).rejects.toBeInstanceOf(ValidationError);
  });

  it('describes a stored source', () => {
    expect(twitterAdapter.describe({
      type: 'twitter',
      target: '@elonmusk',
      normalizedTarget: 'elonmusk',
      configJson: {}
    })).toBe('🐦 twitter:elonmusk');
  });
});
```

`tests/monitors/website-adapter.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { websiteAdapter } from '../../src/monitors/website-adapter.js';
import { ValidationError } from '../../src/monitors/adapter.js';

describe('websiteAdapter', () => {
  it('accepts http/https URL and lowercases host', async () => {
    expect(await websiteAdapter.validateTarget(' https://Example.COM/Path?q=1 ')).toEqual({
      target: 'https://Example.COM/Path?q=1',
      normalizedTarget: 'https://example.com/Path?q=1',
      configJson: {}
    });
  });

  it('rejects non-http schemes', async () => {
    await expect(websiteAdapter.validateTarget('ftp://example.com')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed URL', async () => {
    await expect(websiteAdapter.validateTarget('not a url')).rejects.toBeInstanceOf(ValidationError);
  });

  it('describes a stored source with worker-not-available marker', () => {
    expect(
      websiteAdapter.describe({
        type: 'website',
        target: 'https://example.com',
        normalizedTarget: 'https://example.com',
        configJson: {}
      })
    ).toBe('🌐 website:https://example.com ⚠️ worker 暂未上线');
  });
});
```

`tests/monitors/contract-adapter.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { contractAdapter } from '../../src/monitors/contract-adapter.js';
import { ValidationError } from '../../src/monitors/adapter.js';

describe('contractAdapter', () => {
  it('accepts eth address with checksum', async () => {
    const result = await contractAdapter.validateTarget('eth 0xAbCdEf0123456789abcdef0123456789abcdef01');
    expect(result.normalizedTarget).toBe('eth:0xabcdef0123456789abcdef0123456789abcdef01');
    expect(result.configJson).toEqual({ chain: 'eth', address: '0xabcdef0123456789abcdef0123456789abcdef01' });
  });

  it('accepts bsc address', async () => {
    const result = await contractAdapter.validateTarget('bsc 0x0000000000000000000000000000000000000001');
    expect(result.configJson).toMatchObject({ chain: 'bsc' });
  });

  it('accepts sol address (base58)', async () => {
    const result = await contractAdapter.validateTarget('sol So11111111111111111111111111111111111111112');
    expect(result.configJson).toMatchObject({ chain: 'sol' });
  });

  it('rejects unknown chain', async () => {
    await expect(contractAdapter.validateTarget('btc 0xabc')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed eth address', async () => {
    await expect(contractAdapter.validateTarget('eth 0x123')).rejects.toBeInstanceOf(ValidationError);
  });

  it('describes a stored source with worker-not-available marker', () => {
    expect(
      contractAdapter.describe({
        type: 'contract',
        target: 'eth 0xabcdef0123456789abcdef0123456789abcdef01',
        normalizedTarget: 'eth:0xabcdef0123456789abcdef0123456789abcdef01',
        configJson: { chain: 'eth', address: '0xabcdef0123456789abcdef0123456789abcdef01' }
      })
    ).toBe('📜 contract:eth:0xabcdef0123456789abcdef0123456789abcdef01 ⚠️ worker 暂未上线');
  });
});
```

`tests/monitors/registry.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { getAdapter, listAdapterTypes } from '../../src/monitors/registry.js';

describe('monitor registry', () => {
  it('returns the adapter for a known type', () => {
    expect(getAdapter('twitter').type).toBe('twitter');
    expect(getAdapter('website').type).toBe('website');
    expect(getAdapter('contract').type).toBe('contract');
  });

  it('throws for unknown type', () => {
    expect(() => getAdapter('btc')).toThrow('Unknown monitor type: btc');
  });

  it('lists supported types', () => {
    expect(listAdapterTypes()).toEqual(['twitter', 'website', 'contract']);
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/monitors/
```

Expected：所有用例 FAIL，模块未找到。

- [ ] **Step 3：实现 adapter 接口**

`src/monitors/adapter.ts`：

```ts
export interface NormalizedTarget {
  target: string;
  normalizedTarget: string;
  configJson: Record<string, unknown>;
}

export interface MonitorSourceShape {
  type: string;
  target: string;
  normalizedTarget: string;
  configJson: Record<string, unknown>;
}

export interface MonitorAdapter {
  type: string;
  validateTarget(input: string): Promise<NormalizedTarget>;
  describe(source: MonitorSourceShape): string;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

- [ ] **Step 4：实现 twitter adapter**

`src/monitors/twitter-adapter.ts`：

```ts
import type { MonitorAdapter } from './adapter.js';
import { ValidationError } from './adapter.js';

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export const twitterAdapter: MonitorAdapter = {
  type: 'twitter',
  async validateTarget(input) {
    const stripped = input.trim().replace(/^@+/, '').trim();
    if (stripped.length === 0) {
      throw new ValidationError('Twitter 用户名不能为空');
    }
    if (!HANDLE_RE.test(stripped)) {
      throw new ValidationError('Twitter 用户名仅允许字母、数字、下划线，长度 1-15');
    }
    return {
      target: stripped,
      normalizedTarget: stripped.toLowerCase(),
      configJson: {}
    };
  },
  describe(source) {
    return `🐦 twitter:${source.normalizedTarget}`;
  }
};
```

- [ ] **Step 5：实现 website adapter**

`src/monitors/website-adapter.ts`：

```ts
import type { MonitorAdapter } from './adapter.js';
import { ValidationError } from './adapter.js';

export const websiteAdapter: MonitorAdapter = {
  type: 'website',
  async validateTarget(input) {
    const trimmed = input.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ValidationError('网站地址不是合法 URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ValidationError('网站监控仅支持 http / https');
    }
    const normalized = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
    return {
      target: trimmed,
      normalizedTarget: normalized,
      configJson: {}
    };
  },
  describe(source) {
    return `🌐 website:${source.normalizedTarget} ⚠️ worker 暂未上线`;
  }
};
```

- [ ] **Step 6：实现 contract adapter**

`src/monitors/contract-adapter.ts`：

```ts
import type { MonitorAdapter } from './adapter.js';
import { ValidationError } from './adapter.js';

const SUPPORTED_CHAINS = new Set(['eth', 'bsc', 'sol']);
const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const contractAdapter: MonitorAdapter = {
  type: 'contract',
  async validateTarget(input) {
    const parts = input.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new ValidationError('用法：<chain> <address>，例如 eth 0x...');
    }
    const [chainRaw, addressRaw] = parts as [string, string];
    const chain = chainRaw.toLowerCase();
    if (!SUPPORTED_CHAINS.has(chain)) {
      throw new ValidationError(`不支持的链：${chainRaw}（支持 ${[...SUPPORTED_CHAINS].join(' / ')}）`);
    }
    if (chain === 'sol') {
      if (!SOL_ADDR_RE.test(addressRaw)) {
        throw new ValidationError('Solana 地址格式不正确');
      }
      return {
        target: input.trim(),
        normalizedTarget: `${chain}:${addressRaw}`,
        configJson: { chain, address: addressRaw }
      };
    }
    if (!EVM_ADDR_RE.test(addressRaw)) {
      throw new ValidationError(`${chain.toUpperCase()} 地址必须是 0x 开头的 40 位十六进制`);
    }
    const lower = addressRaw.toLowerCase();
    return {
      target: input.trim(),
      normalizedTarget: `${chain}:${lower}`,
      configJson: { chain, address: lower }
    };
  },
  describe(source) {
    return `📜 contract:${source.normalizedTarget} ⚠️ worker 暂未上线`;
  }
};
```

- [ ] **Step 7：实现 registry**

`src/monitors/registry.ts`：

```ts
import type { MonitorAdapter } from './adapter.js';
import { twitterAdapter } from './twitter-adapter.js';
import { websiteAdapter } from './website-adapter.js';
import { contractAdapter } from './contract-adapter.js';

const ADAPTERS: Record<string, MonitorAdapter> = {
  twitter: twitterAdapter,
  website: websiteAdapter,
  contract: contractAdapter
};

export function getAdapter(type: string): MonitorAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`Unknown monitor type: ${type}`);
  }
  return adapter;
}

export function listAdapterTypes(): string[] {
  return ['twitter', 'website', 'contract'];
}
```

- [ ] **Step 8：跑测试看通过**

Run：

```bash
npm test tests/monitors/
```

Expected：4 个文件全 PASS。

- [ ] **Step 9：提交**

```bash
git add src/monitors/ tests/monitors/
git commit -m "feat: add monitor adapter interface, registry, and twitter/website/contract adapters"
```

---

## Task 7：source-service

**Files:**
- Create: `tests/services/source-service.test.ts`
- Create: `src/services/source-service.ts`

- [ ] **Step 1：写失败测试（Prisma mock）**

`tests/services/source-service.test.ts`：

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createSourceService } from '../../src/services/source-service.js';

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

const fakeRow = {
  id: 1,
  type: 'twitter',
  target: 'elonmusk',
  normalizedTarget: 'elonmusk',
  configJson: {},
  enabled: true,
  createdAt: new Date('2026-05-05'),
  updatedAt: new Date('2026-05-05')
};

describe('sourceService.create', () => {
  it('validates via adapter and creates a new source', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.create.mockResolvedValue(fakeRow);

    const service = createSourceService(prisma);
    const created = await service.create({ type: 'twitter', input: '@ElonMusk' });

    expect(created).toEqual({ source: fakeRow, alreadyExisted: false });
    expect(prisma.monitorSource.create).toHaveBeenCalledWith({
      data: {
        type: 'twitter',
        target: 'ElonMusk',
        normalizedTarget: 'elonmusk',
        configJson: {},
        enabled: true
      }
    });
  });

  it('returns existing source when duplicate', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(fakeRow);

    const service = createSourceService(prisma);
    const result = await service.create({ type: 'twitter', input: 'elonmusk' });

    expect(result).toEqual({ source: fakeRow, alreadyExisted: true });
    expect(prisma.monitorSource.create).not.toHaveBeenCalled();
  });

  it('throws ValidationError for unknown type', async () => {
    const service = createSourceService(prisma);
    await expect(service.create({ type: 'btc', input: 'foo' })).rejects.toThrow('Unknown monitor type: btc');
  });

  it('lists sources sorted by id', async () => {
    prisma.monitorSource.findMany.mockResolvedValue([fakeRow]);
    const service = createSourceService(prisma);
    expect(await service.list()).toEqual([fakeRow]);
    expect(prisma.monitorSource.findMany).toHaveBeenCalledWith({ orderBy: { id: 'asc' } });
  });

  it('toggles enabled', async () => {
    prisma.monitorSource.update.mockResolvedValue({ ...fakeRow, enabled: false });
    const service = createSourceService(prisma);
    const updated = await service.setEnabled(1, false);
    expect(updated.enabled).toBe(false);
    expect(prisma.monitorSource.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { enabled: false } });
  });

  it('removes a source', async () => {
    prisma.monitorSource.delete.mockResolvedValue(fakeRow);
    const service = createSourceService(prisma);
    await service.remove(1);
    expect(prisma.monitorSource.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('lists enabled twitter sources for the worker', async () => {
    prisma.monitorSource.findMany.mockResolvedValue([fakeRow]);
    const service = createSourceService(prisma);
    expect(await service.listEnabledTwitterSources()).toEqual([fakeRow]);
    expect(prisma.monitorSource.findMany).toHaveBeenCalledWith({
      where: { type: 'twitter', enabled: true },
      orderBy: { id: 'asc' }
    });
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/services/source-service.test.ts
```

Expected：FAIL，模块未找到。

- [ ] **Step 3：写最小实现**

`src/services/source-service.ts`：

```ts
import type { MonitorSource, PrismaClient, Prisma } from '@prisma/client';
import { getAdapter } from '../monitors/registry.js';

export interface CreateSourceInput {
  type: string;
  input: string;
}

export interface CreateSourceResult {
  source: MonitorSource;
  alreadyExisted: boolean;
}

export interface SourceService {
  create(input: CreateSourceInput): Promise<CreateSourceResult>;
  list(): Promise<MonitorSource[]>;
  setEnabled(id: number, enabled: boolean): Promise<MonitorSource>;
  remove(id: number): Promise<void>;
  listEnabledTwitterSources(): Promise<MonitorSource[]>;
  findById(id: number): Promise<MonitorSource | null>;
}

export function createSourceService(prisma: PrismaClient): SourceService {
  return {
    async create({ type, input }) {
      const adapter = getAdapter(type);
      const normalized = await adapter.validateTarget(input);
      const existing = await prisma.monitorSource.findUnique({
        where: { type_normalizedTarget: { type, normalizedTarget: normalized.normalizedTarget } }
      });
      if (existing) {
        return { source: existing, alreadyExisted: true };
      }
      const created = await prisma.monitorSource.create({
        data: {
          type,
          target: normalized.target,
          normalizedTarget: normalized.normalizedTarget,
          configJson: normalized.configJson as Prisma.InputJsonValue,
          enabled: true
        }
      });
      return { source: created, alreadyExisted: false };
    },
    list() {
      return prisma.monitorSource.findMany({ orderBy: { id: 'asc' } });
    },
    setEnabled(id, enabled) {
      return prisma.monitorSource.update({ where: { id }, data: { enabled } });
    },
    async remove(id) {
      await prisma.monitorSource.delete({ where: { id } });
    },
    listEnabledTwitterSources() {
      return prisma.monitorSource.findMany({
        where: { type: 'twitter', enabled: true },
        orderBy: { id: 'asc' }
      });
    },
    findById(id) {
      return prisma.monitorSource.findUnique({ where: { id } });
    }
  };
}
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/services/source-service.test.ts
```

Expected：PASS，7 个测试通过。

- [ ] **Step 5：提交**

```bash
git add src/services/source-service.ts tests/services/source-service.test.ts
git commit -m "feat: add source service with adapter validation and CRUD"
```

---

## Task 8：destination-service

**Files:**
- Create: `tests/services/destination-service.test.ts`
- Create: `src/services/destination-service.ts`

- [ ] **Step 1：写失败测试**

`tests/services/destination-service.test.ts`：

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createDestinationService } from '../../src/services/destination-service.js';

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

const fakeRow = {
  id: 5,
  telegramChatId: '-1001234567890',
  type: 'group',
  title: 'my_alerts',
  username: null,
  enabled: false,
  createdAt: new Date('2026-05-05'),
  updatedAt: new Date('2026-05-05')
};

describe('destinationService', () => {
  it('upserts auto-discovered destination as disabled', async () => {
    prisma.destination.upsert.mockResolvedValue(fakeRow);
    const service = createDestinationService(prisma);
    const result = await service.discover({
      telegramChatId: '-1001234567890',
      type: 'group',
      title: 'my_alerts',
      username: null
    });
    expect(result).toEqual({ destination: fakeRow, isNew: true });
    expect(prisma.destination.upsert).toHaveBeenCalledWith({
      where: { telegramChatId: '-1001234567890' },
      create: {
        telegramChatId: '-1001234567890',
        type: 'group',
        title: 'my_alerts',
        username: null,
        enabled: false
      },
      update: { type: 'group', title: 'my_alerts', username: null }
    });
  });

  it('reports isNew=false when discover hits existing record', async () => {
    prisma.destination.findUnique.mockResolvedValue(fakeRow);
    prisma.destination.upsert.mockResolvedValue(fakeRow);
    const service = createDestinationService(prisma);
    const { isNew } = await service.discover({
      telegramChatId: '-1001234567890',
      type: 'group',
      title: 'my_alerts',
      username: null
    });
    expect(isNew).toBe(false);
  });

  it('lists destinations ordered by id', async () => {
    prisma.destination.findMany.mockResolvedValue([fakeRow]);
    const service = createDestinationService(prisma);
    expect(await service.list()).toEqual([fakeRow]);
  });

  it('toggles enabled', async () => {
    prisma.destination.update.mockResolvedValue({ ...fakeRow, enabled: true });
    const service = createDestinationService(prisma);
    const updated = await service.setEnabled(5, true);
    expect(updated.enabled).toBe(true);
  });

  it('lists enabled destinations only', async () => {
    prisma.destination.findMany.mockResolvedValue([{ ...fakeRow, enabled: true }]);
    const service = createDestinationService(prisma);
    await service.listEnabled();
    expect(prisma.destination.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: { id: 'asc' }
    });
  });

  it('removes a destination', async () => {
    prisma.destination.delete.mockResolvedValue(fakeRow);
    const service = createDestinationService(prisma);
    await service.remove(5);
    expect(prisma.destination.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/services/destination-service.test.ts
```

Expected：FAIL，模块未找到。

- [ ] **Step 3：写最小实现**

`src/services/destination-service.ts`：

```ts
import type { Destination, PrismaClient } from '@prisma/client';

export interface DiscoverInput {
  telegramChatId: string;
  type: string;
  title: string | null;
  username: string | null;
}

export interface DiscoverResult {
  destination: Destination;
  isNew: boolean;
}

export interface DestinationService {
  discover(input: DiscoverInput): Promise<DiscoverResult>;
  list(): Promise<Destination[]>;
  listEnabled(): Promise<Destination[]>;
  setEnabled(id: number, enabled: boolean): Promise<Destination>;
  remove(id: number): Promise<void>;
  findById(id: number): Promise<Destination | null>;
}

export function createDestinationService(prisma: PrismaClient): DestinationService {
  return {
    async discover(input) {
      const before = await prisma.destination.findUnique({
        where: { telegramChatId: input.telegramChatId }
      });
      const destination = await prisma.destination.upsert({
        where: { telegramChatId: input.telegramChatId },
        create: {
          telegramChatId: input.telegramChatId,
          type: input.type,
          title: input.title,
          username: input.username,
          enabled: false
        },
        update: {
          type: input.type,
          title: input.title,
          username: input.username
        }
      });
      return { destination, isNew: before === null };
    },
    list() {
      return prisma.destination.findMany({ orderBy: { id: 'asc' } });
    },
    listEnabled() {
      return prisma.destination.findMany({
        where: { enabled: true },
        orderBy: { id: 'asc' }
      });
    },
    setEnabled(id, enabled) {
      return prisma.destination.update({ where: { id }, data: { enabled } });
    },
    async remove(id) {
      await prisma.destination.delete({ where: { id } });
    },
    findById(id) {
      return prisma.destination.findUnique({ where: { id } });
    }
  };
}
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/services/destination-service.test.ts
```

Expected：PASS，6 个测试通过。

- [ ] **Step 5：提交**

```bash
git add src/services/destination-service.ts tests/services/destination-service.test.ts
git commit -m "feat: add destination service with auto-discovery upsert"
```

---

## Task 9：subscription-service

**Files:**
- Create: `tests/services/subscription-service.test.ts`
- Create: `src/services/subscription-service.ts`

- [ ] **Step 1：写失败测试**

`tests/services/subscription-service.test.ts`：

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createSubscriptionService } from '../../src/services/subscription-service.js';

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe('subscriptionService', () => {
  it('upserts subscription idempotently', async () => {
    prisma.subscription.upsert.mockResolvedValue({
      id: 1, sourceId: 10, destinationId: 20, enabled: true, createdAt: new Date()
    });
    const service = createSubscriptionService(prisma);
    await service.subscribe(10, 20);
    expect(prisma.subscription.upsert).toHaveBeenCalledWith({
      where: { sourceId_destinationId: { sourceId: 10, destinationId: 20 } },
      create: { sourceId: 10, destinationId: 20, enabled: true },
      update: { enabled: true }
    });
  });

  it('removes subscription if exists', async () => {
    prisma.subscription.deleteMany.mockResolvedValue({ count: 1 });
    const service = createSubscriptionService(prisma);
    expect(await service.unsubscribe(10, 20)).toBe(true);
    expect(prisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { sourceId: 10, destinationId: 20 }
    });
  });

  it('reports false when nothing to unsubscribe', async () => {
    prisma.subscription.deleteMany.mockResolvedValue({ count: 0 });
    const service = createSubscriptionService(prisma);
    expect(await service.unsubscribe(10, 20)).toBe(false);
  });

  it('lists destinations subscribed to a source (only enabled)', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    const service = createSubscriptionService(prisma);
    await service.listDestinationsForSource(10);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { sourceId: 10, enabled: true, destination: { enabled: true } },
      include: { destination: true }
    });
  });

  it('lists destinations subscribed to a source by id list', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    const service = createSubscriptionService(prisma);
    await service.listDestinationIdsForSource(10);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { sourceId: 10 },
      select: { destinationId: true }
    });
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/services/subscription-service.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写最小实现**

`src/services/subscription-service.ts`：

```ts
import type { Destination, PrismaClient, Subscription } from '@prisma/client';

export type SubscriptionWithDestination = Subscription & { destination: Destination };

export interface SubscriptionService {
  subscribe(sourceId: number, destinationId: number): Promise<void>;
  unsubscribe(sourceId: number, destinationId: number): Promise<boolean>;
  listDestinationsForSource(sourceId: number): Promise<SubscriptionWithDestination[]>;
  listDestinationIdsForSource(sourceId: number): Promise<number[]>;
}

export function createSubscriptionService(prisma: PrismaClient): SubscriptionService {
  return {
    async subscribe(sourceId, destinationId) {
      await prisma.subscription.upsert({
        where: { sourceId_destinationId: { sourceId, destinationId } },
        create: { sourceId, destinationId, enabled: true },
        update: { enabled: true }
      });
    },
    async unsubscribe(sourceId, destinationId) {
      const result = await prisma.subscription.deleteMany({
        where: { sourceId, destinationId }
      });
      return result.count > 0;
    },
    listDestinationsForSource(sourceId) {
      return prisma.subscription.findMany({
        where: { sourceId, enabled: true, destination: { enabled: true } },
        include: { destination: true }
      }) as Promise<SubscriptionWithDestination[]>;
    },
    async listDestinationIdsForSource(sourceId) {
      const rows = await prisma.subscription.findMany({
        where: { sourceId },
        select: { destinationId: true }
      });
      return rows.map((row) => row.destinationId);
    }
  };
}
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/services/subscription-service.test.ts
```

Expected：PASS，5 个测试通过。

- [ ] **Step 5：提交**

```bash
git add src/services/subscription-service.ts tests/services/subscription-service.test.ts
git commit -m "feat: add subscription service"
```

---

## Task 10：event-service（事件落库 + dedupe + 投递日志）

**Files:**
- Create: `tests/services/event-service.test.ts`
- Create: `src/services/event-service.ts`

- [ ] **Step 1：写失败测试**

`tests/services/event-service.test.ts`：

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createEventService } from '../../src/services/event-service.js';

let prisma: DeepMockProxy<PrismaClient>;
const redisHelpers = {
  tryClaimDedupe: vi.fn<[string], Promise<boolean>>(),
  getOffset: vi.fn(),
  setOffset: vi.fn()
};

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  redisHelpers.tryClaimDedupe.mockReset();
});

const fakeEvent = {
  id: 1,
  sourceId: 10,
  eventType: 'NEW_TWEET',
  dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
  rawJson: { foo: 'bar' },
  occurredAt: null,
  receivedAt: new Date()
};

describe('eventService.recordEvent', () => {
  it('claims dedupe and writes event_log', async () => {
    redisHelpers.tryClaimDedupe.mockResolvedValue(true);
    prisma.eventLog.create.mockResolvedValue(fakeEvent);
    const service = createEventService(prisma, redisHelpers);
    const out = await service.recordEvent({
      sourceId: 10,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
      rawJson: { foo: 'bar' }
    });
    expect(out).toEqual({ event: fakeEvent, deduped: false });
  });

  it('returns deduped=true when dedupe claim fails (redis says dup)', async () => {
    redisHelpers.tryClaimDedupe.mockResolvedValue(false);
    const service = createEventService(prisma, redisHelpers);
    const out = await service.recordEvent({
      sourceId: 10,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
      rawJson: {}
    });
    expect(out).toEqual({ event: null, deduped: true });
    expect(prisma.eventLog.create).not.toHaveBeenCalled();
  });

  it('falls back to PG unique-constraint dedupe when redis allowed but PG conflicts', async () => {
    redisHelpers.tryClaimDedupe.mockResolvedValue(true);
    const error = Object.assign(new Error('unique violation'), { code: 'P2002' });
    prisma.eventLog.create.mockRejectedValue(error);
    const service = createEventService(prisma, redisHelpers);
    const out = await service.recordEvent({
      sourceId: 10,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:elonmusk:NEW_TWEET:abc',
      rawJson: {}
    });
    expect(out).toEqual({ event: null, deduped: true });
  });
});

describe('eventService.recordDelivery', () => {
  it('writes delivery_log success row', async () => {
    prisma.deliveryLog.create.mockResolvedValue({
      id: 1, eventLogId: 1, destinationId: 5, status: 'ok', error: null, sentAt: new Date()
    });
    const service = createEventService(prisma, redisHelpers);
    await service.recordDelivery({ eventLogId: 1, destinationId: 5, status: 'ok' });
    expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventLogId: 1,
        destinationId: 5,
        status: 'ok',
        error: null
      })
    });
  });

  it('writes delivery_log error row with message', async () => {
    prisma.deliveryLog.create.mockResolvedValue({
      id: 2, eventLogId: 1, destinationId: 5, status: 'error', error: 'boom', sentAt: new Date()
    });
    const service = createEventService(prisma, redisHelpers);
    await service.recordDelivery({ eventLogId: 1, destinationId: 5, status: 'error', error: 'boom' });
    expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'error', error: 'boom' })
    });
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/services/event-service.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写最小实现**

`src/services/event-service.ts`：

```ts
import type { EventLog, PrismaClient, Prisma } from '@prisma/client';
import type { RedisHelpers } from '../store/redis.js';

export interface RecordEventInput {
  sourceId: number | null;
  eventType: string;
  dedupeKey: string;
  rawJson: unknown;
  occurredAt?: Date;
}

export interface RecordEventResult {
  event: EventLog | null;
  deduped: boolean;
}

export interface RecordDeliveryInput {
  eventLogId: number | null;
  destinationId: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface EventService {
  recordEvent(input: RecordEventInput): Promise<RecordEventResult>;
  recordDelivery(input: RecordDeliveryInput): Promise<void>;
}

export function createEventService(
  prisma: PrismaClient,
  redis: Pick<RedisHelpers, 'tryClaimDedupe'>
): EventService {
  return {
    async recordEvent(input) {
      const claimed = await redis.tryClaimDedupe(input.dedupeKey);
      if (!claimed) {
        return { event: null, deduped: true };
      }
      try {
        const event = await prisma.eventLog.create({
          data: {
            sourceId: input.sourceId ?? null,
            eventType: input.eventType,
            dedupeKey: input.dedupeKey,
            rawJson: input.rawJson as Prisma.InputJsonValue,
            occurredAt: input.occurredAt ?? null
          }
        });
        return { event, deduped: false };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { event: null, deduped: true };
        }
        throw error;
      }
    },
    async recordDelivery(input) {
      await prisma.deliveryLog.create({
        data: {
          eventLogId: input.eventLogId,
          destinationId: input.destinationId,
          status: input.status,
          error: input.error ?? null,
          sentAt: new Date()
        }
      });
    }
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/services/event-service.test.ts
```

Expected：PASS，5 个测试通过。

- [ ] **Step 5：提交**

```bash
git add src/services/event-service.ts tests/services/event-service.test.ts
git commit -m "feat: add event service with redis+pg dedupe and delivery logging"
```

---

## Task 11：dispatcher（fan-out + Telegram + 投递日志）

**Files:**
- Create: `tests/routing/dispatcher.test.ts`
- Create: `src/routing/dispatcher.ts`

- [ ] **Step 1：写失败测试**

`tests/routing/dispatcher.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDispatcher, type DispatcherDeps } from '../../src/routing/dispatcher.js';
import type { Destination } from '@prisma/client';

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: 1,
  telegramChatId: '-100',
  type: 'group',
  title: 't',
  username: null,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over
});

function makeDeps(over: Partial<DispatcherDeps> = {}): DispatcherDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    listDestinationsForSource: vi.fn().mockResolvedValue([
      { destination: dest({ id: 1, telegramChatId: '-100' }) },
      { destination: dest({ id: 2, telegramChatId: '-200' }) }
    ]),
    recordDelivery: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    ...over
  };
}

describe('dispatcher.fanOut', () => {
  it('sends to every subscribed destination and records ok', async () => {
    const deps = makeDeps();
    const dispatcher = createDispatcher(deps);
    await dispatcher.fanOut({ eventLogId: 99, sourceId: 10, text: 'hi' });

    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
    expect(deps.sendMessage).toHaveBeenNthCalledWith(1, '-100', 'hi');
    expect(deps.sendMessage).toHaveBeenNthCalledWith(2, '-200', 'hi');
    expect(deps.recordDelivery).toHaveBeenCalledTimes(2);
    expect(deps.recordDelivery).toHaveBeenNthCalledWith(1, {
      eventLogId: 99, destinationId: 1, status: 'ok'
    });
  });

  it('records error and continues when one destination fails', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined)
    });
    const dispatcher = createDispatcher(deps);
    await dispatcher.fanOut({ eventLogId: 99, sourceId: 10, text: 'hi' });

    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
    expect(deps.recordDelivery).toHaveBeenNthCalledWith(1, {
      eventLogId: 99, destinationId: 1, status: 'error', error: 'boom'
    });
    expect(deps.recordDelivery).toHaveBeenNthCalledWith(2, {
      eventLogId: 99, destinationId: 2, status: 'ok'
    });
    expect(deps.warn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when source has no subscriptions', async () => {
    const deps = makeDeps({ listDestinationsForSource: vi.fn().mockResolvedValue([]) });
    const dispatcher = createDispatcher(deps);
    await dispatcher.fanOut({ eventLogId: 99, sourceId: 10, text: 'hi' });
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.recordDelivery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/routing/dispatcher.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写最小实现**

`src/routing/dispatcher.ts`：

```ts
import type { Destination } from '@prisma/client';

export interface DispatchEvent {
  eventLogId: number;
  sourceId: number;
  text: string;
}

export interface DispatcherDeps {
  sendMessage(chatId: string, text: string): Promise<void>;
  listDestinationsForSource(sourceId: number): Promise<Array<{ destination: Destination }>>;
  recordDelivery(input: {
    eventLogId: number;
    destinationId: number;
    status: 'ok' | 'error';
    error?: string;
  }): Promise<void>;
  warn?: (message: string) => void;
}

export interface Dispatcher {
  fanOut(event: DispatchEvent): Promise<void>;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const warn = deps.warn ?? console.warn;
  return {
    async fanOut(event) {
      const rows = await deps.listDestinationsForSource(event.sourceId);
      for (const row of rows) {
        try {
          await deps.sendMessage(row.destination.telegramChatId, event.text);
          await deps.recordDelivery({
            eventLogId: event.eventLogId,
            destinationId: row.destination.id,
            status: 'ok'
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warn(`dispatcher send failed for chat ${row.destination.telegramChatId}: ${message}`);
          await deps.recordDelivery({
            eventLogId: event.eventLogId,
            destinationId: row.destination.id,
            status: 'error',
            error: message
          });
        }
      }
    }
  };
}
```

- [ ] **Step 4：跑测试看通过**

Run：

```bash
npm test tests/routing/dispatcher.test.ts
```

Expected：PASS，3 个测试通过。

- [ ] **Step 5：提交**

```bash
git add src/routing/dispatcher.ts tests/routing/dispatcher.test.ts
git commit -m "feat: add dispatcher with per-destination error isolation"
```

---

## Task 12：Twitter worker（refactor probe，使用 backoff helper）

**Files:**
- Create: `tests/workers/twitter-worker.test.ts`
- Create: `src/workers/twitter-worker.ts`
- Modify: `src/probe.ts` — `getReconnectDelayMs` 替换为调用 `getBackoffDelayMs`，删除自家实现。

- [ ] **Step 1：写失败测试（仅纯行为）**

`tests/workers/twitter-worker.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  buildDedupeKey,
  buildEventText,
  handleWorkerPayload,
  type HandleWorkerDeps
} from '../../src/workers/twitter-worker.js';

const evt = {
  jsonrpc: '2.0',
  method: 'twitter.event',
  params: {
    twAccount: 'elonmusk',
    twUserName: 'Elon',
    profileUrl: 'https://twitter.com/elonmusk',
    eventType: 'NEW_TWEET',
    createdAt: '2026-05-05T01:02:03Z',
    content: { id: 'tweet-1', text: 'hello world' }
  }
};

describe('buildDedupeKey', () => {
  it('uses content.id when present', () => {
    expect(buildDedupeKey(evt)).toBe('tw:elonmusk:NEW_TWEET:tweet-1');
  });

  it('falls back to sha1 when content has no id', () => {
    const noId = { ...evt, params: { ...evt.params, content: { text: 'a' } } };
    expect(buildDedupeKey(noId)).toMatch(/^tw:elonmusk:NEW_TWEET:[0-9a-f]{40}$/);
  });
});

describe('buildEventText', () => {
  it('formats a Telegram-friendly message', () => {
    expect(buildEventText(evt)).toContain('NEW_TWEET');
    expect(buildEventText(evt)).toContain('@elonmusk');
    expect(buildEventText(evt)).toContain('hello world');
  });
});

describe('handleWorkerPayload', () => {
  function makeDeps(over: Partial<HandleWorkerDeps> = {}): HandleWorkerDeps {
    return {
      findSourceIdByAccount: vi.fn().mockResolvedValue(10),
      recordEvent: vi.fn().mockResolvedValue({ event: { id: 50 }, deduped: false }),
      fanOut: vi.fn().mockResolvedValue(undefined),
      info: vi.fn(),
      warn: vi.fn(),
      ...over
    };
  }

  it('records event and dispatches when not deduped', async () => {
    const deps = makeDeps();
    await handleWorkerPayload(JSON.stringify(evt), deps);
    expect(deps.recordEvent).toHaveBeenCalledTimes(1);
    expect(deps.fanOut).toHaveBeenCalledWith({
      eventLogId: 50,
      sourceId: 10,
      text: expect.stringContaining('NEW_TWEET')
    });
  });

  it('skips dispatch when event was deduped', async () => {
    const deps = makeDeps({
      recordEvent: vi.fn().mockResolvedValue({ event: null, deduped: true })
    });
    await handleWorkerPayload(JSON.stringify(evt), deps);
    expect(deps.fanOut).not.toHaveBeenCalled();
  });

  it('skips dispatch when no matching source', async () => {
    const deps = makeDeps({ findSourceIdByAccount: vi.fn().mockResolvedValue(null) });
    await handleWorkerPayload(JSON.stringify(evt), deps);
    expect(deps.recordEvent).not.toHaveBeenCalled();
    expect(deps.fanOut).not.toHaveBeenCalled();
  });

  it('logs and ignores invalid JSON', async () => {
    const deps = makeDeps();
    await handleWorkerPayload('not-json', deps);
    expect(deps.warn).toHaveBeenCalledWith('Invalid WSS message JSON ignored');
  });

  it('ignores non-event messages', async () => {
    const deps = makeDeps();
    await handleWorkerPayload(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { success: true } }), deps);
    expect(deps.recordEvent).not.toHaveBeenCalled();
    expect(deps.fanOut).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/workers/twitter-worker.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写最小实现**

`src/workers/twitter-worker.ts`：

```ts
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import type { TwitterEventMessage } from '../events.js';
import { formatTelegramMessage } from '../events.js';
import { getBackoffDelayMs } from '../util/backoff.js';
import { addWatchAccounts } from '../open-twitter.js';

export interface HandleWorkerDeps {
  findSourceIdByAccount(account: string): Promise<number | null>;
  recordEvent(input: {
    sourceId: number;
    eventType: string;
    dedupeKey: string;
    rawJson: unknown;
  }): Promise<{ event: { id: number } | null; deduped: boolean }>;
  fanOut(event: { eventLogId: number; sourceId: number; text: string }): Promise<void>;
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export function buildDedupeKey(message: TwitterEventMessage): string {
  const params = message.params ?? {};
  const account = params.twAccount ?? 'unknown';
  const eventType = params.eventType ?? 'UNKNOWN';
  const content = params.content as Record<string, unknown> | undefined;
  const id = content && typeof content === 'object' ? content.id : undefined;
  if (typeof id === 'string' || typeof id === 'number') {
    return `tw:${account}:${eventType}:${id}`;
  }
  const digest = createHash('sha1').update(JSON.stringify(content ?? null)).digest('hex');
  return `tw:${account}:${eventType}:${digest}`;
}

export function buildEventText(message: TwitterEventMessage): string {
  return formatTelegramMessage(message);
}

export async function handleWorkerPayload(raw: string, deps: HandleWorkerDeps): Promise<void> {
  const info = deps.info ?? console.info;
  const warn = deps.warn ?? console.warn;
  let message: TwitterEventMessage;
  try {
    message = JSON.parse(raw) as TwitterEventMessage;
  } catch {
    warn('Invalid WSS message JSON ignored');
    return;
  }
  if (message.method !== 'twitter.event') {
    info(`WSS message: ${JSON.stringify(message)}`);
    return;
  }
  const account = message.params?.twAccount;
  if (!account) {
    warn('twitter.event missing twAccount');
    return;
  }
  const sourceId = await deps.findSourceIdByAccount(account);
  if (sourceId === null) {
    info(`twitter.event for unmonitored account @${account}`);
    return;
  }
  const dedupeKey = buildDedupeKey(message);
  const eventType = message.params?.eventType ?? 'UNKNOWN';
  const recorded = await deps.recordEvent({
    sourceId,
    eventType,
    dedupeKey,
    rawJson: message
  });
  if (recorded.deduped || !recorded.event) {
    info(`event deduped: ${dedupeKey}`);
    return;
  }
  await deps.fanOut({
    eventLogId: recorded.event.id,
    sourceId,
    text: buildEventText(message)
  });
}

export interface StartTwitterWorkerOptions {
  twitterToken: string;
  watchAccounts: string[];
  deps: HandleWorkerDeps;
  webSocketFactory?: (url: string) => WebSocket;
}

export function buildWebSocketUrl(token: string): string {
  return `wss://ai.6551.io/open/twitter_wss?token=${encodeURIComponent(token)}`;
}

export function buildSubscribeMessage(): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'twitter.subscribe' });
}

export async function startTwitterWorker(options: StartTwitterWorkerOptions): Promise<() => void> {
  await addWatchAccounts({
    token: options.twitterToken,
    accounts: options.watchAccounts
  });

  let closedByUser = false;
  let attempt = 0;
  let socket: WebSocket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const factory = options.webSocketFactory ?? ((url) => new WebSocket(url));

  const connect = (): void => {
    socket = factory(buildWebSocketUrl(options.twitterToken));
    socket.on('open', () => {
      attempt = 0;
      console.info('Twitter worker WSS connected');
      socket?.send(buildSubscribeMessage());
    });
    socket.on('message', (data) => {
      void handleWorkerPayload(data.toString(), options.deps);
    });
    socket.on('error', (error) => {
      console.warn(`Twitter worker WSS error: ${error instanceof Error ? error.message : String(error)}`);
    });
    socket.on('close', () => {
      if (closedByUser) return;
      const delay = getBackoffDelayMs(attempt);
      attempt += 1;
      console.warn(`Twitter worker WSS disconnected, reconnecting in ${Math.round(delay)}ms`);
      reconnectTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return () => {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
```

- [ ] **Step 4：让 probe 改用共享 backoff helper（保持现有测试通过）**

打开 `src/probe.ts`，删除 `getReconnectDelayMs` 函数与其导出，改为：

```ts
import { getBackoffDelayMs } from './util/backoff.js';
```

把所有 `getReconnectDelayMs(reconnectAttempt)` 调用替换为 `getBackoffDelayMs(reconnectAttempt)`。**注意：原 `tests/probe.test.ts` 测的是固定 1000/2000/30000，现在带 jitter 会失败**——同步调整：

打开 `tests/probe.test.ts`，把 `getReconnectDelayMs` 改名为 `getBackoffDelayMs`、`describe('probe helpers')` 中的 `'caps exponential reconnect delay at 30 seconds'` 用例替换为：

```ts
it('returns a delay within the jittered backoff window', () => {
  const d0 = getBackoffDelayMs(0);
  expect(d0).toBeGreaterThanOrEqual(800);
  expect(d0).toBeLessThanOrEqual(1200);
  const dHigh = getBackoffDelayMs(20);
  expect(dHigh).toBeGreaterThanOrEqual(24_000);
  expect(dHigh).toBeLessThanOrEqual(36_000);
});
```

并把 `import { ..., getReconnectDelayMs, ... }` 改成 `import { ... }` 同时新增 `import { getBackoffDelayMs } from '../src/util/backoff.js';`，移除对 `getReconnectDelayMs` 的旧 buildSubscribeMessage 用例无关的引用。

- [ ] **Step 5：跑测试 + typecheck**

Run：

```bash
npm test tests/workers/twitter-worker.test.ts tests/probe.test.ts
npm run typecheck
```

Expected：worker 5 个测试 + probe 原有测试全部 PASS。

- [ ] **Step 6：提交**

```bash
git add src/workers/twitter-worker.ts src/probe.ts tests/workers/twitter-worker.test.ts tests/probe.test.ts
git commit -m "feat: add twitter worker reusing shared backoff helper"
```

---

## Task 13：Bot 静态资源 — callback-data + keyboards + messages

**Files:**
- Create: `tests/bot/callback-data.test.ts`
- Create: `src/bot/callback-data.ts`
- Create: `src/bot/keyboards.ts`
- Create: `src/bot/messages.ts`

- [ ] **Step 1：写 callback-data 失败测试**

`tests/bot/callback-data.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { encodeCallback, decodeCallback } from '../../src/bot/callback-data.js';

describe('callback data codec', () => {
  it('encodes and decodes simple action', () => {
    const data = encodeCallback({ action: 'menu' });
    expect(decodeCallback(data)).toEqual({ action: 'menu' });
  });

  it('encodes and decodes action with numeric id', () => {
    const data = encodeCallback({ action: 'src.toggle', id: 42 });
    expect(decodeCallback(data)).toEqual({ action: 'src.toggle', id: 42 });
  });

  it('encodes and decodes action with arg', () => {
    const data = encodeCallback({ action: 'add.type', arg: 'twitter' });
    expect(decodeCallback(data)).toEqual({ action: 'add.type', arg: 'twitter' });
  });

  it('returns null for malformed payloads', () => {
    expect(decodeCallback('garbage')).toBeNull();
    expect(decodeCallback('')).toBeNull();
  });

  it('keeps payload <= 64 bytes (Telegram limit)', () => {
    const data = encodeCallback({ action: 'src.subscribe.toggle', id: 999_999_999, arg: 'd:42' });
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/bot/callback-data.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写实现**

`src/bot/callback-data.ts`：

```ts
export interface CallbackPayload {
  action: string;
  id?: number;
  arg?: string;
}

const SEP = '|';

export function encodeCallback(payload: CallbackPayload): string {
  const parts = [payload.action];
  if (payload.id !== undefined) parts.push(`i=${payload.id}`);
  if (payload.arg !== undefined) parts.push(`a=${payload.arg}`);
  return parts.join(SEP);
}

export function decodeCallback(raw: string): CallbackPayload | null {
  if (!raw) return null;
  const parts = raw.split(SEP);
  const action = parts[0];
  if (!action) return null;
  const payload: CallbackPayload = { action };
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i] ?? '';
    if (segment.startsWith('i=')) {
      const num = Number.parseInt(segment.slice(2), 10);
      if (!Number.isFinite(num)) return null;
      payload.id = num;
    } else if (segment.startsWith('a=')) {
      payload.arg = segment.slice(2);
    } else {
      return null;
    }
  }
  return payload;
}
```

`src/bot/keyboards.ts`：

```ts
import { InlineKeyboard } from 'grammy';
import type { Destination, MonitorSource } from '@prisma/client';
import { encodeCallback } from './callback-data.js';
import { getAdapter } from '../monitors/registry.js';

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 监控列表', encodeCallback({ action: 'src.list' }))
    .text('➕ 添加监控', encodeCallback({ action: 'add.start' }))
    .row()
    .text('📡 推送目标', encodeCallback({ action: 'dest.list' }))
    .text('❓ 帮助', encodeCallback({ action: 'help' }));
}

export function sourceListKeyboard(sources: MonitorSource[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const source of sources) {
    kb.text(`#${source.id} ${describeShort(source)}`, encodeCallback({ action: 'src.show', id: source.id })).row();
  }
  kb.text('⬅ 返回', encodeCallback({ action: 'menu' }));
  return kb;
}

export function sourceActionsKeyboard(source: MonitorSource): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ 订阅推送目标', encodeCallback({ action: 'src.subs', id: source.id }))
    .row()
    .text(source.enabled ? '⏸ 停用' : '▶️ 启用', encodeCallback({ action: 'src.toggle', id: source.id }))
    .text('🗑 删除', encodeCallback({ action: 'src.delete', id: source.id }))
    .row()
    .text('⬅ 返回列表', encodeCallback({ action: 'src.list' }));
}

export function subscriptionPickerKeyboard(
  sourceId: number,
  destinations: Destination[],
  selectedIds: ReadonlySet<number>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dest of destinations) {
    const checked = selectedIds.has(dest.id) ? '☑' : '☐';
    const label = `${checked} ${dest.title ?? dest.telegramChatId}`;
    kb.text(label, encodeCallback({ action: 'src.sub.toggle', id: sourceId, arg: String(dest.id) })).row();
  }
  kb.text('💾 完成', encodeCallback({ action: 'src.show', id: sourceId }));
  return kb;
}

export function destinationListKeyboard(destinations: Destination[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dest of destinations) {
    const status = dest.enabled ? '✅' : '⏸';
    kb.text(
      `${status} ${dest.title ?? dest.telegramChatId}`,
      encodeCallback({ action: 'dest.toggle', id: dest.id })
    ).row();
  }
  kb.text('⬅ 返回', encodeCallback({ action: 'menu' }));
  return kb;
}

export function addTypePickerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🐦 Twitter', encodeCallback({ action: 'add.type', arg: 'twitter' }))
    .text('🌐 Website', encodeCallback({ action: 'add.type', arg: 'website' }))
    .text('📜 Contract', encodeCallback({ action: 'add.type', arg: 'contract' }))
    .row()
    .text('⬅ 取消', encodeCallback({ action: 'menu' }));
}

export function destinationDiscoveryKeyboard(destinationId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ 启用', encodeCallback({ action: 'dest.toggle', id: destinationId }))
    .text('❌ 忽略', encodeCallback({ action: 'dest.ignore', id: destinationId }));
}

function describeShort(source: MonitorSource): string {
  const adapter = getAdapter(source.type);
  return adapter.describe({
    type: source.type,
    target: source.target,
    normalizedTarget: source.normalizedTarget,
    configJson: (source.configJson ?? {}) as Record<string, unknown>
  });
}
```

`src/bot/messages.ts`：

```ts
import type { Destination, MonitorSource } from '@prisma/client';
import { getAdapter } from '../monitors/registry.js';

export const WELCOME = '👋 X Monitor Bot\n选择一个操作：';
export const HELP = [
  '可用命令：',
  '/start /menu - 主菜单',
  '/list - 监控源列表',
  '/destinations - 推送目标列表',
  '/add <type> <target> - 快速添加',
  '/remove <id> - 删除',
  '/enable <id> /disable <id> - 启停',
  '/cancel - 取消向导',
  '',
  '提示：',
  '- Twitter 关注/取关事件需要被监控账号粉丝 > 5000。',
  '- Website / Contract 类型 worker 暂未上线，仅入库不会推送。'
].join('\n');

export const STALE_BUTTON = '按钮已过期，请重新打开菜单 /menu';
export const RETRY = '操作失败，请稍后重试';
export const CANCELLED = '已取消';

export function describeSourceLine(source: MonitorSource): string {
  const adapter = getAdapter(source.type);
  const desc = adapter.describe({
    type: source.type,
    target: source.target,
    normalizedTarget: source.normalizedTarget,
    configJson: (source.configJson ?? {}) as Record<string, unknown>
  });
  const status = source.enabled ? '✅' : '⏸';
  return `#${source.id} ${status} ${desc}`;
}

export function describeDestinationLine(dest: Destination): string {
  const status = dest.enabled ? '✅' : '⏸';
  const name = dest.title ?? dest.telegramChatId;
  return `#${dest.id} ${status} ${name} (${dest.type})`;
}

export function newDestinationCard(dest: Destination): string {
  return [
    '🆕 检测到新的可用推送目标',
    `名称：${dest.title ?? '(无标题)'}`,
    `类型：${dest.type}`,
    `chat_id：${dest.telegramChatId}`,
    '',
    '点击下方按钮启用或忽略。'
  ].join('\n');
}

export function addTargetPrompt(type: string): string {
  switch (type) {
    case 'twitter':
      return '请发送 Twitter 用户名（不带 @）：';
    case 'website':
      return '请发送完整网站 URL（http:// 或 https://）：';
    case 'contract':
      return '请发送 <chain> <address>，例如：eth 0x1234...';
    default:
      return '请发送目标：';
  }
}

export function workerNotAvailableHint(type: string): string | null {
  if (type === 'website' || type === 'contract') {
    return '⚠️ 该监控类型 worker 暂未上线，事件不会被推送。';
  }
  return null;
}
```

- [ ] **Step 4：跑测试 + typecheck**

Run：

```bash
npm test tests/bot/callback-data.test.ts
npm run typecheck
```

Expected：5 个测试通过；typecheck 干净。

- [ ] **Step 5：提交**

```bash
git add src/bot/callback-data.ts src/bot/keyboards.ts src/bot/messages.ts tests/bot/callback-data.test.ts
git commit -m "feat: add bot callback codec, keyboards, and message templates"
```

---

## Task 14：Bot 中间件 — owner-guard + error-handler

**Files:**
- Create: `tests/bot/owner-guard.test.ts`
- Create: `src/bot/middleware/owner-guard.ts`
- Create: `src/bot/middleware/error-handler.ts`

- [ ] **Step 1：写 owner-guard 失败测试**

`tests/bot/owner-guard.test.ts`：

```ts
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
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/bot/owner-guard.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写实现**

`src/bot/middleware/owner-guard.ts`：

```ts
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
```

`src/bot/middleware/error-handler.ts`：

```ts
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
```

- [ ] **Step 4：跑测试 + typecheck**

Run：

```bash
npm test tests/bot/owner-guard.test.ts
npm run typecheck
```

Expected：3 个测试通过；typecheck 干净。

- [ ] **Step 5：提交**

```bash
git add src/bot/middleware/ tests/bot/owner-guard.test.ts
git commit -m "feat: add bot owner guard and global error handler"
```

---

## Task 15：Bot handlers — start / help / menu / list-sources / source-actions

**Files:**
- Create: `tests/bot/start.test.ts`
- Create: `tests/bot/list-sources.test.ts`
- Create: `tests/bot/source-actions.test.ts`
- Create: `src/bot/handlers/start.ts`
- Create: `src/bot/handlers/list-sources.ts`
- Create: `src/bot/handlers/source-actions.ts`

- [ ] **Step 1：写失败测试（行为级，mock service）**

`tests/bot/start.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleStart } from '../../src/bot/handlers/start.js';
import { WELCOME, HELP } from '../../src/bot/messages.js';

function makeCtx() {
  return { reply: vi.fn().mockResolvedValue(undefined) };
}

describe('handleStart', () => {
  it('sends welcome with main menu', async () => {
    const ctx = makeCtx();
    await handleStart.start(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(
      WELCOME,
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('sends help text', async () => {
    const ctx = makeCtx();
    await handleStart.help(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(HELP);
  });
});
```

`tests/bot/list-sources.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { createListSourcesHandler } from '../../src/bot/handlers/list-sources.js';

const fakeSource = {
  id: 1, type: 'twitter', target: 'elonmusk', normalizedTarget: 'elonmusk',
  configJson: {}, enabled: true, createdAt: new Date(), updatedAt: new Date()
} as never;

describe('listSources handler', () => {
  it('replies "无监控源" when list empty', async () => {
    const reply = vi.fn();
    const handler = createListSourcesHandler({ list: vi.fn().mockResolvedValue([]) } as never);
    await handler({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('无监控源'),
      expect.anything()
    );
  });

  it('renders one button per source', async () => {
    const reply = vi.fn();
    const handler = createListSourcesHandler({
      list: vi.fn().mockResolvedValue([fakeSource])
    } as never);
    await handler({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('监控源'),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
```

`tests/bot/source-actions.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSourceActionsHandler } from '../../src/bot/handlers/source-actions.js';

const fakeSource = {
  id: 1, type: 'twitter', target: 'elonmusk', normalizedTarget: 'elonmusk',
  configJson: {}, enabled: true, createdAt: new Date(), updatedAt: new Date()
} as never;

function makeServices() {
  return {
    sourceService: {
      findById: vi.fn().mockResolvedValue(fakeSource),
      setEnabled: vi.fn().mockResolvedValue({ ...fakeSource, enabled: false }),
      remove: vi.fn().mockResolvedValue(undefined)
    } as never,
    destinationService: {
      listEnabled: vi.fn().mockResolvedValue([])
    } as never,
    subscriptionService: {
      listDestinationIdsForSource: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(true)
    } as never
  };
}

describe('source-actions handler', () => {
  it('shows source detail with action keyboard', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services);
    const reply = vi.fn();
    await handler.show({ reply, answerCallbackQuery: vi.fn() } as never, 1);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('#1'),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('toggles enabled', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services);
    const reply = vi.fn();
    await handler.toggle({ reply, answerCallbackQuery: vi.fn() } as never, 1);
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(1, false);
  });

  it('deletes source', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services);
    const reply = vi.fn();
    await handler.delete({ reply, answerCallbackQuery: vi.fn() } as never, 1);
    expect(services.sourceService.remove).toHaveBeenCalledWith(1);
  });

  it('subscribe-toggle adds subscription if missing', async () => {
    const services = makeServices();
    const handler = createSourceActionsHandler(services);
    await handler.toggleSubscription({ answerCallbackQuery: vi.fn(), editMessageReplyMarkup: vi.fn(), editMessageText: vi.fn() } as never, 1, 5);
    expect(services.subscriptionService.subscribe).toHaveBeenCalledWith(1, 5);
  });

  it('subscribe-toggle removes subscription if present', async () => {
    const services = makeServices();
    services.subscriptionService.listDestinationIdsForSource = vi.fn().mockResolvedValue([5]);
    const handler = createSourceActionsHandler(services);
    await handler.toggleSubscription({ answerCallbackQuery: vi.fn(), editMessageReplyMarkup: vi.fn(), editMessageText: vi.fn() } as never, 1, 5);
    expect(services.subscriptionService.unsubscribe).toHaveBeenCalledWith(1, 5);
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/bot/start.test.ts tests/bot/list-sources.test.ts tests/bot/source-actions.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写实现**

`src/bot/handlers/start.ts`：

```ts
import type { Context } from 'grammy';
import { mainMenu } from '../keyboards.js';
import { HELP, WELCOME } from '../messages.js';

export const handleStart = {
  async start(ctx: Context): Promise<void> {
    await ctx.reply(WELCOME, { reply_markup: mainMenu() });
  },
  async help(ctx: Context): Promise<void> {
    await ctx.reply(HELP);
  }
};
```

`src/bot/handlers/list-sources.ts`：

```ts
import type { Context } from 'grammy';
import type { SourceService } from '../../services/source-service.js';
import { describeSourceLine } from '../messages.js';
import { sourceListKeyboard } from '../keyboards.js';

export function createListSourcesHandler(sourceService: SourceService) {
  return async function listSources(ctx: Context): Promise<void> {
    const sources = await sourceService.list();
    if (sources.length === 0) {
      await ctx.reply('无监控源。点击 ➕ 添加监控 来创建第一个。', { reply_markup: sourceListKeyboard([]) });
      return;
    }
    const text = ['监控源：', ...sources.map(describeSourceLine)].join('\n');
    await ctx.reply(text, { reply_markup: sourceListKeyboard(sources) });
  };
}
```

`src/bot/handlers/source-actions.ts`：

```ts
import type { Context } from 'grammy';
import type { SourceService } from '../../services/source-service.js';
import type { DestinationService } from '../../services/destination-service.js';
import type { SubscriptionService } from '../../services/subscription-service.js';
import { describeSourceLine, RETRY, STALE_BUTTON } from '../messages.js';
import {
  sourceActionsKeyboard,
  subscriptionPickerKeyboard
} from '../keyboards.js';

export interface ServicesBundle {
  sourceService: SourceService;
  destinationService: DestinationService;
  subscriptionService: SubscriptionService;
}

export function createSourceActionsHandler(services: ServicesBundle) {
  return {
    async show(ctx: Context, sourceId: number): Promise<void> {
      const source = await services.sourceService.findById(sourceId);
      if (!source) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      await ctx.reply(describeSourceLine(source), { reply_markup: sourceActionsKeyboard(source) });
    },
    async toggle(ctx: Context, sourceId: number): Promise<void> {
      const source = await services.sourceService.findById(sourceId);
      if (!source) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      const updated = await services.sourceService.setEnabled(sourceId, !source.enabled);
      await ctx.reply(`已${updated.enabled ? '启用' : '停用'} ${describeSourceLine(updated)}`, {
        reply_markup: sourceActionsKeyboard(updated)
      });
    },
    async delete(ctx: Context, sourceId: number): Promise<void> {
      try {
        await services.sourceService.remove(sourceId);
        await ctx.reply(`已删除 #${sourceId}`);
      } catch {
        await ctx.reply(RETRY);
      }
    },
    async subscriptionPicker(ctx: Context, sourceId: number): Promise<void> {
      const destinations = await services.destinationService.listEnabled();
      if (destinations.length === 0) {
        await ctx.reply('暂无启用的推送目标。先把 bot 拉进群/频道并启用它。');
        return;
      }
      const selected = new Set(await services.subscriptionService.listDestinationIdsForSource(sourceId));
      await ctx.reply('勾选要订阅的目标：', {
        reply_markup: subscriptionPickerKeyboard(sourceId, destinations, selected)
      });
    },
    async toggleSubscription(ctx: Context, sourceId: number, destinationId: number): Promise<void> {
      const current = new Set(await services.subscriptionService.listDestinationIdsForSource(sourceId));
      if (current.has(destinationId)) {
        await services.subscriptionService.unsubscribe(sourceId, destinationId);
      } else {
        await services.subscriptionService.subscribe(sourceId, destinationId);
      }
      const destinations = await services.destinationService.listEnabled();
      const updated = new Set(await services.subscriptionService.listDestinationIdsForSource(sourceId));
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: subscriptionPickerKeyboard(sourceId, destinations, updated)
        });
      } catch {
        // editMessageReplyMarkup 在某些场景下不可用：忽略
      }
    }
  };
}
```

- [ ] **Step 4：跑测试 + typecheck**

Run：

```bash
npm test tests/bot/start.test.ts tests/bot/list-sources.test.ts tests/bot/source-actions.test.ts
npm run typecheck
```

Expected：全部 PASS。

- [ ] **Step 5：提交**

```bash
git add src/bot/handlers/start.ts src/bot/handlers/list-sources.ts src/bot/handlers/source-actions.ts tests/bot/start.test.ts tests/bot/list-sources.test.ts tests/bot/source-actions.test.ts
git commit -m "feat: add bot handlers for start, list, and source actions"
```

---

## Task 16：Bot handler — add-source 向导（conversation）

**Files:**
- Create: `tests/bot/add-source.test.ts`
- Create: `src/bot/handlers/add-source.ts`

- [ ] **Step 1：写失败测试（仅 wizard 决策函数，避免 grammY conversations 难 mock）**

`tests/bot/add-source.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { performAddSource } from '../../src/bot/handlers/add-source.js';

const services = {
  sourceService: {
    create: vi.fn()
  } as never
};

describe('performAddSource', () => {
  it('creates source via service and returns success message', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: {
        id: 7, type: 'twitter', target: 'elonmusk', normalizedTarget: 'elonmusk',
        configJson: {}, enabled: true, createdAt: new Date(), updatedAt: new Date()
      },
      alreadyExisted: false
    });
    const result = await performAddSource(services as never, 'twitter', '@elonmusk');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已添加');
  });

  it('returns "already exists" when duplicate', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: { id: 7, type: 'twitter', target: 'elonmusk', normalizedTarget: 'elonmusk', configJson: {}, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      alreadyExisted: true
    });
    const result = await performAddSource(services as never, 'twitter', 'elonmusk');
    expect(result.message).toContain('已存在 #7');
  });

  it('appends worker-not-available hint for website', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: { id: 8, type: 'website', target: 'https://x.com', normalizedTarget: 'https://x.com', configJson: {}, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      alreadyExisted: false
    });
    const result = await performAddSource(services as never, 'website', 'https://x.com');
    expect(result.message).toContain('worker 暂未上线');
  });

  it('returns failure with adapter error message on validation error', async () => {
    services.sourceService.create = vi.fn().mockRejectedValue(new Error('Twitter 用户名仅允许字母...'));
    const result = await performAddSource(services as never, 'twitter', 'bad-user');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Twitter 用户名仅允许');
  });
});
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/bot/add-source.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写实现**

`src/bot/handlers/add-source.ts`：

```ts
import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import type { ServicesBundle } from './source-actions.js';
import { addTargetPrompt, workerNotAvailableHint, CANCELLED } from '../messages.js';
import { addTypePickerKeyboard, mainMenu } from '../keyboards.js';

export interface AddResult {
  ok: boolean;
  message: string;
}

export async function performAddSource(
  services: ServicesBundle,
  type: string,
  input: string
): Promise<AddResult> {
  try {
    const { source, alreadyExisted } = await services.sourceService.create({ type, input });
    const head = alreadyExisted
      ? `ℹ️ 已存在 #${source.id} ${type}:${source.normalizedTarget}`
      : `✅ 已添加 #${source.id} ${type}:${source.normalizedTarget}`;
    const hint = workerNotAvailableHint(type);
    return { ok: true, message: hint ? `${head}\n${hint}` : head };
  } catch (error) {
    return { ok: false, message: `❌ ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const ADD_SOURCE_CONVERSATION = 'add-source';

export function createAddSourceConversation(services: ServicesBundle) {
  return async function addSource(conversation: Conversation, ctx: Context): Promise<void> {
    await ctx.reply('选择监控类型：', { reply_markup: addTypePickerKeyboard() });
    const typeUpdate = await conversation.waitForCallbackQuery(/^add\.type\|a=/);
    const arg = typeUpdate.callbackQuery.data?.split('|a=')[1] ?? '';
    if (!['twitter', 'website', 'contract'].includes(arg)) {
      await ctx.reply(CANCELLED, { reply_markup: mainMenu() });
      return;
    }
    await typeUpdate.answerCallbackQuery();
    await ctx.reply(addTargetPrompt(arg));
    const text = await conversation.waitFor('message:text');
    const input = text.message.text.trim();
    if (!input || input === '/cancel') {
      await ctx.reply(CANCELLED, { reply_markup: mainMenu() });
      return;
    }
    const result = await performAddSource(services, arg, input);
    await ctx.reply(result.message, { reply_markup: mainMenu() });
  };
}

export function createAddSourceEntry() {
  return async function entry(ctx: Context): Promise<void> {
    await ctx.conversation?.enter(ADD_SOURCE_CONVERSATION);
  };
}
```

- [ ] **Step 4：跑测试 + typecheck**

Run：

```bash
npm test tests/bot/add-source.test.ts
npm run typecheck
```

Expected：4 个测试 PASS；typecheck 干净（注：`ctx.conversation` 类型在 main.ts 里通过 grammY conversations plugin 注入，本文件先用可选链）。

- [ ] **Step 5：提交**

```bash
git add src/bot/handlers/add-source.ts tests/bot/add-source.test.ts
git commit -m "feat: add bot conversation handler for add-source wizard"
```

---

## Task 17：Bot handlers — destinations + chat-member 自动发现

**Files:**
- Create: `tests/bot/destinations.test.ts`
- Create: `tests/bot/chat-member.test.ts`
- Create: `src/bot/handlers/destinations.ts`
- Create: `src/bot/handlers/chat-member.ts`

- [ ] **Step 1：写失败测试**

`tests/bot/destinations.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDestinationsHandler } from '../../src/bot/handlers/destinations.js';

const fakeDest = {
  id: 5, telegramChatId: '-100', type: 'group', title: 't', username: null,
  enabled: false, createdAt: new Date(), updatedAt: new Date()
} as never;

function makeService() {
  return {
    list: vi.fn().mockResolvedValue([fakeDest]),
    setEnabled: vi.fn().mockResolvedValue({ ...fakeDest, enabled: true }),
    findById: vi.fn().mockResolvedValue(fakeDest),
    remove: vi.fn().mockResolvedValue(undefined)
  } as never;
}

describe('destinations handler', () => {
  it('lists destinations', async () => {
    const service = makeService();
    const handler = createDestinationsHandler(service);
    const reply = vi.fn();
    await handler.list({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('推送目标'),
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('toggles enabled', async () => {
    const service = makeService();
    const handler = createDestinationsHandler(service);
    const reply = vi.fn();
    await handler.toggle({ reply } as never, 5);
    expect(service.setEnabled).toHaveBeenCalledWith(5, true);
  });

  it('ignores destination by deleting it', async () => {
    const service = makeService();
    const handler = createDestinationsHandler(service);
    const reply = vi.fn();
    await handler.ignore({ reply } as never, 5);
    expect(service.remove).toHaveBeenCalledWith(5);
  });
});
```

`tests/bot/chat-member.test.ts`：

```ts
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
```

- [ ] **Step 2：跑测试看失败**

Run：

```bash
npm test tests/bot/destinations.test.ts tests/bot/chat-member.test.ts
```

Expected：FAIL。

- [ ] **Step 3：写实现**

`src/bot/handlers/destinations.ts`：

```ts
import type { Context } from 'grammy';
import type { DestinationService } from '../../services/destination-service.js';
import { describeDestinationLine, STALE_BUTTON } from '../messages.js';
import { destinationListKeyboard } from '../keyboards.js';

export function createDestinationsHandler(service: DestinationService) {
  return {
    async list(ctx: Context): Promise<void> {
      const destinations = await service.list();
      if (destinations.length === 0) {
        await ctx.reply('暂无推送目标。把 bot 拉进群/频道即可自动发现。');
        return;
      }
      const text = ['推送目标：', ...destinations.map(describeDestinationLine)].join('\n');
      await ctx.reply(text, { reply_markup: destinationListKeyboard(destinations) });
    },
    async toggle(ctx: Context, destinationId: number): Promise<void> {
      const current = await service.findById(destinationId);
      if (!current) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      const updated = await service.setEnabled(destinationId, !current.enabled);
      await ctx.reply(`已${updated.enabled ? '启用' : '停用'} ${describeDestinationLine(updated)}`);
    },
    async ignore(ctx: Context, destinationId: number): Promise<void> {
      await service.remove(destinationId);
      await ctx.reply(`已忽略并删除 #${destinationId}`);
    }
  };
}
```

`src/bot/handlers/chat-member.ts`：

```ts
import type { Api, Context } from 'grammy';
import type { DestinationService } from '../../services/destination-service.js';
import { newDestinationCard } from '../messages.js';
import { destinationDiscoveryKeyboard } from '../keyboards.js';

const ADDED_STATUSES = new Set(['member', 'administrator', 'restricted']);

export interface ChatMemberDeps {
  botId: number;
  ownerUserIds: number[];
  discover: DestinationService['discover'];
  api: Pick<Api, 'sendMessage'>;
}

export async function handleChatMemberUpdate(
  update: NonNullable<Context['myChatMember']>,
  deps: ChatMemberDeps
): Promise<void> {
  const target = update.new_chat_member;
  if (target.user.id !== deps.botId) return;
  if (!ADDED_STATUSES.has(target.status)) return;
  const chat = update.chat;
  const result = await deps.discover({
    telegramChatId: String(chat.id),
    type: chat.type,
    title: 'title' in chat ? chat.title ?? null : null,
    username: 'username' in chat ? chat.username ?? null : null
  });
  for (const ownerId of deps.ownerUserIds) {
    try {
      await deps.api.sendMessage(ownerId, newDestinationCard(result.destination), {
        reply_markup: destinationDiscoveryKeyboard(result.destination.id)
      });
    } catch (error) {
      console.warn(
        `chat-member: failed to DM owner ${ownerId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
```

- [ ] **Step 4：跑测试 + typecheck**

Run：

```bash
npm test tests/bot/destinations.test.ts tests/bot/chat-member.test.ts
npm run typecheck
```

Expected：6 个测试 PASS；typecheck 干净。

- [ ] **Step 5：提交**

```bash
git add src/bot/handlers/destinations.ts src/bot/handlers/chat-member.ts tests/bot/destinations.test.ts tests/bot/chat-member.test.ts
git commit -m "feat: add bot handlers for destinations and chat-member auto-discovery"
```

---

## Task 18：Bot 主入口装配

**Files:**
- Create: `src/bot/main.ts`

无单测：本文件主要是装配胶水，行为已经在前面 17 个 task 覆盖。集成测试在 Task 19。

- [ ] **Step 1：写 main.ts**

`src/bot/main.ts`：

```ts
import 'dotenv/config';
import { Bot, session, type Context, type SessionFlavor } from 'grammy';
import { conversations, createConversation, type ConversationFlavor } from '@grammyjs/conversations';
import { parseBotConfig } from '../config.js';
import { getPrismaClient, disconnectPrisma } from '../store/prisma.js';
import { createRedisClient, createRedisHelpers } from '../store/redis.js';
import { createSourceService } from '../services/source-service.js';
import { createDestinationService } from '../services/destination-service.js';
import { createSubscriptionService } from '../services/subscription-service.js';
import { createEventService } from '../services/event-service.js';
import { createDispatcher } from '../routing/dispatcher.js';
import { startTwitterWorker } from '../workers/twitter-worker.js';
import { createOwnerGuard } from './middleware/owner-guard.js';
import { attachErrorHandler } from './middleware/error-handler.js';
import { decodeCallback } from './callback-data.js';
import { handleStart } from './handlers/start.js';
import { createListSourcesHandler } from './handlers/list-sources.js';
import { createSourceActionsHandler, type ServicesBundle } from './handlers/source-actions.js';
import {
  ADD_SOURCE_CONVERSATION,
  createAddSourceConversation,
  createAddSourceEntry,
  performAddSource
} from './handlers/add-source.js';
import { createDestinationsHandler } from './handlers/destinations.js';
import { handleChatMemberUpdate } from './handlers/chat-member.js';
import { mainMenu } from './keyboards.js';
import { CANCELLED, RETRY, STALE_BUTTON } from './messages.js';

type AppContext = Context & SessionFlavor<unknown> & ConversationFlavor;

async function main(): Promise<void> {
  const config = parseBotConfig(process.env);

  const prisma = getPrismaClient();
  await prisma.$connect();

  const redis = createRedisClient(config.redisUrl);
  await redis.ping();
  const redisHelpers = createRedisHelpers(redis);

  const sourceService = createSourceService(prisma);
  const destinationService = createDestinationService(prisma);
  const subscriptionService = createSubscriptionService(prisma);
  const eventService = createEventService(prisma, redisHelpers);

  const services: ServicesBundle = {
    sourceService,
    destinationService,
    subscriptionService
  };

  const bot = new Bot<AppContext>(config.telegramBotToken);
  const me = await bot.api.getMe();

  attachErrorHandler(bot);

  bot.use(createOwnerGuard(config.ownerUserIds));
  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(createAddSourceConversation(services), ADD_SOURCE_CONVERSATION));

  bot.command(['start', 'menu'], (ctx) => handleStart.start(ctx));
  bot.command('help', (ctx) => handleStart.help(ctx));
  bot.command('cancel', async (ctx) => {
    await ctx.conversation.exit();
    await ctx.reply(CANCELLED, { reply_markup: mainMenu() });
  });

  const listSources = createListSourcesHandler(sourceService);
  const sourceActions = createSourceActionsHandler(services);
  const destinations = createDestinationsHandler(destinationService);

  bot.command('list', listSources);
  bot.command('destinations', destinations.list);
  bot.command('add', async (ctx) => {
    const args = (ctx.match ?? '').toString().trim().split(/\s+/);
    if (args.length < 2 || !args[0] || !args[1]) {
      await ctx.reply('用法：/add <type> <target>');
      return;
    }
    const [type, ...rest] = args;
    const result = await performAddSource(services, type, rest.join(' '));
    await ctx.reply(result.message, { reply_markup: mainMenu() });
  });
  bot.command('remove', async (ctx) => {
    const id = Number.parseInt((ctx.match ?? '').toString().trim(), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply('用法：/remove <id>');
      return;
    }
    await sourceActions.delete(ctx, id);
  });
  bot.command(['enable', 'disable'], async (ctx) => {
    const id = Number.parseInt((ctx.match ?? '').toString().trim(), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply('用法：/enable <id> 或 /disable <id>');
      return;
    }
    await sourceActions.toggle(ctx, id);
  });

  bot.callbackQuery(/.+/, async (ctx, next) => {
    const payload = decodeCallback(ctx.callbackQuery.data ?? '');
    if (!payload) {
      await ctx.answerCallbackQuery({ text: STALE_BUTTON });
      return;
    }
    try {
      switch (payload.action) {
        case 'menu':
          await ctx.answerCallbackQuery();
          await handleStart.start(ctx);
          break;
        case 'help':
          await ctx.answerCallbackQuery();
          await handleStart.help(ctx);
          break;
        case 'src.list':
          await ctx.answerCallbackQuery();
          await listSources(ctx);
          break;
        case 'src.show':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.show(ctx, payload.id);
          break;
        case 'src.toggle':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.toggle(ctx, payload.id);
          break;
        case 'src.delete':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.delete(ctx, payload.id);
          break;
        case 'src.subs':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await sourceActions.subscriptionPicker(ctx, payload.id);
          break;
        case 'src.sub.toggle':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined && payload.arg) {
            const destId = Number.parseInt(payload.arg, 10);
            if (Number.isFinite(destId)) {
              await sourceActions.toggleSubscription(ctx, payload.id, destId);
            }
          }
          break;
        case 'dest.list':
          await ctx.answerCallbackQuery();
          await destinations.list(ctx);
          break;
        case 'dest.toggle':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await destinations.toggle(ctx, payload.id);
          break;
        case 'dest.ignore':
          await ctx.answerCallbackQuery();
          if (payload.id !== undefined) await destinations.ignore(ctx, payload.id);
          break;
        case 'add.start': {
          await ctx.answerCallbackQuery();
          const entry = createAddSourceEntry();
          await entry(ctx);
          break;
        }
        case 'add.type':
          // 由 conversation 内 waitForCallbackQuery 处理；此处兜底答应
          await ctx.answerCallbackQuery();
          break;
        default:
          await ctx.answerCallbackQuery({ text: STALE_BUTTON });
      }
    } catch (error) {
      console.error('callback handler failed:', error);
      try {
        await ctx.reply(RETRY);
      } catch {
        /* ignore */
      }
    }
    return next();
  });

  bot.on('my_chat_member', async (ctx) => {
    await handleChatMemberUpdate(ctx.myChatMember, {
      botId: me.id,
      ownerUserIds: config.ownerUserIds,
      discover: destinationService.discover,
      api: bot.api
    });
  });

  await bot.api.setMyCommands([
    { command: 'start', description: '主菜单' },
    { command: 'menu', description: '主菜单' },
    { command: 'help', description: '使用说明' },
    { command: 'list', description: '监控源列表' },
    { command: 'destinations', description: '推送目标列表' },
    { command: 'add', description: '添加监控：/add <type> <target>' },
    { command: 'remove', description: '删除：/remove <id>' },
    { command: 'enable', description: '启用：/enable <id>' },
    { command: 'disable', description: '停用：/disable <id>' },
    { command: 'cancel', description: '取消向导' }
  ]);

  const initialOffset = await redisHelpers.getOffset();
  const stopWorker = await startTwitterWorker({
    twitterToken: config.twitterToken,
    watchAccounts: (await sourceService.listEnabledTwitterSources()).map((s) => s.normalizedTarget),
    deps: {
      findSourceIdByAccount: async (account) => {
        const source = await prisma.monitorSource.findUnique({
          where: { type_normalizedTarget: { type: 'twitter', normalizedTarget: account.toLowerCase() } }
        });
        return source && source.enabled ? source.id : null;
      },
      recordEvent: (input) => eventService.recordEvent(input),
      fanOut: createDispatcher({
        sendMessage: async (chatId, text) => {
          await bot.api.sendMessage(chatId, text);
        },
        listDestinationsForSource: (sourceId) => subscriptionService.listDestinationsForSource(sourceId),
        recordDelivery: (delivery) => eventService.recordDelivery(delivery)
      }).fanOut
    }
  });

  const startPolling = bot.start({
    onStart: () => console.info(`Bot @${me.username} started`),
    drop_pending_updates: false,
    allowed_updates: ['message', 'callback_query', 'my_chat_member', 'edited_message'],
    offset: initialOffset
  });

  const persistOffset = setInterval(async () => {
    const last = bot.lastTriggeredUpdateId;
    if (typeof last === 'number') {
      await redisHelpers.setOffset(last + 1);
    }
  }, 5_000);

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`Received ${signal}, shutting down`);
    clearInterval(persistOffset);
    stopWorker();
    await bot.stop();
    await redis.quit();
    await disconnectPrisma();
    await startPolling.catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

> 注意：grammY 的 `bot.start()` 选项里没有现成的 `lastTriggeredUpdateId` 字段；如果 grammY 版本不暴露，则改为：
> - 在 `bot.use((ctx, next) => { lastUpdateId = ctx.update.update_id; return next(); })` 中累积。
> 实施时若类型报错，按 grammY 实际 API 调整为：
> ```ts
> let lastUpdateId: number | undefined;
> bot.use(async (ctx, next) => { lastUpdateId = ctx.update.update_id; await next(); });
> // setInterval 内部读 lastUpdateId
> ```

- [ ] **Step 2：跑 typecheck**

Run：

```bash
npm run typecheck
```

Expected：PASS。如 grammY API 表面与计划存在差异，按上面注释的 fallback 调整 `lastTriggeredUpdateId`。

- [ ] **Step 3：跑全量单测**

Run：

```bash
npm run test:unit
```

Expected：所有单测 PASS（包括 probe 老测试 + 全部新测试）。

- [ ] **Step 4：提交**

```bash
git add src/bot/main.ts
git commit -m "feat: assemble bot main entry with polling, worker, and dispatcher"
```

---

## Task 19：集成测试 + README 更新 + 手动验收

**Files:**
- Create: `tests/integration/prisma-roundtrip.test.ts`
- Create: `tests/integration/dispatcher-e2e.test.ts`
- Modify: `README.md`

- [ ] **Step 1：写 Prisma roundtrip 集成测试**

`tests/integration/prisma-roundtrip.test.ts`：

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_monitor';
const prisma = new PrismaClient({ datasources: { db: { url } } });

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.deliveryLog.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.monitorSource.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.$disconnect();
});

describe('prisma roundtrip', () => {
  it('creates and reads MonitorSource via unique key', async () => {
    const created = await prisma.monitorSource.create({
      data: {
        type: 'twitter',
        target: 'integration-user',
        normalizedTarget: 'integration-user',
        configJson: {},
        enabled: true
      }
    });
    const found = await prisma.monitorSource.findUnique({
      where: { type_normalizedTarget: { type: 'twitter', normalizedTarget: 'integration-user' } }
    });
    expect(found?.id).toBe(created.id);
  });

  it('cascades subscription when source is deleted', async () => {
    const source = await prisma.monitorSource.create({
      data: { type: 'twitter', target: 'tmp', normalizedTarget: 'tmp', configJson: {}, enabled: true }
    });
    const dest = await prisma.destination.create({
      data: { telegramChatId: '-100777', type: 'group', enabled: true }
    });
    await prisma.subscription.create({ data: { sourceId: source.id, destinationId: dest.id, enabled: true } });
    await prisma.monitorSource.delete({ where: { id: source.id } });
    expect(await prisma.subscription.count({ where: { sourceId: source.id } })).toBe(0);
  });

  it('rejects duplicate normalized target via unique constraint', async () => {
    await prisma.monitorSource.create({
      data: { type: 'twitter', target: 'dupe', normalizedTarget: 'dupe', configJson: {}, enabled: true }
    });
    await expect(
      prisma.monitorSource.create({
        data: { type: 'twitter', target: 'dupe', normalizedTarget: 'dupe', configJson: {}, enabled: true }
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 2：写 dispatcher 端到端集成测试**

`tests/integration/dispatcher-e2e.test.ts`：

```ts
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import { createRedisHelpers, type RedisLike } from '../../src/store/redis.js';
import { createSubscriptionService } from '../../src/services/subscription-service.js';
import { createEventService } from '../../src/services/event-service.js';
import { createDispatcher } from '../../src/routing/dispatcher.js';

const url = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_monitor';
const prisma = new PrismaClient({ datasources: { db: { url } } });
const redis = new RedisMock() as unknown as RedisLike;
const redisHelpers = createRedisHelpers(redis);

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.deliveryLog.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.monitorSource.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.$disconnect();
});

describe('dispatcher end-to-end (real PG + mock redis + mock telegram)', () => {
  it('records event and fans out to all enabled destinations', async () => {
    const source = await prisma.monitorSource.create({
      data: { type: 'twitter', target: 'e2e', normalizedTarget: 'e2e', configJson: {}, enabled: true }
    });
    const dest = await prisma.destination.create({
      data: { telegramChatId: '-200', type: 'group', enabled: true }
    });
    await prisma.subscription.create({ data: { sourceId: source.id, destinationId: dest.id, enabled: true } });

    const subscriptionService = createSubscriptionService(prisma);
    const eventService = createEventService(prisma, redisHelpers);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createDispatcher({
      sendMessage,
      listDestinationsForSource: subscriptionService.listDestinationsForSource,
      recordDelivery: eventService.recordDelivery
    });

    const recorded = await eventService.recordEvent({
      sourceId: source.id,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:e2e:NEW_TWEET:1',
      rawJson: { hello: 'world' }
    });
    expect(recorded.deduped).toBe(false);
    expect(recorded.event).not.toBeNull();
    await dispatcher.fanOut({ eventLogId: recorded.event!.id, sourceId: source.id, text: 'hi' });

    expect(sendMessage).toHaveBeenCalledWith('-200', 'hi');
    const deliveries = await prisma.deliveryLog.findMany({ where: { eventLogId: recorded.event!.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('ok');

    // 二次 dedupe：同 dedupeKey 不再写入
    const second = await eventService.recordEvent({
      sourceId: source.id,
      eventType: 'NEW_TWEET',
      dedupeKey: 'tw:e2e:NEW_TWEET:1',
      rawJson: {}
    });
    expect(second.deduped).toBe(true);
  });
});
```

- [ ] **Step 3：跑集成测试（确保 docker 容器已起、迁移已跑）**

Run：

```bash
npm run db:up
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npx prisma migrate deploy
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npm test tests/integration/
```

Expected：PASS。

- [ ] **Step 4：跑全量测试 + typecheck**

Run：

```bash
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npm test
npm run typecheck
```

Expected：单测 + 集成测全 PASS；typecheck 干净。

- [ ] **Step 5：更新 README**

替换 `README.md` 内容为：

```md
# X Monitor Bot

OpenTwitter 6551 + Telegram 监控控制面。

## 两条命令

- `npm run dev` — 老 OpenTwitter WSS 探针，仅诊断 6551 通道连通性，不依赖 PG / Redis。
- `npm run bot` — Telegram 控制面 bot（生产入口）：DM 私聊驱动、PG/Redis 持久化、Twitter 事件分发。

## 准备

```bash
cp .env.example .env
# 填写：TELEGRAM_BOT_TOKEN / OWNER_USER_IDS / TWITTER_TOKEN
npm install
npm run db:up
npm run db:migrate
```

## 启动 bot

```bash
npm run bot
```

启动后在 Telegram 私聊向 bot 发 `/start`，按按钮配置：

1. ➕ 添加监控 → 选择 Twitter → 输入用户名（不带 @）
2. 把 bot 拉进群/频道：bot 会在 DM 自动通知"新推送目标"
3. 启用该目标 → 监控源详情里点击"➕ 订阅推送目标"
4. 勾选目标 → 完成

## 监控类型

| 类型 | 第一阶段状态 |
|---|---|
| `twitter` | ✅ 真实接 6551 WSS，事件即时推送 |
| `website` | ⚠️ 仅入库，worker 暂未上线 |
| `contract` | ⚠️ 仅入库，worker 暂未上线 |

## 已知约束

- 6551 关注/取关事件需要被监控账号粉丝数 > 5000。
- bot 第一阶段仅 long polling，未实现 webhook。

## 测试

```bash
npm run test:unit       # 不依赖 docker
npm test                # 包含集成测，需要 docker 起来
npm run typecheck
```

## 老探针（诊断用）

```bash
npm run dev
```

仅当排查"6551 是否还能正常推 WSS"时使用。它只读 `.env` 中的 `WATCH_ACCOUNTS` / `TELEGRAM_CHAT_ID` / `LOG_DIR`，不读 PG。
```

- [ ] **Step 6：手动验收（按 spec 验收清单逐项核对）**

执行下面每一项前，确保：
- 已创建 Telegram bot（@BotFather），把 token 填入 `.env`。
- `OWNER_USER_IDS` 填入你自己的 Telegram user id（可在 @userinfobot 查询）。
- `TWITTER_TOKEN` 填入 6551 token。

然后逐项：

```text
[ ] 全新机器：npm run db:up && npm run db:migrate 通过
[ ] npm run bot 启动看到 "Bot @xxx started"
[ ] DM 给 bot 发 /start：看到主菜单
[ ] 用另一个非 owner 账号发任意消息：bot 不回复
[ ] 把 bot 拉进测试群：DM 收到推送目标卡片
[ ] 点击"启用"：看到 "已启用 ..."
[ ] 主菜单 → ➕ 添加监控 → Twitter → 输入 elonmusk（>5000 粉丝）：✅ 已添加
[ ] 主菜单 → ➕ 添加监控 → Website → https://example.com：✅ 已添加 + ⚠️ worker 暂未上线
[ ] 主菜单 → ➕ 添加监控 → Contract → eth 0x... ：✅ 已添加 + ⚠️ worker 暂未上线
[ ] /list：所有 source 显示
[ ] 在 source 详情里订阅启用的群：保存成功
[ ] elonmusk 实际发推：测试群收到推送
[ ] 同事件不重复推送（dedupe）
[ ] kill bot 进程 → 重启：重启期间发的 /list 命令仍能被处理
[ ] 关停 PG（docker stop x-monitor-postgres）：bot 启动失败退出 1（如果是已启动则下一条命令回复"操作失败请重试"，不崩）
[ ] 恢复 PG → bot 重新可用
[ ] npm test 全绿 / npm run typecheck 干净
[ ] npm run dev 老探针仍能跑
```

- [ ] **Step 7：提交集成测试与 README**

```bash
git add tests/integration/ README.md
git commit -m "test: add prisma roundtrip and dispatcher e2e integration tests; update README"
```

---

## 自审记录

**Spec 覆盖检查：**
- 用户模型（单 owner、OWNER_USER_IDS、非 owner 静默丢弃）：Task 4 + 14。
- DM 按钮交互：Task 13/15/16/17/18。
- 推送目标自动发现（my_chat_member）：Task 17。
- Source / Destination / Subscription / Event / Delivery：Task 7-11、12-13 模型 + 服务。
- PostgreSQL 唯一真相：Task 2 schema、Task 5 prisma 单例、Task 19 集成测。
- Redis 仅运行时（dedupe / offset）：Task 5、Task 10、Task 18。
- Docker Compose 部署：Task 1。
- Prisma + ioredis + grammY：Task 1 deps + Task 5 + Task 18。
- Twitter adapter 真实接通：Task 6 + Task 12 + Task 18。
- website / contract 控制面占位：Task 6（adapter）+ Task 13（messages "worker 暂未上线"）+ Task 16（add hint）。
- 6551 watch-add：Task 12 复用 `src/open-twitter.ts`。
- WSS 重连 jitter：Task 3（helper）+ Task 12（worker 应用 + 同步给 probe + 调整 probe 测试）。
- Telegram 429 由 grammY 自带：未在代码中显式处理（grammY 默认 retry on 429），Task 18 attachErrorHandler 兜底。
- delivery_logs：Task 10 + Task 11 + Task 19 集成测。
- dedupe 双保险（Redis SETNX + PG unique）：Task 10。
- bot 重启 offset 恢复：Task 5 helper + Task 18 main 内的 setInterval。
- 老 probe 保留：Task 12 仅替换 backoff 调用，其余保留；README 标注。
- 老 .env WATCH_ACCOUNTS 不迁移：spec 已说，plan 未引入迁移代码。
- 验收清单与 spec 对齐：Task 19 Step 6。

**Placeholder 扫描：**
- Task 18 内 grammY `lastTriggeredUpdateId` API 不一定存在，已在原步骤中给出 fallback 实现并明确告知实施者按报错调整。这是已知的运行时差异，不算 placeholder。
- 全文无 "TBD"、"TODO"、"implement later"、"add error handling"、"similar to Task N" 等模式。
- 每个步骤要么是命令、要么是完整代码块、要么是文件具体改动指令。

**类型一致性：**
- `MonitorSource` / `Destination` / `Subscription` / `EventLog` / `DeliveryLog` 跨 Task 7-11、15、17、19 一致使用 Prisma 生成的类型。
- `MonitorAdapter` / `NormalizedTarget` / `MonitorSourceShape` / `ValidationError`：Task 6 定义后，Task 7 source-service 通过 registry 间接使用。
- `RedisHelpers`：Task 5 定义；Task 10 接受其 `tryClaimDedupe` 子集；Task 18 装配。
- `SourceService` / `DestinationService` / `SubscriptionService` / `EventService`：Task 7-10 定义；Task 13/15/17/18 装配。
- `ServicesBundle`：Task 15 source-actions 定义并被 Task 16/18 复用。
- `DispatcherDeps` / `DispatchEvent`：Task 11 定义，Task 18 装配。
- `HandleWorkerDeps` / `StartTwitterWorkerOptions`：Task 12 定义，Task 18 装配。
- `CallbackPayload` / `encodeCallback` / `decodeCallback`：Task 13 定义，Task 18 使用。
