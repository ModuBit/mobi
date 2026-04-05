# SocketOutbox (`socketOutbox.ts`)

离线消息缓冲队列，在 Socket.IO 连接断开时暂存待发送的消息，重连后批量发送。

> 当前代码中已定义但未在 apiSession/apiMachine 中使用。属于预留的可靠性增强设施。

## 核心职责

- 离线期间的消息入队
- 容量限制（总字节、条目数、单条大小）
- 过期淘汰（TTL）
- 连接恢复后批量 flush

## 配置项

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `maxBytes` | `MOBI_OUTBOX_MAX_BYTES` | 16MB | 队列总字节数上限 |
| `maxItems` | `MOBI_OUTBOX_MAX_ITEMS` | 500 | 队列条目数上限 |
| `maxItemBytes` | `MOBI_OUTBOX_MAX_ITEM_BYTES` | 1MB | 单条消息大小上限 |
| `maxAgeMs` | `MOBI_OUTBOX_MAX_AGE_MS` | 15min | 消息过期时间 |
| `dropLogIntervalMs` | `MOBI_OUTBOX_DROP_LOG_INTERVAL_MS` | 5s | 丢弃日志节流间隔 |

## 入队流程

```
enqueue(event, args)
    │
    ├── outbox 已禁用 (maxBytes ≤ 0 || maxItems ≤ 0) → drop + return false
    │
    ├── dropExpired() → 清理过期消息
    │
    ├── 单条超限 (sizeBytes > maxItemBytes) → drop + return false
    │
    ├── 队列满 → 逐条淘汰最老消息直到有空间
    │
    └── 入队成功 → return true
```

## 淘汰策略

1. **TTL 过期**: 每次入队前清理超过 `maxAgeMs` 的旧消息（FIFO）
2. **容量淘汰**: 新消息入队时，如果总容量/条目超限，从队首逐条淘汰

## 丢弃日志

- 丢弃事件被节流记录（每 `dropLogIntervalMs` 最多一条日志）
- 记录丢弃数量、总字节数、丢弃原因
- 丢弃原因: `outbox-disabled` / `item-too-large` / `outbox-full` / `expired`

## Flush

```typescript
flush(emit: (event, args) => void)
```

重连后调用，将所有暂存消息按序发送：

1. 先清理过期消息
2. 取出所有消息（清空队列）
3. 逐条调用 `emit` 发送

## 数据结构

```typescript
type OutboxItem = {
    event: string          // Socket.IO 事件名
    args: readonly unknown[] // 事件参数
    sizeBytes: number       // JSON 序列化后字节大小
    enqueuedAt: number      // 入队时间戳
}
```

## 大小估算

使用 `JSON.stringify` + `Buffer.byteLength` 精确计算 UTF-8 字节大小。序列化失败返回 `MAX_SAFE_INTEGER`（确保被拒绝）。
