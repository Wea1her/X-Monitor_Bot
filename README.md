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
2. 把 bot 拉进群/频道：bot 会在 DM 自动通知“新推送目标”
3. 启用该目标 → 监控源详情里点击“➕ 订阅推送目标”
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

仅当排查“6551 是否还能正常推 WSS”时使用。它只读 `.env` 中的 `WATCH_ACCOUNTS` / `TELEGRAM_CHAT_ID` / `LOG_DIR`，不读 PG。
