---
name: rewind-verify
description: rewind 入口 E2E — 按钮渲染 / dry-run 预检 / 链首消息拒绝坑 / 实时 ack 合并验证
metadata:
  type: recipe
  last_verified: 2026-08-18
---

# rewind 入口验证

## 验证目标与断言

1. **rewind 按钮渲染**：snapshot 里用户消息 footer 有 `button "Rewind & edit"`（`lucide-undo-2` 图标）。
   判据 = `canRewindMessage`：`nativeAckAt` 非空 + `nativeSessionId` 与会话一致 + `running=false` + 无后台任务。
2. **nativeAckAt 落库**（isReplay 回显确认）：
   ```bash
   sqlite3 ~/.mobi-e2e/mobi.db "SELECT seq, local_id, native_id, json_extract(metadata,'\$.nativeAckAt') FROM messages WHERE session_id='<sid>' AND json_extract(metadata,'\$.nativeId') IS NOT NULL ORDER BY seq;"
   ```
   用户消息（local_id LIKE 'local-%'）的 nativeAckAt 非空即过。
3. **dry-run 预检**：点按钮 → 弹 `Rewind & edit` 确认弹窗（含回填文本 + "Restore code and rewind"/"Rewind conversation only" 两选项）= 预检通过。
   直接调 API 看 reason 更稳：
   ```js
   fetch(`/api/sessions/<sid>/rewind/dry-run`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ nativeId }) })
   ```

## 坑（易误判为 bug）

- **链首消息不可 rewind**：会话第一条用户消息前面无 assistant 锚点，`findRewindAnchor` 返回 null → dry-run 返回
  `reason: "rewind anchor not found in transcript (cannot rewind the first message of a session — use /clear instead)"`。
  **前端仍渲染按钮**（判据不看链首），点了才 toast `This message cannot be rewound`——这是预期（前端判据保守只负责隐藏、放行侧由 CLI 预检把守，spec §5.3），不是 bug。
  → 验证 rewind 成功必须**至少 2 条用户消息**（第二条前有 assistant 锚点）。
- **实时 ack 合并**：新发消息后，ack 广播经 `messageCache.mergeNativeMetadata` 补 `nativeAckAt`，按钮**实时**渲染（不等刷新）。
  若漏了 `nativeAckAt` 字段合并，按钮不实时出现、刷新才见——这是 2026-08-18 修的 bug（mergeNativeMetadata 只合并 nativeId/nativeSessionId 漏了 nativeAckAt）。

## 观察（2026-08-18 实测）

- E2E 环境 web 是 vite dev server（`bun run dev`，5175），web 源码改动 HMR 自动生效，**刷新浏览器即可**，无需 rebuild 二进制。
- dry-run 是 Web→Hub→CLI RPC 透传，链首/假锚点拒绝的 reason 在响应体里，evaluate_script fetch 直接可读，不必看 CLI 日志。

## 相关

- native_id 绑定 SQL 断言见 [[native-id-verify]]
- 实时合并纯函数见 `packages/web/src/core/data/cache/messageCache.ts`（mergeNativeMetadata）
