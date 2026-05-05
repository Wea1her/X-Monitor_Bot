# Telegram 监控 Bot 控制面 v2 设计

## 背景

当前项目是一个单用户 OpenTwitter WSS 探针。探针从 `.env` 读取 `WATCH_ACCOUNTS`、调用 6551 watch-add、订阅 6551 WSS 事件、写入原始 NDJSON 日志，并可选地推送到固定的 Telegram chat。

下一阶段是 Telegram Bot 控制面。Bot 让 owner 在 Telegram 私聊中通过按钮管理监控源和推送目标，把配置和事件历史持久化到 PostgreSQL，Redis 仅承担运行时缓存/锁，老 probe 保留为诊断工具。

## 目标

- 提供一个私人单 owner 的 Telegram bot。
- 以 Telegram 私聊（DM）作为主要控制面。
- 用 inline 按钮完成新增、列表、启用、停用、删除、订阅监控的全部流程。
- bot 被加入群组/频道时自动发现并入库为待启用推送目标。
- 把 Twitter 事件推送到 owner 选择的 Telegram 群/频道。
- 监控源、推送目标、订阅关系、事件、投递结果存入 PostgreSQL。
- Redis 只做运行时 polling offset、事件去重、短期锁。
- 保留 `npm run dev` 探针作为 6551 通道诊断工具。
- 第一阶段为 Twitter / website / contract 三种类型实现按钮流程，但只有 Twitter 接入真实 worker。

## 非目标

- 不支持多用户。
- 不做商业化/SaaS、计费、套餐管理。
- 本阶段不做 Web 管理后台。
- 不实现 Telegram webhook 模式，仅使用 long polling。
- 本阶段不实现 website worker。
- 本阶段不实现 contract worker。
- 不主动做 Telegram 限频，仅依赖 Telegram 429 退避。
- 不自动迁移老 `.env` 中的 `WATCH_ACCOUNTS`。

## 用户模型

系统只服务一位 owner。`OWNER_USER_IDS` 包含被允许与 bot 交互的 Telegram 用户 ID。所有非 owner 的 update 都被静默丢弃，不做任何回复。

owner 在与 bot 的私聊中完成全部配置。群组和频道仅作为推送目标。当 bot 被加入群或频道时，会收到 `my_chat_member` 事件，bot 把该 chat 入库为禁用状态的 destination，并向 owner 私聊发送一张可启用/忽略的卡片。

## 部署决策

第一阶段采用方案 A：PostgreSQL 与 Redis 在本地与 VPS 都通过 Docker Compose 自托管。

应用层必须把 `DATABASE_URL` 与 `REDIS_URL` 作为唯一连接边界。如未来 PG 迁到 Supabase / Neon、Redis 迁到 Upstash 等托管服务，仅修改环境变量即可，不应改任何代码。

## 进程拓扑

两条命令保持独立：

```text
npm run dev  -> 现有 OpenTwitter WSS 探针，仅诊断用
npm run bot  -> Telegram 控制面 bot，生产入口
```

探针的价值在于不依赖 PostgreSQL / Redis / 控制面就能验证 6551 REST/WSS 通道是否健康。README 应明确标注它是诊断工具。

bot 进程内部并行运行：

- grammY long polling 接收 Telegram 更新。
- Twitter worker 维持 6551 WSS 长连。
- Dispatcher 把事件 fan-out 到目标。
- Prisma 与 ioredis 客户端单例。

## 架构

```text
Bot 层 (src/bot/)
  - grammY commands、callback queries、conversations、my_chat_member
  - owner guard 中间件
  - inline keyboards 与对用户可见的文案

Service 层 (src/services/)
  - source / destination / subscription / event 的业务编排

Monitor Registry (src/monitors/)
  - 通用 MonitorAdapter 接口
  - twitter / website / contract 的 target 校验与描述

Workers (src/workers/)
  - 第一阶段只包含 twitter-worker
  - 连接 6551 WSS 并发出标准化事件

Routing (src/routing/)
  - dispatcher 把事件映射到启用的 subscription / destination
  - 调 Telegram API 推送并记录投递结果

Store (src/store/)
  - Prisma 客户端单例
  - ioredis 客户端单例与 helper 函数
```

## 数据流

### 配置流

```text
Owner DM -> bot 按钮/命令 -> service -> monitor adapter 校验 -> PostgreSQL
```

示例：

```text
Owner 添加 twitter:elonmusk
  -> source-service 通过 twitter-adapter 校验
  -> monitor_sources 写入：type=twitter, normalizedTarget=elonmusk
```

### 推送目标自动发现流

```text
bot 被拉入群/频道
  -> 收到 Telegram my_chat_member 事件
  -> destination-service upsert，enabled=false
  -> bot 在 DM 给 owner 发卡片：启用 / 忽略
  -> owner 启用 destination
```

### 事件流

```text
PostgreSQL 中已启用的 twitter sources
  -> twitter-worker 调用 6551 watch-add
  -> twitter-worker 建立 6551 WSS 长连
  -> 6551 推原始事件
  -> worker 找到对应 source
  -> Redis SETNX dedupe key（24h TTL）
  -> event-service 写 event_logs
  -> dispatcher 加载启用的 subscriptions / destinations
  -> 通过 grammY API 调 Telegram sendMessage
  -> event-service 写 delivery_logs（status=ok|error）
```

PostgreSQL 决定监控谁、推到哪里。6551 WSS 只是外部实时事件流。**数据库永远不直接连 6551**，是 bot 进程同时连接两边。

## 监控类型

### Twitter

第一阶段包含真实 Twitter 监控：

- 用户名校验：去掉首尾空白和前导 `@`。
- 拒绝空用户名和非法 handle。
- 标准化 target 不带 `@`。
- 复用现有 6551 watch-add REST 客户端。
- 接收 6551 WSS 推送的事件。
- 把事件推送到所有已订阅的 destination。

已知外部约束：6551 关注/取关事件要求被监控账号粉丝数 > 5000 才会推送。这一点应记录在帮助文案或排障文档中。

### Website

第一阶段只实现控制面行为：

- 校验 `http://` 或 `https://` URL。
- 标准化 URL 后入库。
- 列表中显示明显的"worker 暂未上线"标记。
- 不启动 website worker，不发送 website 事件。

### Contract

第一阶段只实现控制面行为：

- 校验链名与地址格式。
- 初期支持的链：`eth`、`bsc`、`sol`。
- 标准化链名 + 地址后入库。
- 列表中显示明显的"worker 暂未上线"标记。
- 不启动 contract worker，不发送 contract 事件。

## Prisma 数据模型

```prisma
model MonitorSource {
  id                Int                @id @default(autoincrement())
  type              String
  target            String
  normalizedTarget  String             @map("normalized_target")
  configJson        Json               @map("config_json")
  enabled           Boolean            @default(true)
  createdAt         DateTime           @default(now()) @map("created_at")
  updatedAt         DateTime           @updatedAt @map("updated_at")

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
  updatedAt       DateTime       @updatedAt @map("updated_at")

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

  source        MonitorSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
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

  event         EventLog?    @relation(fields: [eventLogId], references: [id], onDelete: SetNull)
  destination   Destination  @relation(fields: [destinationId], references: [id], onDelete: Cascade)

  @@index([destinationId, sentAt])
  @@map("delivery_logs")
}
```

`Destination.enabled` 在 schema 层默认 `true`，但通过 `my_chat_member` 自动发现写入的 destination **必须显式设置为 `enabled=false`**，等待 owner 主动启用。

## Redis 键约定

| Key | 用途 | TTL |
| --- | --- | --- |
| `tg:offset` | Telegram polling offset 持久化 | 永久 |
| `dedupe:event:<key>` | 通过 SETNX 做事件去重 | 24h |
| `lock:source:<source_id>` | 可选：source 处理短期锁 | 短 TTL |

Redis 不能成为业务数据真相。

## 去重 Key 策略

Twitter 事件：

```text
tw:<twAccount>:<eventType>:<content.id 或 sha1(原始事件 payload)>
```

worker 优先尝试 Redis `SET key value NX EX 86400`。若 Redis 不可用，由 PostgreSQL `event_logs.dedupeKey` 唯一约束兜底。重复事件不参与分发。

## Bot UX

### 主菜单

```text
X Monitor Bot

[监控列表] [添加监控]
[删除监控] [推送目标]
[帮助]
```

### 添加监控向导

```text
Owner 点击"添加监控"
  -> bot 询问监控类型：Twitter / Website / Contract
  -> Owner 选择类型
  -> bot 请求输入 target
  -> adapter 校验 target
  -> source-service upsert source
  -> bot 确认结果，并提供"订阅推送目标"入口
```

Website 与 Contract 的添加确认必须明确告知"worker 暂未上线，不会推送事件"。

### 推送目标流程

```text
Owner 把 bot 拉入群/频道
  -> bot 把该 chat 入库为禁用 destination
  -> bot DM 给 owner：检测到新可用推送目标
  -> Owner 点击"启用"或"忽略"
```

### 订阅流程

```text
Owner 打开监控列表
  -> 选择某条监控
  -> 进入订阅设置
  -> 勾选已启用的 destinations
  -> 保存
```

### 命令清单

命令是按钮流程的快捷方式：

- `/start`、`/menu`、`/help`
- `/list`
- `/destinations`
- `/add <type> <target>`
- `/remove <id>`
- `/enable <id>`
- `/disable <id>`
- `/cancel`

所有命令都经过 owner guard 中间件。

## 文件结构

```text
src/
  bot/
    main.ts
    middleware/owner-guard.ts
    middleware/error-handler.ts
    handlers/start.ts
    handlers/list-sources.ts
    handlers/add-source.ts
    handlers/source-actions.ts
    handlers/destinations.ts
    handlers/chat-member.ts
    keyboards.ts
    messages.ts
    callback-data.ts
  services/
    source-service.ts
    destination-service.ts
    subscription-service.ts
    event-service.ts
  monitors/
    adapter.ts
    registry.ts
    twitter-adapter.ts
    website-adapter.ts
    contract-adapter.ts
  workers/
    twitter-worker.ts
  routing/
    dispatcher.ts
  store/
    prisma.ts
    redis.ts
  config.ts
  events.ts
  event-log.ts
  telegram.ts
  open-twitter.ts
  probe.ts
  index.ts

prisma/
  schema.prisma
  migrations/

tests/
  monitors/
  services/
  routing/
  bot/
  workers/
  integration/
```

老 probe 文件保留不动，但 `config.ts` 需要拆成两个解析函数：

- `parseProbeConfig(env)` 给老探针用。
- `parseBotConfig(env)` 给 bot 进程用。

## package.json scripts

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "bot": "tsx src/bot/main.ts",
    "test": "vitest run",
    "test:unit": "vitest run --exclude tests/integration/**",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "db:up": "docker compose up -d postgres redis",
    "db:down": "docker compose down"
  }
}
```

## 依赖

运行时新增：

- `grammy`
- `@grammyjs/conversations`
- `@prisma/client`
- `ioredis`
- 沿用现有 `dotenv`、`ws`

开发时新增：

- `prisma`
- `vitest-mock-extended`
- 沿用现有 TypeScript / Vitest / tsx

## Docker Compose

使用 PostgreSQL 16 与 Redis 7：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: x
      POSTGRES_PASSWORD: x
      POSTGRES_DB: x_monitor
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U x"]
      interval: 5s

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    command: redis-server --save 60 1 --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

volumes:
  pgdata:
  redisdata:
```

## 环境变量

```env
TELEGRAM_BOT_TOKEN=
OWNER_USER_IDS=
TWITTER_TOKEN=
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor
REDIS_URL=redis://localhost:6379

# 仅诊断 probe 使用
WATCH_ACCOUNTS=elonmusk,VitalikButerin
TELEGRAM_CHAT_ID=
LOG_DIR=logs
```

不实现"老 `WATCH_ACCOUNTS` 自动迁移到 PostgreSQL"。

## 错误处理

- 启动期 PostgreSQL 或 Redis 连不上 → 进程退出 1，依赖外部 supervisor 重启。
- 运行期 DB 错误由 handler 捕获，回复用户"操作失败，请重试"。
- 运行期 Redis 失败不会让 bot 崩溃；PostgreSQL 唯一约束作为去重兜底。
- 非 owner 更新静默丢弃，不回复任何内容。
- 非法 target 由 adapter 抛错，handler 给出该类型的使用示例。
- 重复添加返回已存在的 source id。
- Telegram 429 由 grammY 内置退避处理；最终失败写入 `delivery_logs`。
- 6551 WSS 断线使用带 jitter 的指数退避重连。
- 畸形 6551 JSON 写 warn 日志后跳过。
- 未知 callback data 回复"按钮已过期，请重新打开菜单"。

### WSS 重连 jitter

重连延迟使用带上限的指数退避加抖动：

```text
baseDelay = min(30000, 1000 * 2 ** attempt)
delay = baseDelay * (0.8 + Math.random() * 0.4)
```

新 Twitter worker 必须采用此算法。如实施过程中触碰到老 probe，则同步采用同一份 helper。

## 测试策略

### 单元测试

- Monitor adapter：target 校验与描述。
- Service：source / destination / subscription / event 行为，使用 mock 的 Prisma / Redis。
- Dispatcher：fanout、错误隔离、投递日志。
- Bot 中间件与 handler：owner guard、callback data、菜单/列表渲染、添加监控向导、推送目标自动发现。
- Worker：WSS 消息处理（依赖注入）。
- 现有 probe 单测保持绿。

### 集成测试

只测 mock 不可信的边界：

- Prisma 迁移与 CRUD roundtrip。
- Redis SETNX 去重行为。
- 真 PG + 真 Redis + mock Telegram API 的 dispatcher 端到端。

## 验收清单

- 全新机器上 `npm run db:up && npm run db:migrate` 一次成功。
- PostgreSQL 与 Redis 健康后 `npm run bot` 启动成功。
- Owner 在私聊发 `/start` 看到主菜单。
- 非 owner 给 bot 发任何消息：bot 静默不回。
- 把 bot 加入测试群：owner DM 收到推送目标卡片。
- Owner 可启用/停用 destination。
- Owner 可添加、列出、启用、停用、删除 Twitter source。
- Owner 添加 website / contract source：入库成功，列表显示"worker 暂未上线"。
- Owner 可订阅/取消订阅 destination。
- 6551 推送的 Twitter 事件：写入 `event_logs` 并推送到订阅的 destination。
- 投递成功/失败均写入 `delivery_logs`。
- 同一事件短时间内被 6551 推两次：仅推送一次（dedupe）。
- bot 重启后从 Redis offset 恢复 Telegram polling。
- `npm run test` 全绿。
- `npm run typecheck` 全绿。
- `npm run dev` 老探针仍然可用。

## Spec 自审

- Placeholder 扫描：无 TBD / TODO / 占位章节。
- 内部一致性：单 owner 模型、PostgreSQL 唯一真相、Redis 仅运行时角色、Docker Compose 部署 — 全文一致。
- Scope 检查：本 spec 聚焦 Telegram 控制面 + Twitter 事件分发；website / contract worker 明确不在范围。
- 歧义检查：source 共享方式、推送目标自动发现、probe 去留、存储分工、部署路径均已明确选定。
