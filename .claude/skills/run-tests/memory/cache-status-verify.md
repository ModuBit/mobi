---
name: cache-status-verify
description: 缓存过期提示 + goal 状态行验证 — socket 注入（宿主端口 12224）/ 列表尾行与目标行断言 / result 清空时序坑
metadata:
  type: recipe
  last_verified: 2026-10-17
---

# 缓存过期提示 + goal 状态行验证

2026-10-17 起两者都**不在 composer 上方那一行**：
- 缓存过期 → 聊天流末尾的「系统动作行」`CacheExpiredRow`（`data-testid="cache-expired-row"`）
- goal → composer 上方独占整行的 `GoalRow`（`data-testid="goal-row"`，StatusBar 唯一内容）
- 运行指示 → 聊天流末尾的 `AgentLoadingBubble`（borderless 尾行，与 compact/clear 并排规则见 ChatContainer）

## 核心 E2E 手法：socket 注入（绕过 CLI）

`/cli` namespace 在**宿主通道**（`daemon.state.json` 的 `hostPort` = 主端口 + 10000，e2e 为 **12224**），
不是主端口 2224——连 2224 会报 `Invalid namespace`（2026-10-17 实踩；旧 recipe 的 2224 已失效）。

```js
// /tmp/status-inject.mjs（bun 运行）
import { io } from '<repo>/packages/cli/node_modules/socket.io-client/build/esm/index.js'
const sid = process.argv[2]
const socket = io('http://localhost:12224/cli', {
  auth: { token: 'e2e-test-token-mobi', clientType: 'session-scoped', sessionId: sid },
  path: '/socket.io/', transports: ['websocket'],
})
socket.on('connect', () => {
  socket.emit('cache-status', { sid, cacheStatus: { expired: true, contextTokens: 24000, secondsSinceLastResponse: 3720, estimatedCacheWriteUsd: 0.12, observedAt: Date.now() } })
  socket.emit('goal-status', { sid, goalStatus: { met: false, condition: '我只说结束时才结束', iterations: 2, durationMs: 638000, tokens: 12400 } })
  setTimeout(() => process.exit(0), 600)
})
```

`cliApiToken` 在 `~/.mobi-e2e/settings.cli.json` / `settings.daemon.json`（e2e 均为 `e2e-test-token-mobi`）。
落库断言：`sqlite3 ~/.mobi-e2e/mobi.db "select json_extract(runtime_state,'$.cacheStatus'), json_extract(runtime_state,'$.goalStatus') from sessions where id='<sid>'"`。

## 断言要点

- **空会话看不到列表尾行**：`chatBlocks.length === 0` 走 `ChatWelcome`，缓存行/loading 行都不渲染。
  至少先发一条消息再看尾行。
- 缓存行与 loading 行的自然窗口只有「发出消息 → 首个 result 帧」之间：注入后**立刻**发一条消息，
  在流式期间截图；result 到达即清空（cli `sendClaudeSessionMessage` 咽喉点）——「清空」本身就是断言。
- goal-row 整行宽 = composer 内容宽（`.ant-sender` 卡片两侧各内缩 16px）；与 composer 间距 8px。
- 动作（详情 / 清理）在 `@media (hover: hover) and (pointer: fine)` 下设 `opacity:0`，hover / focus-within → 1；
  CDP 用 MCP `hover` 悬停行文本即可量到 `[data-goal-actions]` 的 opacity。
- 清理走 `ClearStateButton`：桌面 Popconfirm「确认清理」，移动端底部抽屉；点完 `goal-row` 应从 DOM 消失。
- 主题切换：`localStorage.mobi-ui` 的 `state.theme`（zustand persist），改完 `location.reload()`。

## 时序坑

- **注入必须在 turn 运行前**：result 帧到达即清空；注入后若无新 turn，状态会一直挂着等下个 result——
  「清空」断言要在注入**之后**发一条消息。
- warm 场景（TTL 未过）resume 不上报是**正确行为**，不是 bug；判定依据＝resume 后首 turn 统计卡 cache hit 接近 100%。
- 会话 inactive 判定有延迟（~30s+），kill CLI 后立即 reload 可能没有 Resume 按钮，稍等再刷。

## 探针日志

cli 两侧（claudeRemote 进程内 hook / runClaude HTTP hook）有 `[cache-probe]` info 日志（source/likelyExpired/contextTokens/secondsSinceLastResponse/reported），是上游 TTL 判定的权威观测点；cli info 落盘于 MOBI_HOME/logs。
