---
name: cache-status-verify
description: 缓存过期提示 chip 全链路验证 — socket 注入 cache-status / chip 渲染断言 / result 清空时序坑
metadata:
  type: recipe
  last_verified: 2026-09-12
---

# 缓存过期提示（cacheStatus chip）验证

验证 SessionStart 缓存信号链路：cli hook → socket `cache-status` → hub runtimeState → web StatusBar chip。

## 核心 E2E 手法：socket 注入（绕过 CLI）

真实触发需要 `prompt_cache_likely_expired=true`（距上次响应超 cache TTL，本机账号实测疑似 1h——kill CLI 后等 5m 仍 warm，resume 首 turn cache hit 97.8%）。等不起 TTL 时用 socket 客户端以 CLI 身份直发事件：

```js
// /tmp/cache-status-inject.mjs（bun 运行）
import { io } from '<repo>/packages/cli/node_modules/socket.io-client/build/esm/index.js'
const socket = io('http://localhost:2224/cli', {
  auth: { token: 'e2e-test-token-mobi', clientType: 'session-scoped', sessionId: sid },
  path: '/socket.io/', transports: ['websocket'],
})
socket.on('connect', () => {
  socket.emit('cache-status', { sid, cacheStatus: { expired: true, contextTokens: 24000, secondsSinceLastResponse: 3720, estimatedCacheWriteUsd: 0.12, observedAt: Date.now() } })
  // 清空：cacheStatus: null
})
```

cliApiToken 在 `~/.mobi-e2e/settings.hub.json`。emitted 后 `sqlite3` 断言 `json_extract(runtime_state,'$.cacheStatus')`，刷新页面断言 `[data-testid="cache-status-chip"]`。

## 时序坑

- **注入必须在 turn 运行前**：result 帧到达即清空（cli sendClaudeSessionMessage 咽喉点无条件 emit null）。注入后若无新 turn，状态会一直挂着等下个 result——「清空」断言要在注入**之后**发一条消息。
- warm 场景（TTL 未过）resume 不上报是**正确行为**，不是 bug；判定依据＝resume 后首 turn 统计卡 cache hit 接近 100%。
- 会话 inactive 判定有延迟（~30s+），kill CLI 后立即 reload 可能没有 Resume 按钮，稍等再刷。

## 探针日志

cli 两侧（claudeRemote 进程内 hook / runClaude HTTP hook）有 `[cache-probe]` info 日志（source/likelyExpired/contextTokens/secondsSinceLastResponse/reported），是上游 TTL 判定的权威观测点；cli info 落盘于 MOBI_HOME/logs。
