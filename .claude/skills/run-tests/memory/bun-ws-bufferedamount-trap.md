---
name: bun-ws-bufferedamount-trap
description: Bun WebSocket 的 bufferedAmount 只在 send 时增长、从不随 flush 衰减——用它做背压排空轮询必死锁
metadata:
  type: reference
  last_verified: 2026-09-17
---

# Bun WS bufferedAmount 陷阱

**现象**：desktop 真实桌面流（大帧洪峰后）卡死，hub/codec 两侧互相等对方 drain，页面黑屏、provider 快速重试循环。

**实测（Bun 探针 200MB 慢消费者实验）**：
- client `WebSocket.bufferedAmount` 在 send 后增长，随后**恒定卡死不衰减**（数据实际已由 Bun 后台 flush 上 wire）
- server `ServerWebSocket` 同源实现，`getBufferedAmount()` 同样只在 send 调用时变化
- client `send()` 从不失败（200MB 也照单全收），client 端不存在有效背压信号

**正确姿势**：
- `ServerWebSocket.send` 返回 -1 = 「已入 Bun 内部缓冲、未上 wire」，**数据不丢**、Bun 自动 flush——不需要应用层排队/排空轮询
- 慢消费者护栏用**字节差值**统计（收方 in - 发方 out > 阈值拆会话），不依赖 bufferedAmount
- hub 侧 `startDrainPoll`/`RelayQueue` 已因此删除（broker.ts relay 注释有完整记录）
- cli 侧 ws endpoint send 恒返回 true（洪峰由 Bun 内部缓冲吸收，本机回环一次性 ~20-60MB）

**教训**：任何「send 返回 -1 → 进队列 → 等 bufferedAmount 清零再重发」的背压模式在 Bun 下都是死锁。

相关：[[desktop-stream-verify]]
