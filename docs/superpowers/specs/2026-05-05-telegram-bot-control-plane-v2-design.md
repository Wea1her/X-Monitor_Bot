# Telegram Monitor Bot Control Plane v2 Design

## Background

The project currently has a single-user OpenTwitter WSS probe. The probe reads `WATCH_ACCOUNTS` from `.env`, calls 6551 watch-add, subscribes to 6551 WSS events, writes raw NDJSON logs, and optionally sends fixed Telegram messages.

The next stage is a Telegram Bot control plane. The bot should let the owner manage monitoring sources and push destinations from Telegram DM using buttons. It should persist configuration and event history in PostgreSQL, use Redis only for runtime cache/locks, and keep the old probe as a diagnostic tool.

## Goals

- Provide a private single-owner Telegram bot.
- Use Telegram DM as the primary control plane.
- Use inline buttons for adding, listing, enabling, disabling, deleting, and subscribing monitors.
- Auto-discover groups/channels when the bot is added to them.
- Push Twitter events to selected Telegram groups/channels.
- Store source, destination, subscription, event, and delivery state in PostgreSQL.
- Use Redis for runtime offset, dedupe, and short-lived locks only.
- Keep the current `npm run dev` probe as a 6551 diagnostic tool.
- First phase implements the button flows for Twitter, website, and contract, but only Twitter has a real worker.

## Non-goals

- No multi-user support.
- No commercial/SaaS features, billing, or plan management.
- No web admin panel in this phase.
- No Telegram webhook mode; use long polling.
- No website worker in this phase.
- No contract worker in this phase.
- No proactive Telegram send rate limiting beyond handling Telegram 429 responses.
- No automatic migration from legacy `.env` `WATCH_ACCOUNTS`.

## User model

The system is for one owner only. `OWNER_USER_IDS` contains the Telegram user id(s) allowed to interact with the bot. All non-owner updates are silently ignored.

The owner configures everything in DM with the bot. Groups and channels are push targets only. When the bot is added to a group or channel, it receives a `my_chat_member` update, stores the chat as a disabled destination, and sends the owner a DM card to enable or ignore the destination.

## Deployment decision

Use option A for now: PostgreSQL and Redis are self-hosted with Docker Compose both locally and on the VPS.

The application must still use `DATABASE_URL` and `REDIS_URL` as the only connection boundary. If the database later moves to Supabase/Neon or Redis moves to a managed provider, no code should change.

## Process topology

Two commands remain separate:

```text
npm run dev  -> current OpenTwitter WSS probe, diagnostic only
npm run bot  -> Telegram control-plane bot, production path
```

The probe remains useful for checking whether the 6551 REST/WSS channel is healthy without involving PostgreSQL, Redis, or the bot control plane. README should mark it as a diagnostic tool.

The bot process runs:

- grammY long polling for Telegram updates.
- A Twitter worker connected to 6551 WSS.
- A dispatcher that fans out events to Telegram destinations.
- Prisma and ioredis clients.

## Architecture

```text
Bot layer (src/bot/)
  - grammY commands, callback queries, conversations, my_chat_member updates
  - owner guard middleware
  - inline keyboards and user-visible messages

Service layer (src/services/)
  - source CRUD
  - destination CRUD
  - subscription CRUD
  - event and delivery logging

Monitor registry (src/monitors/)
  - common MonitorAdapter interface
  - twitter, website, contract target validation and descriptions

Workers (src/workers/)
  - first phase only has twitter-worker
  - connects to 6551 WSS and emits normalized events

Routing (src/routing/)
  - dispatcher maps events to enabled subscriptions and destinations
  - sends Telegram messages and records delivery results

Store (src/store/)
  - Prisma client singleton
  - ioredis client singleton and helper functions
```

## Data flow

### Configuration flow

```text
Owner DM -> bot button/command -> service -> monitor adapter validation -> PostgreSQL
```

Example:

```text
Owner adds twitter:elonmusk
  -> source-service validates target through twitter-adapter
  -> monitor_sources upsert with type=twitter, normalizedTarget=elonmusk
```

### Destination discovery flow

```text
Bot added to group/channel
  -> Telegram my_chat_member update
  -> destination-service upserts destination as enabled=false
  -> bot DMs owner with enable/ignore buttons
  -> owner enables destination
```

### Event flow

```text
PostgreSQL enabled twitter sources
  -> twitter-worker calls 6551 watch-add
  -> twitter-worker connects to 6551 WSS
  -> 6551 pushes raw event
  -> worker finds matching monitor source
  -> Redis SETNX dedupe key with 24h TTL
  -> event-service writes event_logs
  -> dispatcher loads enabled subscriptions and destinations
  -> Telegram sendMessage via grammY API
  -> event-service writes delivery_logs status=ok|error
```

PostgreSQL decides what to monitor and where to push. 6551 WSS is only the external real-time event stream. The database never connects to 6551 directly; the bot process connects to both sides.

## Monitor types

### Twitter

First phase includes real Twitter monitoring:

- Validate username by trimming whitespace and removing leading `@`.
- Reject empty usernames and malformed handles.
- Store normalized target without `@`.
- Use existing 6551 watch-add REST client.
- Receive events from 6551 WSS.
- Push received events to subscribed destinations.

Known external constraint: 6551 follow/unfollow events require the monitored account to have more than 5000 followers. This should be documented in help text or troubleshooting docs.

### Website

First phase only implements control-plane behavior:

- Validate `http://` or `https://` URL.
- Store normalized URL.
- Show in list with a clear `worker not available yet` marker.
- Do not start a website worker or send website events.

### Contract

First phase only implements control-plane behavior:

- Validate chain name and address format.
- Supported initial chains: `eth`, `bsc`, `sol`.
- Store normalized chain/address config.
- Show in list with a clear `worker not available yet` marker.
- Do not start a contract worker or send contract events.

## Prisma data model

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

`Destination.enabled` defaults to `true` in the schema for normal creation, but destinations auto-discovered from `my_chat_member` must be explicitly inserted with `enabled=false` until the owner enables them.

## Redis keys

| Key | Purpose | TTL |
| --- | --- | --- |
| `tg:offset` | Telegram polling offset recovery | no TTL |
| `dedupe:event:<key>` | event dedupe lock via SETNX | 24h |
| `lock:source:<source_id>` | optional short-lived source processing lock | short TTL |

Redis must not be the source of truth for business data.

## Dedupe key strategy

For Twitter events:

```text
tw:<twAccount>:<eventType>:<content.id if present else sha1(raw event payload)>
```

The worker first attempts Redis `SET key value NX EX 86400`. If Redis is unavailable, PostgreSQL `event_logs.dedupeKey` uniqueness is the fallback. Duplicate events are not dispatched.

## Bot UX

### Main menu

```text
X Monitor Bot

[Monitoring list] [Add monitor]
[Remove monitor] [Destinations]
[Help]
```

### Add monitor wizard

```text
Owner taps Add monitor
  -> bot asks monitor type: Twitter / Website / Contract
  -> owner selects type
  -> bot asks for target input
  -> adapter validates target
  -> source-service upserts source
  -> bot confirms result and offers destination configuration
```

Website and contract confirmations must clearly say the worker is not available yet and no events will be pushed for that type.

### Destination flow

```text
Owner adds bot to group/channel
  -> bot stores destination as disabled
  -> bot DMs owner: new destination detected
  -> owner taps Enable or Ignore
```

### Subscription flow

```text
Owner opens monitoring list
  -> selects a monitor
  -> opens subscription settings
  -> selects enabled destinations
  -> saves
```

### Commands

Commands are shortcuts for the same button flows:

- `/start`, `/menu`, `/help`
- `/list`
- `/destinations`
- `/add <type> <target>`
- `/remove <id>`
- `/enable <id>`
- `/disable <id>`
- `/cancel`

All commands go through the owner guard.

## File structure

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

Existing probe files remain, but `config.ts` should be refactored into separate parse functions:

- `parseProbeConfig(env)` for the diagnostic probe.
- `parseBotConfig(env)` for the bot process.

## Package scripts

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

## Dependencies

Runtime:

- `grammy`
- `@grammyjs/conversations`
- `@prisma/client`
- `ioredis`
- existing `dotenv` and `ws`

Development:

- `prisma`
- `vitest-mock-extended`
- existing TypeScript/Vitest/tsx dependencies

## Docker Compose

Use PostgreSQL 16 and Redis 7:

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

## Environment variables

```env
TELEGRAM_BOT_TOKEN=
OWNER_USER_IDS=
TWITTER_TOKEN=
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor
REDIS_URL=redis://localhost:6379

# Diagnostic probe only
WATCH_ACCOUNTS=elonmusk,VitalikButerin
TELEGRAM_CHAT_ID=
LOG_DIR=logs
```

No automatic migration should read legacy `WATCH_ACCOUNTS` into PostgreSQL.

## Error handling

- Startup fails fast if PostgreSQL or Redis cannot connect.
- Runtime database errors are caught by handlers and shown as a retryable user-facing failure.
- Redis runtime failures do not crash the bot; PostgreSQL uniqueness remains the dedupe fallback.
- Non-owner updates are silently ignored.
- Invalid targets return adapter-specific usage guidance.
- Duplicate source adds return the existing source id.
- Telegram 429 responses rely on grammY retry behavior; final failures are written to `delivery_logs`.
- 6551 WSS disconnects reconnect with capped exponential backoff plus jitter.
- Malformed 6551 JSON is logged and skipped.
- Unknown callback data returns a stale-button message to the owner.

### WSS jitter

Reconnect delay should use capped exponential backoff with jitter:

```text
baseDelay = min(30000, 1000 * 2 ** attempt)
delay = baseDelay * (0.8 + Math.random() * 0.4)
```

Apply this to the new Twitter worker. If the old probe is touched during implementation, apply the same helper there too.

## Testing strategy

### Unit tests

- Monitor adapters: target validation and description.
- Services: source, destination, subscription, event behavior with mocked Prisma/Redis.
- Dispatcher: fanout, failure isolation, delivery logging.
- Bot middleware and handlers: owner guard, callback data, menu/list rendering, add-source conversation, destination discovery.
- Worker: WSS message handling with injected dependencies.
- Existing probe tests remain green.

### Integration tests

Use Docker-backed PostgreSQL and Redis for the boundaries mocks cannot prove:

- Prisma migration and roundtrip CRUD.
- Redis SETNX dedupe behavior.
- Dispatcher using real PostgreSQL/Redis and mocked Telegram API.

## Verification checklist

- `npm run db:up && npm run db:migrate` succeeds on a clean machine.
- `npm run bot` starts after PostgreSQL and Redis are healthy.
- Owner DM `/start` shows the main menu.
- Non-owner messages are silently ignored.
- Adding the bot to a test group DMs the owner with a destination card.
- Owner can enable/disable destinations.
- Owner can add, list, enable, disable, remove Twitter sources.
- Owner can add website and contract sources, and they display as worker-not-available.
- Owner can subscribe/unsubscribe destinations for a source.
- Twitter events from 6551 are written to `event_logs` and pushed to subscribed destinations.
- Delivery success/failure is written to `delivery_logs`.
- Duplicate 6551 events are not pushed twice.
- Bot restart resumes Telegram polling from Redis offset.
- `npm run test` passes.
- `npm run typecheck` passes.
- `npm run dev` probe remains usable as a diagnostic tool.

## Spec self-review

- Placeholder scan: no TBD/TODO placeholders remain.
- Internal consistency: single-owner model, PostgreSQL source of truth, Redis runtime-only role, and Docker Compose deployment are consistent throughout.
- Scope check: this is one implementation plan focused on Telegram control plane plus Twitter event dispatch; website/contract workers are explicitly out of scope.
- Ambiguity check: source sharing, destination discovery, probe retention, storage roles, and deployment path are explicitly chosen.
