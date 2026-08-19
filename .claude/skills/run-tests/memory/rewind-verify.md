---
name: rewind-verify
description: rewind 全链路 E2E — 按钮/ack/dry-run/截断上下文探针/连续 rewind/回填断言；进行中窗口抓不到的坑
metadata:
  type: recipe
  last_verified: 2026-08-19
---

# rewind 全链路验证

## 验证目标与断言

1. **rewind 按钮渲染**：snapshot 里用户消息 footer 有 `button "Rewind & edit"`（`lucide-undo-2` 图标）。
   判据 = `canRewindMessage`：`nativeAckAt` 非空 + `nativeSessionId` 与会话一致 + `running=false` + 无后台任务 + 非 rewind 进行中。
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
4. **截断真生效（上下文探针，最硬断言）**：rewind 后发「我之前让你回复过哪些数字？只列出你实际能看到的，不要调用任何工具」→ 模型只答被保留的数字（被截断回合的数字不出现）= transcript 真被截断、且哨兵未把 NUL 串当 prompt。
5. **软删除 SQL 断言**：`SELECT seq, deleted_at IS NOT NULL FROM messages WHERE session_id='<sid>' ORDER BY seq` → 锚点批首行 seq 起全部翻 1。
6. **回填断言**：rewind 完成后 `textarea.value` = 锚点消息原文、sender 解锁、`Rewound to here` 分隔线出现。
7. **哨兵泄漏断言**：`SELECT count(*) FROM messages WHERE content LIKE '%mobi:rewind-exit%'` = 0。
8. **连续 rewind**：rewind 完成发新消息 → 在新消息上再次 rewind 仍成功（launcher while 循环健康、无残留 pending）。

## 坑（易误判为 bug）

- **链首消息不可 rewind**：会话第一条用户消息前面无 assistant 锚点，`findRewindAnchor` 返回 null → dry-run 返回
  `reason: "rewind anchor not found in transcript (cannot rewind the first message of a session — use /clear instead)"`。
  **前端仍渲染按钮**（判据不看链首），点了 toast `This message cannot be rewound` 后弹窗不开——预期行为，不是 bug。
  → 验证 rewind 成功必须**至少 2 条用户消息**（第二条前有 assistant 锚点）。
- **实时 ack 合并**：新发消息后，ack 广播经 `messageCache.mergeNativeMetadata` 补 `nativeAckAt`，按钮**实时**渲染（不等刷新）。
- **进行中窗口抓不到**：POST 受理 → 两段回报全链路 **<2s**（CLI 截断轮很快），串行 MCP 工具（click → evaluate 往返）必然错过。
  别反复尝试抓 in-flight 状态（sender disabled / 其余入口隐藏）——这类互斥验证靠单测，E2E 只断言终态。
- **已回填 sender 上 Ctrl+A 不清空**：rewind 回填后 Ctrl+A + type_text 会**追加**而非替换。
  探针消息须先清空（连续 Backspace）或接受追加（探针问句在文末同样生效）。

## 观察（2026-08-19 实测）

- E2E 环境 web 是 vite dev server（`bun run dev`，5175），web 源码改动 HMR 自动生效，**刷新浏览器即可**，无需 rebuild 二进制。
- dry-run 是 Web→Hub→CLI RPC 透传，链首/假锚点拒绝的 reason 在响应体里，evaluate_script fetch 直接可读，不必看 CLI 日志。
- 选 "Rewind conversation only"（不恢复文件）链路最短；文件恢复路径按需另验。

## 相关

- native_id 绑定 SQL 断言见 [[native-id-verify]]
- 实时合并纯函数见 `packages/web/src/core/data/cache/messageCache.ts`（mergeNativeMetadata）
