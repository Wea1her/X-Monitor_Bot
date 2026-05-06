# 共同关注推送设计

## 背景

当前 Telegram bot 已经能接收 6551 `NEW_FOLLOWER` / `NEW_UNFOLLOWER` 事件，并把关注事件推送到配置好的 Telegram 群组。现有推送只描述单次事件：哪个监控账号关注或取关了哪个目标账号。

新的目标是把“多个已监控账号共同关注同一个目标账号”识别为更强信号。系统不依赖 6551 提供完整 followers 列表，而是用自己实际收到的关注事件维护本地状态。

## 目标

- 记录每个已监控 Twitter 账号关注过哪些目标账号。
- 第一次看到某个目标账号被一个监控账号关注时，只入库，不推送。
- 当第二个监控账号也关注同一个目标账号时，开始推送。
- 当第三个、第四个及更多监控账号关注同一个目标账号时，继续推送，并根据共同关注数量增强提示。
- 推送里展示共同关注数量和参与共同关注的监控账号列表。
- 同一个监控账号重复触发同一个目标账号的关注事件时，不重复计数，也不重复推送。

## 非目标

- 不调用外部接口查询目标账号的完整 followers。
- 不使用 6551 `twitter_kol_followers` 作为共同关注来源。
- 不维护真实 X 账号的完整 following 列表。
- 不在本阶段为 `NEW_UNFOLLOWER` 反向扣减共同关注计数。取关事件仍按现有逻辑推送或记录，后续可单独设计衰减/删除策略。
- 不引入 Telegram Markdown/HTML 格式化，避免转义风险。

## 定义

本功能中的“你关注的用户”指 bot 当前已启用的 Twitter 监控源列表。共同关注只基于本地收到的监控事件计算。

```text
共同关注 = 本地共同关注表中 targetAccount 相同、且 source 仍为 enabled 的 distinct followerAccount 集合
```

如果某个监控源后来被停用或删除，历史共同关注记录保留，但不参与后续共同关注计数和账号列表展示。

例如已启用监控源包含 `@a`、`@b`、`@c`。系统依次收到：

```text
@a 关注 @target
@b 关注 @target
@c 关注 @target
```

第一次只记录 `(@target, @a)`。第二次记录 `(@target, @b)` 后推送共同关注 2 个。第三次记录 `(@target, @c)` 后再次推送共同关注 3 个，并显示升温提示。

## 数据模型

新增 `MutualFollow` 表：

```prisma
model MutualFollow {
  id               Int      @id @default(autoincrement())
  targetAccount    String   @map("target_account")
  targetName       String?  @map("target_name")
  targetProfileUrl String?  @map("target_profile_url")
  targetBio        String?  @map("target_bio")
  followerAccount  String   @map("follower_account")
  followerName     String?  @map("follower_name")
  sourceId         Int?     @map("source_id")
  firstSeenAt      DateTime @default(now()) @map("first_seen_at")
  lastSeenAt       DateTime @updatedAt @map("last_seen_at")

  source           MonitorSource? @relation(fields: [sourceId], references: [id], onDelete: SetNull)

  @@unique([targetAccount, followerAccount])
  @@index([targetAccount, lastSeenAt])
  @@index([sourceId])
  @@map("mutual_follows")
}
```

`targetAccount` 与 `followerAccount` 使用小写、去掉前导 `@` 的标准化 handle。`targetName`、`targetProfileUrl`、`targetBio` 取最新一次事件中可获得的目标账号信息。`sourceId` 指向触发该关注事件的 `MonitorSource`，便于排查和未来扩展。

## 服务边界

新增 `src/services/mutual-follow-service.ts`，负责：

- 从 `NEW_FOLLOWER` 事件中提取目标账号信息。
- upsert `(targetAccount, followerAccount)`。
- 判断这次事件是否是新关系。
- 查询该目标账号当前共同关注集合，只统计仍然启用的 Twitter 监控源。
- 计算是否应该推送和提示等级。

对外接口建议：

```ts
interface RecordMutualFollowInput {
  sourceId: number;
  followerAccount: string;
  followerName?: string;
  targetAccount: string;
  targetName?: string;
  targetProfileUrl?: string;
  targetBio?: string;
}

interface MutualFollowResult {
  inserted: boolean;
  total: number;
  accounts: Array<{ account: string; name?: string }>;
  emphasis: 'none' | 'warming' | 'hot';
  shouldNotify: boolean;
}
```

规则：

```text
inserted=false       -> shouldNotify=false
inserted=true,total=1 -> shouldNotify=false
inserted=true,total>=2 -> shouldNotify=true

total=2      -> emphasis=none
total=3 或 4 -> emphasis=warming
total>=5     -> emphasis=hot
```

## Worker 流程

`twitter-worker` 当前流程是：

```text
WSS payload -> find source -> record event -> fanOut(formatTelegramMessage(message))
```

新流程只改变 `NEW_FOLLOWER` 分支：

```text
WSS payload
  -> find source
  -> record event
  -> if deduped: stop
  -> if eventType != NEW_FOLLOWER: fanOut(existing formatter)
  -> record mutual follow
  -> if shouldNotify=false: stop
  -> fanOut(formatTelegramMessage(message, mutualFollowResult))
```

这样第一次共同关注只会沉淀数据库，不会写 delivery log，也不会推 Telegram。原始事件仍会写入 `event_logs`，便于审计。

## 文案

当共同关注数量达到 2：

```text
[OpenTwitter] 新增关注
监控账号：@b
关注了：@target
简介：目标简介
共同关注：2 个（@a、@b）
目标主页：https://twitter.com/target
```

当数量为 3 或 4：

```text
[OpenTwitter] 新增关注
监控账号：@c
关注了：@target
简介：目标简介
共同关注：3 个（@a、@b、@c）
提示：共同关注升温
目标主页：https://twitter.com/target
```

当数量大于等于 5：

```text
[OpenTwitter] 新增关注
监控账号：@e
关注了：@target
简介：目标简介
共同关注：5 个（@a、@b、@c、@d、@e）
提示：高共同关注
目标主页：https://twitter.com/target
```

如果共同关注账号超过 10 个，只展示前 10 个，并在列表末尾追加 `等`：

```text
共同关注：18 个（@a、@b、@c、@d、@e、@f、@g、@h、@i、@j 等）
```

账号列表排序按首次看到该目标账号的时间升序。这样第一个发现目标的监控账号会排在前面，输出稳定且可解释。

## 错误处理

- 共同关注入库失败：记录 warn，不发送共同关注推送，避免错误信息刷群。
- 共同关注查询失败：记录 warn，不发送共同关注推送。
- Telegram 推送失败：沿用现有 dispatcher 的 delivery log 记录失败。
- 事件缺少目标账号 handle：跳过共同关注逻辑，记录 warn。
- 同一 `(targetAccount, followerAccount)` 重复事件：更新 `lastSeenAt` 和目标信息，但 `inserted=false`，不推送。

## 测试计划

新增单测：

- 第一次 `@a -> @target`：入库，`shouldNotify=false`。
- 第二次 `@b -> @target`：入库，`shouldNotify=true`，`total=2`，`emphasis=none`。
- 第三次 `@c -> @target`：`total=3`，`emphasis=warming`。
- 第五次：`emphasis=hot`。
- 重复 `@a -> @target`：不重复计数，不推送。
- 账号列表超过 10 个时只展示前 10 个和 `等`。

新增 worker 测试：

- `NEW_FOLLOWER` 第一次共同关注不调用 `fanOut`。
- `NEW_FOLLOWER` 第二次共同关注调用 `fanOut`，消息包含 `共同关注：2 个`。
- 非 `NEW_FOLLOWER` 事件仍沿用现有推送路径。
- event dedupe 命中时不会写共同关注表。

新增集成测试：

- 使用真实 PostgreSQL 验证共同关注记录唯一约束、计数、重复事件不重复推送。

## 迁移与兼容

该功能新增表，不改现有 `event_logs`、`delivery_logs`、`monitor_sources` 的含义。部署后不会回填历史事件；共同关注状态从功能上线后的新事件开始积累。

老 probe 不接入共同关注逻辑，仍保持诊断用途。
