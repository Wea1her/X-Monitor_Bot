# Realtime Twitter Watch Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram bot 新增、启用、停用、删除 Twitter 监控源时，立即同步 6551 watch 列表并记录最小同步状态。

**Architecture:** 在 `MonitorSource` 保存远端 watch 同步状态；`open-twitter.ts` 提供单账号 add/delete helper；bot 添加和 source 操作 handler 通过注入的 synchronizer 调用 6551。WSS 连接保持现状，不重启、不按账号订阅。

**Tech Stack:** TypeScript / Prisma / PostgreSQL / Vitest / vitest-mock-extended / grammY / 6551 REST API.

---

## File Structure

- Modify: `prisma/schema.prisma` — 给 `MonitorSource` 增加 `remoteWatchStatus` / `remoteWatchError` / `remoteWatchSyncedAt`。
- Create: `prisma/migrations/*_add_remote_watch_status/migration.sql` — Prisma-generated migration。
- Modify: `src/open-twitter.ts` — 增加单账号 `addWatchAccount()` / `deleteWatchAccount()`，保留批量 `addWatchAccounts()`。
- Modify: `src/services/source-service.ts` — 创建 source 时初始化远端 watch 状态，并提供同步状态更新方法。
- Modify: `src/bot/handlers/add-source.ts` — 新增 Twitter source 后立即调用 6551 watch-add。
- Modify: `src/bot/handlers/source-actions.ts` — 启用/停用/删除 Twitter source 前同步 6551 add/delete。
- Modify: `src/bot/main.ts` — 装配 `watchSynchronizer`，注入 add-source 和 source-actions。
- Modify: `src/bot/messages.ts` — source 列表展示远端同步异常。
- Modify: `tests/open-twitter.test.ts` — 6551 add/delete helper 单测。
- Modify: `tests/services/source-service.test.ts` — 同步状态字段和更新方法单测。
- Modify: `tests/bot/add-source.test.ts` — 新增 source 时 watch-add 行为单测。
- Modify: `tests/bot/source-actions.test.ts` — 启停/删除时 watch 同步行为单测。

---

### Task 1: Prisma Remote Watch Status

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*_add_remote_watch_status/migration.sql`

- [ ] **Step 1: Add schema fields**

Add these fields to `MonitorSource` after `enabled`:

```prisma
  remoteWatchStatus   String    @default("pending") @map("remote_watch_status")
  remoteWatchError    String?   @map("remote_watch_error")
  remoteWatchSyncedAt DateTime? @map("remote_watch_synced_at")
```

- [ ] **Step 2: Generate migration and Prisma Client**

Run:

```bash
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npx prisma migrate dev --name add_remote_watch_status
```

Expected:
- New Prisma-generated migration directory matching `prisma/migrations/*_add_remote_watch_status/`.
- SQL adds `remote_watch_status`, `remote_watch_error`, `remote_watch_synced_at` to `monitor_sources`.
- Prisma Client regenerates successfully.

- [ ] **Step 3: Verify migration SQL**

Run:

```bash
sed -n '1,220p' prisma/migrations/*_add_remote_watch_status/migration.sql
```

Expected SQL shape:

```sql
ALTER TABLE "monitor_sources" ADD COLUMN "remote_watch_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "monitor_sources" ADD COLUMN "remote_watch_error" TEXT;
ALTER TABLE "monitor_sources" ADD COLUMN "remote_watch_synced_at" TIMESTAMP(3);
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): 记录 6551 监控同步状态"
```

---

### Task 2: 6551 Single-Account Watch Helpers

**Files:**
- Modify: `tests/open-twitter.test.ts`
- Modify: `src/open-twitter.ts`

- [ ] **Step 1: Write failing tests**

Replace the import in `tests/open-twitter.test.ts` with:

```ts
import {
  addWatchAccount,
  addWatchAccounts,
  buildWatchAddPayload,
  deleteWatchAccount
} from '../src/open-twitter.js';
```

Append these tests to `tests/open-twitter.test.ts`:

```ts

describe('addWatchAccount', () => {
  it('returns synced when watch-add succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"success":true}'
    });

    const result = await addWatchAccount({
      token: 'token-123',
      account: 'elonmusk',
      fetch: fetchMock
    });

    expect(result).toEqual({ ok: true, alreadyExists: false });
    expect(fetchMock).toHaveBeenCalledWith('https://ai.6551.io/open/twitter_watch_add', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildWatchAddPayload('elonmusk'))
    });
  });

  it('treats already-in-watch-list as success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"该Twitter账号已在监控列表中","success":false}'
    });

    await expect(addWatchAccount({ token: 'token-123', account: 'elonmusk', fetch: fetchMock })).resolves.toEqual({
      ok: true,
      alreadyExists: true
    });
  });

  it('returns an error for unexpected watch-add failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error'
    });

    await expect(addWatchAccount({ token: 'token-123', account: 'bad', fetch: fetchMock })).resolves.toEqual({
      ok: false,
      error: 'watch-add failed for @bad: 500 server error'
    });
  });
});

describe('deleteWatchAccount', () => {
  it('posts username to twitter_watch_delete', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"success":true}'
    });

    const result = await deleteWatchAccount({
      token: 'token-123',
      account: 'elonmusk',
      fetch: fetchMock
    });

    expect(result).toEqual({ ok: true, alreadyMissing: false });
    expect(fetchMock).toHaveBeenCalledWith('https://ai.6551.io/open/twitter_watch_delete', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'elonmusk' })
    });
  });

  it('treats missing remote watch as delete success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"该Twitter账号不在监控列表中","success":false}'
    });

    await expect(deleteWatchAccount({ token: 'token-123', account: 'elonmusk', fetch: fetchMock })).resolves.toEqual({
      ok: true,
      alreadyMissing: true
    });
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/open-twitter.test.ts
```

Expected: FAIL because `addWatchAccount` and `deleteWatchAccount` are not exported.

- [ ] **Step 3: Implement helpers**

Modify `src/open-twitter.ts` with these exported types and functions:

```ts
export interface WatchMutationOptions {
  token: string;
  account: string;
  fetch?: typeof fetch;
}

export type AddWatchAccountResult =
  | { ok: true; alreadyExists: boolean }
  | { ok: false; error: string };

export type DeleteWatchAccountResult =
  | { ok: true; alreadyMissing: boolean }
  | { ok: false; error: string };

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export async function addWatchAccount(options: WatchMutationOptions): Promise<AddWatchAccountResult> {
  const fetchImpl = options.fetch ?? fetch;
  const account = options.account.trim().replace(/^@+/, '');
  try {
    const response = await fetchImpl(`${BASE_URL}/open/twitter_watch_add`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildWatchAddPayload(account))
    });
    const body = await response.text();
    if (response.ok) {
      return { ok: true, alreadyExists: false };
    }
    if (includesAny(body, ['已在监控列表中', 'already'])) {
      return { ok: true, alreadyExists: true };
    }
    return { ok: false, error: `watch-add failed for @${account}: ${response.status} ${body}` };
  } catch (error) {
    return {
      ok: false,
      error: `watch-add failed for @${account}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function deleteWatchAccount(options: WatchMutationOptions): Promise<DeleteWatchAccountResult> {
  const fetchImpl = options.fetch ?? fetch;
  const account = options.account.trim().replace(/^@+/, '');
  try {
    const response = await fetchImpl(`${BASE_URL}/open/twitter_watch_delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: account })
    });
    const body = await response.text();
    if (response.ok) {
      return { ok: true, alreadyMissing: false };
    }
    if (includesAny(body, ['不在监控列表中', '不存在', 'not in', 'not found', 'missing'])) {
      return { ok: true, alreadyMissing: true };
    }
    return { ok: false, error: `watch-delete failed for @${account}: ${response.status} ${body}` };
  } catch (error) {
    return {
      ok: false,
      error: `watch-delete failed for @${account}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
```

Then update `addWatchAccounts()` to call `addWatchAccount()` per account:

```ts
export async function addWatchAccounts(options: AddWatchAccountsOptions): Promise<void> {
  const info = options.info ?? console.info;
  const warn = options.warn ?? console.warn;

  for (const account of options.accounts) {
    const result = await addWatchAccount({
      token: options.token,
      account,
      fetch: options.fetch
    });
    if (result.ok) {
      info(result.alreadyExists ? `watch-add already exists for @${account}` : `watch-add ok for @${account}`);
    } else {
      warn(result.error);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test tests/open-twitter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/open-twitter.ts tests/open-twitter.test.ts
git commit -m "feat: 增加 6551 单账号监控同步接口"
```

---

### Task 3: Source Service Remote Watch Status

**Files:**
- Modify: `tests/services/source-service.test.ts`
- Modify: `src/services/source-service.ts`

- [ ] **Step 1: Update source-service tests**

Update `fakeRow` in `tests/services/source-service.test.ts` to include:

```ts
  remoteWatchStatus: 'pending',
  remoteWatchError: null,
  remoteWatchSyncedAt: null,
```

Add these tests to `describe('sourceService.create', ...)`:

```ts
  it('initializes twitter source remote watch status as pending', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.create.mockResolvedValue(fakeRow);

    await createSourceService(prisma).create({ type: 'twitter', input: '@ElonMusk' });

    expect(prisma.monitorSource.create).toHaveBeenCalledWith({
      data: {
        type: 'twitter',
        target: 'ElonMusk',
        normalizedTarget: 'elonmusk',
        configJson: {},
        enabled: true,
        remoteWatchStatus: 'pending',
        remoteWatchError: null,
        remoteWatchSyncedAt: null
      }
    });
  });

  it('initializes non-twitter source remote watch status as not_applicable', async () => {
    prisma.monitorSource.findUnique.mockResolvedValue(null);
    prisma.monitorSource.create.mockResolvedValue({
      ...fakeRow,
      type: 'website',
      target: 'https://example.com/',
      normalizedTarget: 'https://example.com/',
      remoteWatchStatus: 'not_applicable'
    });

    await createSourceService(prisma).create({ type: 'website', input: 'https://example.com' });

    expect(prisma.monitorSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'website',
        remoteWatchStatus: 'not_applicable',
        remoteWatchError: null,
        remoteWatchSyncedAt: null
      })
    });
  });

  it('marks remote watch sync success', async () => {
    const syncedAt = new Date('2026-05-06T10:00:00Z');
    prisma.monitorSource.update.mockResolvedValue({
      ...fakeRow,
      remoteWatchStatus: 'synced',
      remoteWatchSyncedAt: syncedAt
    });

    const result = await createSourceService(prisma).markRemoteWatchSynced(7, syncedAt);

    expect(result.remoteWatchStatus).toBe('synced');
    expect(prisma.monitorSource.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        remoteWatchStatus: 'synced',
        remoteWatchError: null,
        remoteWatchSyncedAt: syncedAt
      }
    });
  });

  it('marks remote watch sync error', async () => {
    prisma.monitorSource.update.mockResolvedValue({
      ...fakeRow,
      remoteWatchStatus: 'error',
      remoteWatchError: 'bad token'
    });

    const result = await createSourceService(prisma).markRemoteWatchError(7, 'bad token');

    expect(result.remoteWatchStatus).toBe('error');
    expect(prisma.monitorSource.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        remoteWatchStatus: 'error',
        remoteWatchError: 'bad token'
      }
    });
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/services/source-service.test.ts
```

Expected: FAIL because source creation does not write remote watch fields and service methods do not exist.

- [ ] **Step 3: Implement source service updates**

Modify `src/services/source-service.ts`:

```ts
export type RemoteWatchStatus = 'pending' | 'synced' | 'error' | 'not_applicable';
```

Add to `SourceService`:

```ts
  markRemoteWatchSynced(id: number, syncedAt?: Date): Promise<MonitorSource>;
  markRemoteWatchError(id: number, error: string): Promise<MonitorSource>;
```

In `create()`, include these fields in `monitorSource.create` data:

```ts
          remoteWatchStatus: type === 'twitter' ? 'pending' : 'not_applicable',
          remoteWatchError: null,
          remoteWatchSyncedAt: null
```

Add methods:

```ts
    markRemoteWatchSynced(id, syncedAt = new Date()) {
      return prisma.monitorSource.update({
        where: { id },
        data: {
          remoteWatchStatus: 'synced',
          remoteWatchError: null,
          remoteWatchSyncedAt: syncedAt
        }
      });
    },
    markRemoteWatchError(id, error) {
      return prisma.monitorSource.update({
        where: { id },
        data: {
          remoteWatchStatus: 'error',
          remoteWatchError: error
        }
      });
    },
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test tests/services/source-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/source-service.ts tests/services/source-service.test.ts
git commit -m "feat: 维护监控源远端同步状态"
```

---

### Task 4: Add Source Realtime Watch Registration

**Files:**
- Modify: `tests/bot/add-source.test.ts`
- Modify: `src/bot/handlers/add-source.ts`

- [ ] **Step 1: Write failing add-source tests**

Replace the test `services` fixture in `tests/bot/add-source.test.ts` with:

```ts
const services = {
  sourceService: {
    create: vi.fn(),
    markRemoteWatchSynced: vi.fn(),
    markRemoteWatchError: vi.fn()
  }
};
```

Add helper:

```ts
function sourceRow(overrides = {}) {
  return {
    id: 7,
    type: 'twitter',
    target: 'elonmusk',
    normalizedTarget: 'elonmusk',
    configJson: {},
    enabled: true,
    remoteWatchStatus: 'pending',
    remoteWatchError: null,
    remoteWatchSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}
```

Add tests:

```ts
  it('syncs a newly-created twitter source to 6551', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: false
    });
    services.sourceService.markRemoteWatchSynced = vi.fn().mockResolvedValue(sourceRow({ remoteWatchStatus: 'synced' }));
    const registerWatch = vi.fn().mockResolvedValue({ ok: true, alreadyExists: false });

    const result = await performAddSource(services as never, 'twitter', '@elonmusk', { registerWatch });

    expect(registerWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.markRemoteWatchSynced).toHaveBeenCalledWith(7);
    expect(result.message).toContain('已同步到 6551');
  });

  it('does not sync an already-existing twitter source', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: true
    });
    const registerWatch = vi.fn();

    await performAddSource(services as never, 'twitter', '@elonmusk', { registerWatch });

    expect(registerWatch).not.toHaveBeenCalled();
  });

  it('records sync failure after local twitter source creation', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow(),
      alreadyExisted: false
    });
    services.sourceService.markRemoteWatchError = vi.fn().mockResolvedValue(sourceRow({ remoteWatchStatus: 'error' }));
    const registerWatch = vi.fn().mockResolvedValue({ ok: false, error: 'bad token' });

    const result = await performAddSource(services as never, 'twitter', '@elonmusk', { registerWatch });

    expect(services.sourceService.markRemoteWatchError).toHaveBeenCalledWith(7, 'bad token');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('6551 同步失败');
  });

  it('does not call 6551 for non-twitter sources', async () => {
    services.sourceService.create = vi.fn().mockResolvedValue({
      source: sourceRow({
        id: 8,
        type: 'website',
        target: 'https://x.com',
        normalizedTarget: 'https://x.com',
        remoteWatchStatus: 'not_applicable'
      }),
      alreadyExisted: false
    });
    const registerWatch = vi.fn();

    await performAddSource(services as never, 'website', 'https://x.com', { registerWatch });

    expect(registerWatch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/bot/add-source.test.ts
```

Expected: FAIL because `performAddSource` does not accept the watch options and does not call service sync status methods.

- [ ] **Step 3: Implement add-source registration**

Modify `src/bot/handlers/add-source.ts`:

```ts
export interface WatchRegistrationDeps {
  registerWatch?: (account: string) => Promise<{ ok: true; alreadyExists?: boolean } | { ok: false; error: string }>;
}
```

Change function signature:

```ts
export async function performAddSource(
  services: ServicesBundle,
  type: string,
  input: string,
  watchDeps: WatchRegistrationDeps = {}
): Promise<AddResult> {
```

After `sourceService.create()` and `head` construction, add:

```ts
    if (type === 'twitter' && !alreadyExisted && watchDeps.registerWatch) {
      const synced = await watchDeps.registerWatch(source.normalizedTarget);
      if (synced.ok) {
        await services.sourceService.markRemoteWatchSynced(source.id);
        return { ok: true, message: `${head}\n✅ 已同步到 6551 监控` };
      }
      await services.sourceService.markRemoteWatchError(source.id, synced.error);
      return { ok: true, message: `${head}\n⚠️ 6551 同步失败：${synced.error}` };
    }
```

Update `createAddSourceConversation()` to accept and pass `watchDeps`:

```ts
export function createAddSourceConversation(services: ServicesBundle, watchDeps: WatchRegistrationDeps = {}) {
```

Inside it:

```ts
    const result = await performAddSource(services, arg, input, watchDeps);
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test tests/bot/add-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/add-source.ts tests/bot/add-source.test.ts
git commit -m "feat: 新增监控源后同步 6551"
```

---

### Task 5: Source Actions Watch Add/Delete Sync

**Files:**
- Modify: `tests/bot/source-actions.test.ts`
- Modify: `src/bot/handlers/source-actions.ts`

- [ ] **Step 1: Write failing source-actions tests**

Replace the top-level `fakeSource` constant in `tests/bot/source-actions.test.ts` with:

```ts
function fakeSource(overrides = {}) {
  return {
    id: 1,
    type: 'twitter',
    target: 'elonmusk',
    normalizedTarget: 'elonmusk',
    configJson: {},
    enabled: true,
    remoteWatchStatus: 'synced',
    remoteWatchError: null,
    remoteWatchSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}
```

Replace `makeServices()` with:

```ts
function makeServices() {
  const source = fakeSource();
  return {
    sourceService: {
      findById: vi.fn().mockResolvedValue(source),
      setEnabled: vi.fn().mockResolvedValue({ ...source, enabled: false }),
      remove: vi.fn().mockResolvedValue(undefined),
      markRemoteWatchSynced: vi.fn().mockResolvedValue(source),
      markRemoteWatchError: vi.fn().mockResolvedValue(source)
    },
    destinationService: {
      listEnabled: vi.fn().mockResolvedValue([])
    },
    subscriptionService: {
      listDestinationIdsForSource: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(true)
    }
  };
}
```

Add this helper after `makeServices()`:

```ts
function fakeCtx() {
  return {
    reply: vi.fn(),
    answerCallbackQuery: vi.fn(),
    editMessageReplyMarkup: vi.fn(),
    editMessageText: vi.fn()
  };
}
```

Add tests:

```ts
  it('deletes remote watch before disabling a twitter source', async () => {
    const services = makeServices();
    const source = fakeSource({ enabled: true, type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.setEnabled.mockResolvedValue({ ...source, enabled: false });
    services.sourceService.markRemoteWatchSynced.mockResolvedValue(source);
    const unregisterWatch = vi.fn().mockResolvedValue({ ok: true, alreadyMissing: false });
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(unregisterWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(source.id, false);
  });

  it('does not disable locally when remote watch delete fails', async () => {
    const services = makeServices();
    const source = fakeSource({ enabled: true, type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.markRemoteWatchError.mockResolvedValue(source);
    const unregisterWatch = vi.fn().mockResolvedValue({ ok: false, error: 'bad token' });
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(services.sourceService.setEnabled).not.toHaveBeenCalled();
    expect(services.sourceService.markRemoteWatchError).toHaveBeenCalledWith(source.id, 'bad token');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('6551 同步失败'));
  });

  it('adds remote watch before enabling a twitter source', async () => {
    const services = makeServices();
    const source = fakeSource({ enabled: false, type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.setEnabled.mockResolvedValue({ ...source, enabled: true });
    services.sourceService.markRemoteWatchSynced.mockResolvedValue(source);
    const registerWatch = vi.fn().mockResolvedValue({ ok: true, alreadyExists: false });
    const handler = createSourceActionsHandler(services as never, { registerWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(registerWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(source.id, true);
  });

  it('deletes remote watch before removing a twitter source', async () => {
    const services = makeServices();
    const source = fakeSource({ type: 'twitter', normalizedTarget: 'elonmusk' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.remove.mockResolvedValue(undefined);
    services.sourceService.markRemoteWatchSynced.mockResolvedValue(source);
    const unregisterWatch = vi.fn().mockResolvedValue({ ok: true, alreadyMissing: false });
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.delete(ctx as never, source.id);

    expect(unregisterWatch).toHaveBeenCalledWith('elonmusk');
    expect(services.sourceService.remove).toHaveBeenCalledWith(source.id);
  });

  it('does not call 6551 for non-twitter source toggle', async () => {
    const services = makeServices();
    const source = fakeSource({ type: 'website', enabled: true, normalizedTarget: 'https://example.com/' });
    services.sourceService.findById.mockResolvedValue(source);
    services.sourceService.setEnabled.mockResolvedValue({ ...source, enabled: false });
    const unregisterWatch = vi.fn();
    const handler = createSourceActionsHandler(services as never, { unregisterWatch });
    const ctx = fakeCtx();

    await handler.toggle(ctx as never, source.id);

    expect(unregisterWatch).not.toHaveBeenCalled();
    expect(services.sourceService.setEnabled).toHaveBeenCalledWith(source.id, false);
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/bot/source-actions.test.ts
```

Expected: FAIL because `createSourceActionsHandler` does not accept watch deps and source service lacks sync status calls.

- [ ] **Step 3: Implement source-actions sync**

Modify `src/bot/handlers/source-actions.ts`:

```ts
export interface WatchSyncDeps {
  registerWatch?: (account: string) => Promise<{ ok: true; alreadyExists?: boolean } | { ok: false; error: string }>;
  unregisterWatch?: (account: string) => Promise<{ ok: true; alreadyMissing?: boolean } | { ok: false; error: string }>;
}
```

Change factory signature:

```ts
export function createSourceActionsHandler(services: ServicesBundle, watchDeps: WatchSyncDeps = {}) {
```

Add helper inside the factory:

```ts
  async function syncBeforeToggle(source: { id: number; type: string; normalizedTarget: string; enabled: boolean }): Promise<string | null> {
    if (source.type !== 'twitter') return null;
    const sync = source.enabled ? watchDeps.unregisterWatch : watchDeps.registerWatch;
    if (!sync) return null;
    const result = await sync(source.normalizedTarget);
    if (result.ok) {
      await services.sourceService.markRemoteWatchSynced(source.id);
      return null;
    }
    await services.sourceService.markRemoteWatchError(source.id, result.error);
    return result.error;
  }

  async function syncBeforeDelete(source: { id: number; type: string; normalizedTarget: string }): Promise<string | null> {
    if (source.type !== 'twitter' || !watchDeps.unregisterWatch) return null;
    const result = await watchDeps.unregisterWatch(source.normalizedTarget);
    if (result.ok) {
      await services.sourceService.markRemoteWatchSynced(source.id);
      return null;
    }
    await services.sourceService.markRemoteWatchError(source.id, result.error);
    return result.error;
  }
```

In `toggle()`, before `setEnabled`:

```ts
      const syncError = await syncBeforeToggle(source);
      if (syncError) {
        await ctx.reply(`6551 同步失败：${syncError}`);
        return;
      }
```

In `delete()`, load the source first and sync before remove:

```ts
      const source = await services.sourceService.findById(sourceId);
      if (!source) {
        await ctx.reply(STALE_BUTTON);
        return;
      }
      const syncError = await syncBeforeDelete(source);
      if (syncError) {
        await ctx.reply(`6551 同步失败：${syncError}`);
        return;
      }
      await services.sourceService.remove(sourceId);
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test tests/bot/source-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/source-actions.ts tests/bot/source-actions.test.ts
git commit -m "feat: 启停删除监控源时同步 6551"
```

---

### Task 6: Main Wiring and Source List Visibility

**Files:**
- Modify: `src/bot/main.ts`
- Modify: `src/bot/messages.ts`
- Modify: `tests/events.test.ts` is not touched.

- [ ] **Step 1: Wire watch synchronizer in main**

Modify imports in `src/bot/main.ts`:

```ts
import { addWatchAccount, deleteWatchAccount } from '../open-twitter.js';
```

After service creation, add:

```ts
  const watchSynchronizer = {
    registerWatch: (account: string) => addWatchAccount({ token: config.twitterToken, account }),
    unregisterWatch: (account: string) => deleteWatchAccount({ token: config.twitterToken, account })
  };
```

Pass it into handlers:

```ts
  const sourceActions = createSourceActionsHandler(services, watchSynchronizer);
```

Update conversation registration:

```ts
      createAddSourceConversation(services, watchSynchronizer),
```

Update `/add` command:

```ts
    const result = await performAddSource(services, type, rest.join(' '), watchSynchronizer);
```

- [ ] **Step 2: Show remote sync errors in source lines**

Modify `describeSourceLine()` in `src/bot/messages.ts`:

```ts
  const remote =
    source.remoteWatchStatus === 'error'
      ? ` ⚠️ 6551同步失败${source.remoteWatchError ? `：${source.remoteWatchError}` : ''}`
      : '';
  return `#${source.id} ${status} ${desc}${remote}`;
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm test tests/open-twitter.test.ts tests/services/source-service.test.ts tests/bot/add-source.test.ts tests/bot/source-actions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/bot/main.ts src/bot/messages.ts
git commit -m "feat: 装配 6551 实时同步"
```

---

### Task 7: Final Verification and Runtime Restart

**Files:**
- No source changes expected.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Apply migration and run full test suite**

Run outside sandbox if local Postgres is inaccessible inside sandbox:

```bash
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npx prisma migrate deploy
DATABASE_URL=postgresql://x:x@localhost:5432/x_monitor npm test
```

Expected: migration deploy PASS, all tests PASS.

- [ ] **Step 4: Restart bot**

If a bot is running from this worktree, stop its process group, then start it again:

```bash
PID=$(cat /tmp/x-monitor-bot.pid)
kill -TERM -"$PID"
sleep 2
: > /tmp/x-monitor-bot.log
setsid npm run bot </dev/null >> /tmp/x-monitor-bot.log 2>&1 & echo $! > /tmp/x-monitor-bot.pid
sleep 5
tail -80 /tmp/x-monitor-bot.log
```

Expected:
- `Bot @Ghaith_test_bot started`
- `Twitter worker WSS connected`
- 6551 subscribe response has `success=true`.

- [ ] **Step 5: Commit progress snapshot if tracked**

Check:

```bash
git status --short
```

Expected: clean. If only untracked `docs/superpowers/progress/` appears in the main project root, leave it uncommitted because that progress file is intentionally local.
