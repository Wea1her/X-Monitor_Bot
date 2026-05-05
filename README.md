# X Monitor Bot

OpenTwitter WSS 关注监控机器人。维护一个 `WATCH_ACCOUNTS` 监控列表，当列表里的账号主动关注了别人时，程序通过 6551 WSS 实时接收 `NEW_FOLLOWER` 事件，并推送到 Telegram、控制台和本地日志。

## 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
TWITTER_TOKEN=your_6551_token
WATCH_ACCOUNTS=elonmusk,VitalikButerin
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
LOG_DIR=logs
```

`TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID` 为空时不会推送 Telegram，只会打印控制台并写本地日志。

`WATCH_ACCOUNTS` 就是要监控“主动关注行为”的账号列表。例如：

```env
WATCH_ACCOUNTS=alice,bob
```

表示监控 `@alice` 和 `@bob`，当他们主动关注其他账号时触发通知。

## 运行

```bash
npm install
npm run dev
```

启动时程序会调用 6551 的 `twitter_watch_add`，只开启 `newFlwBol`，确保监控目标账号的新增关注行为。随后连接：

```text
wss://ai.6551.io/open/twitter_wss
```

并订阅 `twitter.subscribe`。

收到事件后，本项目只处理：

```text
method = twitter.event
eventType = NEW_FOLLOWER
params.twAccount = 监控列表中的账号
params.content = 被这个账号新关注的人
```

Telegram 消息会显示为“监控账号 followed 目标账号”。

事件日志写入：

```text
logs/twitter-events.ndjson
```

每行包含本地接收时间和 6551 推送的完整 JSON-RPC 消息。

WSS 订阅可能会返回当前 token 下整个 6551 watch list 的事件流。本项目会在本地按 `.env` 中的 `WATCH_ACCOUNTS` 过滤，并丢弃非 `NEW_FOLLOWER` 事件。

## 验证

```bash
npm test
npm run typecheck
```

## 当前边界

本项目依赖 6551 WSS 推送 `NEW_FOLLOWER`。断线期间是否补发由 6551 服务端决定；本地日志会保留已收到的原始事件，便于之后核对。
