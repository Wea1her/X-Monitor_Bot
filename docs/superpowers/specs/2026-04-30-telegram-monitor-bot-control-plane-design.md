# Telegram 监控 Bot 控制面设计

## 背景

当前项目是一个单用户 OpenTwitter WSS 探针。它从 `.env` 读取固定的 `WATCH_ACCOUNTS` 和一个 Telegram 推送目标，连接 6551 WSS，接收事件，格式化后推送到 Telegram。

下一阶段不直接实现所有监控类型，而是先开发 Telegram Bot 控制面。用户可以通过 Telegram 管理监控项和推送目标。Twitter、网站、合约以及后续监控模块，之后都通过统一的 adapter 接口接入。

## 目标

- 提供一个多人共用的 Telegram bot。
- 允许 Telegram 群管理员管理监控配置。
- 使用数据库保存监控源和推送目标，不再依赖 `.env` 里的固定列表。
- 支持把消息推送到群或频道。
- 把监控类型抽象成通用模型，后续接入 Twitter、网站、合约等模块时，不需要重写 Bot 命令层。
- 即使真实监控 worker 还没接入，第一版也能完成添加、删除、查看、启用、停用监控配置和推送目标配置。

## 非目标

- 不做支付、套餐、SaaS 计费。
- 不做 Web 后台。
- 本阶段不实现真实 Twitter、网站、合约监控 worker。
- 不支持多个 bot token。
- 不做完整多租户隔离，只基于 Telegram chat 和管理员权限做访问控制。
- 不做复杂自然语言配置流程，命令和简单按钮足够。

## 用户模型

系统使用一个 Telegram bot token。用户可以在 Telegram 群、超级群中操作 bot；频道主要作为推送目标使用。

第一版采用基于群的管理模型：

- `/add`、`/remove`、`/enable`、`/disable` 和推送目标配置命令，需要发送者是当前 Telegram 群管理员。
- `/list`、`/destinations`、`/help`、`/menu`、`/start` 可以由普通群成员使用。
- Bot 将监控消息发送到配置好的推送目标。推送目标可以是当前群，也可以是单独的频道。

频道不适合作为主要命令入口。频道目标的配置应从管理群中完成，频道只作为消息投递目标。

## 命令设计

第一版命令：

- `/start`：显示简短介绍和主菜单。
- `/help`：显示命令语法和示例。
- `/menu`：显示按钮菜单。
- `/list`：按类型列出已配置的监控源。
- `/add <type> <target>`：添加监控源。
- `/remove <id|type target>`：删除或停用监控源。
- `/enable <id>`：启用已停用的监控源。
- `/disable <id>`：停用监控源但不删除记录。
- `/set_destination <chat_id|@username>`：为当前管理群添加或更新推送目标。
- `/destinations`：列出推送目标。

第一版支持的监控类型只是配置占位：

- `twitter`
- `website`
- `contract`

示例：

```text
/add twitter elonmusk
/add website https://example.com
/add contract eth 0x1234567890abcdef1234567890abcdef12345678
/set_destination @my_alert_channel
```

Bot 必须拒绝未知监控类型和格式错误的目标，并返回明确的使用提示。

## 菜单行为

按钮菜单只是命令的便捷入口，不做复杂表单。

```text
[监控列表] [添加监控]
[删除监控] [推送目标]
[帮助]
```

由于 Telegram inline keyboard 不适合直接收集任意文本，真正输入监控目标时仍然使用命令。例如点击“添加监控”后，Bot 回复添加示例，而不是进入复杂向导。

## 架构

控制面分成四层。

### Bot 层

`src/bot/` 负责处理 Telegram 更新：

- 命令解析
- 按钮回调
- 管理员权限校验
- 用户可见回复

Bot 层不直接关心某种监控类型的细节，只调用基于 registry 的验证服务。

### Service 层

`src/services/` 提供应用操作：

- 创建监控源
- 删除监控源
- 查看监控源
- 启用或停用监控源
- 注册推送目标
- 查看推送目标
- 权限校验协调

Service 负责协调数据库和 monitor registry。Telegram 命令处理器调用 service，不直接操作持久化。

### Monitor Registry 层

`src/monitors/` 定义统一 adapter 形态：

```ts
export interface MonitorAdapter {
  type: string;
  validateTarget(target: string): Promise<NormalizedMonitorTarget>;
  describe(source: MonitorSource): string;
}
```

第一阶段 adapter 只做校验和标准化：

- `twitter`：把 `@username` 标准化为 `username`。
- `website`：校验 `http://` 或 `https://` URL。
- `contract`：校验链名和地址格式。

后续阶段会给 adapter 增加 worker 生命周期能力，但不改变 Bot 命令面。

### Routing 层

`src/routing/` 负责推送目标和订阅关系。第一阶段只保存关系，不分发真实监控事件。

后续监控 worker 接入后，事件流是：

```text
Monitor adapter -> MonitorEvent -> dispatcher -> Telegram 目标群/频道
```

Dispatcher 根据订阅关系找到推送目标，再调用 Telegram client。

## 数据模型

第一版使用 SQLite。这样不需要额外部署 PostgreSQL，但仍然能保证状态持久化和可查询。数据库路径通过 `DB_PATH` 配置，默认 `data/x-monitor.sqlite`。

表结构：

```text
telegram_chats
  id integer primary key
  telegram_chat_id text unique not null
  type text not null
  title text
  username text
  created_at text not null
  updated_at text not null

monitor_sources
  id integer primary key
  type text not null
  target text not null
  normalized_target text not null
  config_json text not null
  enabled integer not null
  created_by_user_id text
  created_by_username text
  created_at text not null
  updated_at text not null
  unique(type, normalized_target)

destinations
  id integer primary key
  telegram_chat_id text unique not null
  type text not null
  title text
  username text
  enabled integer not null
  created_at text not null
  updated_at text not null

subscriptions
  id integer primary key
  source_id integer not null
  destination_id integer not null
  enabled integer not null
  created_at text not null
  unique(source_id, destination_id)

event_logs
  id integer primary key
  source_id integer
  event_type text not null
  dedupe_key text
  raw_json text not null
  occurred_at text
  received_at text not null

delivery_logs
  id integer primary key
  event_log_id integer
  destination_id integer not null
  status text not null
  error text
  sent_at text
```

第一阶段可以只建表，不使用 `event_logs` 和 `delivery_logs`。提前保留它们是为了让后续 worker 接入时持久化模型稳定。

## 配置

环境变量：

```env
TELEGRAM_BOT_TOKEN=
DB_PATH=data/x-monitor.sqlite
LOG_DIR=logs
OWNER_USER_IDS=
```

`OWNER_USER_IDS` 可选。配置后，这些用户即使在 Telegram 管理员检查不可用时，也可以执行管理操作。默认规则仍然是 Telegram 群管理员可管理。

`TWITTER_TOKEN` 在本阶段可选，因为还不实现 Twitter worker。

## Telegram 集成

第一版使用 long polling。生产环境后续可以改为 webhook。

需要使用的 Telegram API：

- `getUpdates` 或对应库的 long polling 能力。
- `sendMessage` 用于回复和推送。
- `getChatMember` 用于管理员权限校验。
- `setMyCommands` 用于注册命令菜单，如果所选实现支持。

当前 `src/telegram.ts` 的发送消息函数可以复用或封装，但命令处理需要 Telegram bot client 库，或者实现一个小型 Bot API polling client。

## 错误处理

- 命令格式错误时回复使用示例。
- 未知监控类型直接拒绝。
- 重复添加监控源时返回已有记录 id。
- Telegram 权限不足时返回清晰拒绝消息。
- Telegram API 调用失败要记录日志，不能导致 bot 主循环崩溃。
- 数据库初始化失败应在启动时快速失败。

## 测试

需要覆盖的聚焦单元测试：

- 命令解析。
- 管理员权限判断。
- `twitter`、`website`、`contract` 目标校验。
- SQLite store 对监控源、推送目标和订阅关系的读写。
- 添加、删除、启用、停用、列表查询等 service 行为。
- Telegram 命令回复文案渲染。

集成测试可以使用 mock Telegram API 和临时 SQLite 数据库。

## 从当前代码迁移

可复用部分：

- Telegram `sendMessage` helper。
- OpenTwitter client 组织方式。
- 事件格式化思路。
- 当前 TypeScript 测试和构建配置。

需要分离的部分：

- `.env` 里的 `WATCH_ACCOUNTS` 不再作为新 Bot 的主要数据源。
- 当前 WSS probe 可以保留，但不作为第一阶段 Bot 控制面的核心流程。
- 之前关于 follow 事件方向的假设不能进入控制面设计。

## 第一阶段完成标准

第一阶段完成时应满足：

- `npm run bot` 可以以 long polling 方式启动 Telegram bot。
- Bot 启动时初始化 SQLite schema。
- `/start`、`/help`、`/menu`、`/list`、`/add`、`/remove`、`/enable`、`/disable`、`/set_destination`、`/destinations` 可用。
- 管理类命令会拦截非管理员用户。
- 监控源和推送目标重启后仍然存在。
- 测试和类型检查通过。

真实监控 worker 和事件分发明确推迟到后续 spec。
