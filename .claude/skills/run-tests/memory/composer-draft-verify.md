---
name: composer-draft-verify
description: composer 草稿持久化 E2E——空白不落盘 / 跨页合并携 chip / 发送失败保留，含 axios 走 XHR 的失败注入 recipe
metadata:
  type: recipe
  last_verified: 2026-11-11
---

# composer 草稿持久化验证

会话页 composer 的草稿存在 sessionStorage `mobi:composer-drafts`（per-session，text/files/images/quotes 分段 + editorState JSON）。断言一律直接读该 key 的 JSON。

## recipe

1. **空白不落盘**：编辑器里只输入空格 → `sessionStorage.getItem('mobi:composer-drafts')` 应为 `{}`（无该 session 键）。判据在 ChatComposer 的 `getEditorState`：`text.trim()` 为空且 quotes=0 才返回 null
2. **跨页合并携 chip**：新会话页（NewSessionPage）输入文本 + 加引用 chip → 点某会话进入会话页 → 草稿文本被并入该会话草稿，**chip 与评论同时存活**（旧 editorState 作废，chip 摘入 quotes 桶，恢复时 `insertQuotesAtEnd` 插回；恢复路径不抢焦点，`document.activeElement` 应为 BODY）
3. **发送失败保留**：patch **XMLHttpRequest**（API client 走 axios，patch `window.fetch` 无效）——`XMLHttpRequest.prototype.open` 记录 url，`send` 对 `POST /api/sessions/spawn` dispatch `new ProgressEvent('error')`，其余放行。触发发送后：编辑器重挂、草稿文本仍在、发送钮可用
4. **清空/删除**：草稿随 setText 空 + 无引用时键消失；`clearDraft` 只在发送成功路径调用

## 坑

- 草稿恢复/合并发生在页面挂载，**移动端首屏恢复不许 focus**（会弹键盘抢滚动）；需要焦点的调用方自己显式 focus
- editorState 与 text 双路：恢复顺序是 setText 兜底 → setEditorStateJSON 覆盖；chip 只有 editorState 路径能带回来，text 路径天然丢 chip（这也是跨页合并要手工摘 chip 的原因）
