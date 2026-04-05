# 版本化更新协议 (`versionedUpdate.ts`)

乐观锁机制，确保 CLI 与 Hub 之间的元数据/状态更新不会因并发冲突而丢失。

## 核心思想

CLI 和 Hub 各自维护一份带版本号的本地缓存。更新时：

1. CLI 发送 `{ value, expectedVersion }`
2. Hub 比对 `expectedVersion` 与服务端版本
3. 匹配 → 更新成功，返回新版本
4. 不匹配 → 返回最新值，CLI 需重试

## ACK 响应类型

```typescript
type VersionedAckResult<ValueKey> =
    | { result: 'success'; version: number; [valueKey]: Value | null }
    | { result: 'version-mismatch'; version: number; [valueKey]: Value | null }
    | { result: 'error'; reason?: string }
```

| 结果 | 含义 | CLI 行为 |
|------|------|---------|
| `success` | 更新成功 | 应用新值和版本号 |
| `version-mismatch` | 版本冲突 | 应用最新值，抛异常触发 backoff 重试 |
| `error` | 服务端错误 | 抛异常触发 backoff 重试 |

## applyVersionedAck 函数

```typescript
applyVersionedAck(ack, options)
```

### 参数

| 字段 | 说明 |
|------|------|
| `valueKey` | 响应中值字段的键名（如 `'metadata'`、`'agentState'`） |
| `parseValue` | Zod 解析函数，校验并转换原始值 |
| `applyValue` | 应用解析后的值到本地缓存 |
| `applyVersion` | 更新本地版本号 |
| `logInvalidValue` | 值校验失败时的日志回调 |
| `*Message` | 各种错误场景的错误信息模板 |

### 处理流程

```
ack (unknown)
    │
    ├── 非对象 → 抛 invalidResponseMessage
    │
    ├── result === 'success' | 'version-mismatch'
    │   ├── 提取 version
    │   ├── 提取 rawValue (可为 null)
    │   ├── null → applyValue(null)
    │   ├── 非null → parseValue → 成功: applyValue | 失败: logInvalidValue
    │   ├── applyVersion(version)
    │   └── 'version-mismatch' → 抛 versionMismatchMessage (触发重试)
    │
    ├── result === 'error'
    │   └── 抛 errorMessage (reason)
    │
    └── 其他 → 抛 invalidResponseMessage
```

## 使用场景

| 客户端 | 更新内容 | valueKey |
|--------|---------|----------|
| `ApiSessionClient` | session metadata | `'metadata'` |
| `ApiSessionClient` | agent state | `'agentState'` |
| `ApiMachineClient` | machine metadata | `'metadata'` |
| `ApiMachineClient` | runner state | `'runnerState'` |

## 重试机制

所有版本化更新都包裹在 `backoff()` 中：

```
try: emitWithAck → applyVersionedAck
    │
    ├── success → done
    ├── version-mismatch → throw → backoff → retry (使用最新值)
    └── error → throw → backoff → retry
```

结合 `AsyncLock`（Session 级）确保同一资源的更新串行执行。
