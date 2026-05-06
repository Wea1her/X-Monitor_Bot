# 实时同步 Twitter 监控账号设计

## 目标

当 owner 在 Telegram bot 里新增、停用或删除 `twitter` 监控源时，系统应立即同步 6551 的 Twitter 监控列表，避免必须重启 bot 才能开始接收新账号事件，也避免本地已经停用或删除的账号继续占用 6551 API token。

## 当前行为

- `/add twitter <target>` 和添加监控向导只调用 `sourceService.create()`，把监控源写入本地 PostgreSQL。
- `startTwitterWorker()` 启动时会读取所有启用的 Twitter 监控源，并通过 `addWatchAccounts()` 调用 6551 `POST /open/twitter_watch_add`。
- WebSocket 只在 worker 启动时发送 `twitter.subscribe`，该订阅面向 token 的实时事件流，不携带单个账号参数。
- 因此，bot 运行期间新加入的 Twitter 账号不会立即同步到 6551，除非重启 bot。
- 当前停用或删除本地 Twitter 监控源时，不会调用 6551 删除接口，远端可能继续监控并消耗 token。

## 设计决策

采用“本地监控源生命周期同步 6551 watch 列表”的方案。

- 新建 Twitter 监控源后，立刻调用 `POST https://ai.6551.io/open/twitter_watch_add`。
- 停用或删除 Twitter 监控源前，立刻调用 `POST https://ai.6551.io/open/twitter_watch_delete`。
- 当前 WebSocket 连接不重启，也不重新发送带账号参数的订阅消息。
- 6551 返回“该 Twitter 账号已在监控列表中”时，视作同步成功，不向用户报错。
- 6551 删除接口返回“不存在/未在监控列表中”时，视作删除成功，因为目标状态已经满足。
- 已存在的本地监控源不重复调用 6551。
- `website` 和 `contract` 类型不调用 6551。
- 6551 同步失败时不回滚本地数据库；bot 回复中提示“本地已添加，但 6551 同步失败”，方便 owner 后续重试或重启 bot。
- 停用或删除时，如果 6551 删除失败，不修改本地状态，并回复同步失败原因，避免界面显示已停用/已删除但远端仍在消耗 token。

## 组件变更

### `src/open-twitter.ts`

保留现有 `addWatchAccounts()` 批量同步能力，并增加单账号注册和删除结果语义：

- 成功：HTTP 2xx。
- 已存在：HTTP 400 且响应正文包含 6551 的“已在监控列表中”语义。
- 已删除/不存在：HTTP 2xx 或响应正文包含 6551 的“不存在/未在监控列表中”语义。
- 失败：其他非 2xx 响应或网络异常。

批量启动同步仍应逐账号继续，不因单个账号失败中断 worker 启动。

### `src/bot/handlers/add-source.ts`

`performAddSource()` 增加一个可选的 watch registrar 依赖。流程如下：

1. 调用 `sourceService.create()`。
2. 如果返回 `alreadyExisted=true`，直接回复“已存在”，不调用 6551。
3. 如果新建的是 `twitter`，调用 watch registrar 注册 `source.normalizedTarget`。
4. 如果注册成功或 6551 已存在，回复“已添加，并已同步到 6551 监控”。
5. 如果注册失败，回复“已添加，但 6551 同步失败：<原因>”。
6. 非 Twitter 类型保留现有 worker 未上线提示。

### `src/bot/handlers/source-actions.ts`

`toggle()` 和 `delete()` 增加 watch synchronizer 依赖。流程如下：

- 启用 Twitter 监控源：先调用 6551 `twitter_watch_add`，成功后再把本地 `enabled` 改为 `true`。
- 停用 Twitter 监控源：先调用 6551 `twitter_watch_delete`，成功后再把本地 `enabled` 改为 `false`。
- 删除 Twitter 监控源：先调用 6551 `twitter_watch_delete`，成功后再删除本地 source。
- 6551 同步失败时，不修改本地状态，向 owner 回复失败原因。
- 非 Twitter 类型保持现有本地启停/删除行为。

### `src/bot/main.ts`

装配 watch synchronizer：

- 使用 `config.twitterToken`。
- 调用 `addWatchAccounts()`、新增的单账号 add helper、以及新增的单账号 delete helper。
- 注入到 `performAddSource()`、添加监控向导、source 启停和 source 删除处理器。

## 数据流

```text
Telegram /add twitter @foo
  -> performAddSource()
  -> sourceService.create({ type: 'twitter', input: '@foo' })
  -> PostgreSQL monitor_sources insert
  -> watch registrar
  -> 6551 POST /open/twitter_watch_add { username: 'foo', newFlwBol: true, newUnFlwBol: true, ... }
  -> Telegram 回复同步结果
```

停用或删除：

```text
Telegram 停用/删除 #62
  -> sourceActions.toggle() 或 sourceActions.delete()
  -> 读取本地 source
  -> 6551 POST /open/twitter_watch_delete { username: source.normalizedTarget }
  -> 远端删除成功后再更新或删除 PostgreSQL monitor_sources
  -> Telegram 回复同步结果
```

实时事件仍走现有链路：

```text
6551 WSS twitter.event
  -> handleWorkerPayload()
  -> findSourceIdByAccount()
  -> eventService / mutualFollowService / dispatcher
```

## 错误处理

- 本地数据库创建失败：保持现有失败回复。
- 6551 网络错误或非预期响应：不删除本地 source，回复同步失败原因。
- 6551 已存在：视作成功，因为目标状态已经满足。
- 6551 删除时已不存在：视作成功，因为目标状态已经满足。
- 停用/删除同步失败：不改变本地 `enabled` 或 source 记录，确保 owner 能重试。
- 远端同步成功但后续本地数据库更新失败：回复本地操作失败；owner 可重试，本地状态仍可被查询。
- 运行时日志应记录 watch-add 成功、已存在、失败，便于排查。
- 运行时日志应记录 watch-delete 成功、已不存在、失败，便于排查。

## 测试计划

- `tests/open-twitter.test.ts`
  - 单账号注册调用正确 endpoint、header、payload。
  - 6551 已存在响应被识别为成功或 `alreadyExists`。
  - 单账号删除调用 `POST /open/twitter_watch_delete`。
  - 6551 已不存在响应被识别为删除成功。
  - 非 2xx 非已存在响应返回失败信息。

- `tests/bot/add-source.test.ts`
  - 新增 `twitter` 时调用 watch registrar。
  - 已存在 `twitter` 不重复调用。
  - `website` / `contract` 不调用。
  - watch registrar 失败时返回“本地已添加，但 6551 同步失败”。

- `tests/bot/source-actions.test.ts`
  - 启用 `twitter` 前调用 watch-add，成功后更新本地 enabled。
  - 停用 `twitter` 前调用 watch-delete，成功后更新本地 enabled。
  - 删除 `twitter` 前调用 watch-delete，成功后删除本地 source。
  - watch-delete 失败时不调用本地停用或删除。
  - 非 Twitter 类型不调用 6551。

- `src/bot/main.ts` 的装配通过 typecheck 覆盖。

## 非目标

- 不改变 WebSocket 连接方式。
- 不补做周期性 reconcile。
- 不保存 6551 同步状态到数据库。
