---
name: thinking-flash-verify
description: thinking 完成闪烁验证 — MutationObserver 判 remount / crossfade 次数
metadata:
  type: recipe
  last_verified: 2026-10-19
---

# thinking 完成「再闪一下」验证

症状：标题从「思考中」变「思考完成」后还会再闪一次。两个独立成因，验证时分开观测：

1. **block 重 mount**（snapshot→full 到达）：DOM 节点被换掉 → Think 标题的入场淡入重播。
2. **重复 crossfade**：标题文本变了两次（如 durationMs 晚到）→ 两次淡入。

## recipe

1. 在 `.chat-scroll-container` 上挂 MutationObserver，记录 `.ant-think` 的增删与
   `.crossfade-text` 的新增（每帧记录 performance.now + 文本）。
2. **先标记再等**：给当前 thinking 的 `.ant-think` 打 `dataset.e2eMark = 'reasoning-1'`，
   思考结束后查这个节点是否还在（mark 丢失 = 整个气泡被重 mount）。
3. 发一条能触发长思考的 prompt（要求先长推理再答），等标题变成「思考完成 · X 秒」后读事件。

## 判读

- 修复前：snapshot 行 localId（stream uuid）≠ full 行 localId（.jsonl uuid），
  `blockId = localId:idx` 换 key → `think-` / `think+` 成对出现、mark 丢失。
- 修复后（blockId 优先用 Anthropic message.id）：只有一次 `crossfade+`（思考中→思考完成），
  无 `think-/+`，mark 保留。
- 附带说明：`.crossfade-text` 只在**文案切换**时挂（首帧不播淡入），观察到的 crossfade+
  次数应等于文本变化次数。

## 坑

- Observer 要在聊天容器**稳定挂载后**再挂（页面刚加载时容器会被替换，提前挂丢事件）。
- 事件可能漏在轮询间隙：用「标记节点 + 事件数组」双证据，别只看事件数组。
