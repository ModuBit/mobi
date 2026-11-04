---
name: retention-verify
description: 会话保留期（归档/删除/豁免）全链路验收：spawn/messages body schema、UI 归档链路、409 门、archived 页、深链接状态页、批量删除门槛、transcript 真删+墓碑断言
metadata:
  type: recipe
  last_verified: 2026-11-03
---

# 会话保留期验证

spec `.scratch/session-retention/`，票 01-09 全交付后 2026-11-03 真机全链路验收过。

## API 素材（body schema 精确形状，2026-11-03 实测）

```bash
# 登录：POST /api/auth {"accessToken":"e2e-test-token-mobi"} → jar
# 建工作区：响应包在 {workspace:{...}}（裸 {id} 解析会 KeyError）
curl -b jar -X POST .../api/workspaces -d '{"name":"E2E Retention","folders":[{"path":"'$HOME'/workspace/demo","primary":true}]}'
# spawn：POST /api/sessions/spawn（不是 /api/workspaces/:id/sessions，后者 404）；
# directory 必填（缺→400 Invalid body）；响应 {type:"success",sessionId:"..."}
curl -b jar -X POST .../api/sessions/spawn -d '{"directory":"'$HOME'/workspace/demo","title":"保留期验收","permissionMode":"default","workspaceId":"<ws-id>"}'
# 发消息：POST /api/sessions/:id/messages 新格式 {"content":{"type":"text","text":"..."}}（平铺 {"message":...} 是 400）；
# assistant 回复行 role='agent'（content.role），不是 'assistant'——轮询判据用 m["content"].get("role")=="agent"
# transcript：~/.claude/projects/-Users-manerfan-workspace-demo/<nativeSessionId>.jsonl
# nativeSessionId 从消息行 metadata.nativeSessionId 拿（会话行上没有）
```

## UI 链路（Chrome DevTools MCP）

- **Radix DropdownMenu（行「更多」）必须完整指针序列**——裸 `.click()` 不触发（监听 pointerdown）：
  ```js
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY, isPrimary: true };
  btn.dispatchEvent(new PointerEvent('pointerdown', opts));
  btn.dispatchEvent(new PointerEvent('pointerup', opts));
  btn.dispatchEvent(new MouseEvent('click', opts));
  ```
  等菜单 ~700ms 后查 `[role="menuitem"]`（归档菜单项文本＝「归档」）。
- 行定位：`[data-glide-row]`，文本匹配会话显示名；more 按钮 `button[aria-label="更多"]`。
- 归档断言（一次 evaluate 拿全）：主列表行消失 + 侧栏「已归档 N」计数 + 当前详情页即时切状态页
  （「该会话已归档」「归档会话不加载消息内容」）。
- 深链接状态页：归档后 navigate 直开 `/sessions/:id` → 断言 statusPage 文案 + 消息未渲染 + 「取消归档」按钮；
  点按钮原地恢复详情（OK 回复、权限模式块回归）。
- /archived 页断言：组头=工作区名、行内「归档于 刚刚」、`button[aria-label="更多"]`→菜单「取消归档/删除」、
  页面级「全部删除 (N)」。空态=「暂无归档会话」。

## 批量删除确认门槛（组级，票 08）

组头「删除全部」按钮 hover 才可见（visibility:hidden），但裸 `.click()` 仍触发 React onClick。
antd Modal 受控 Input 必须用 native setter 绕 value tracker：

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, v);
input.dispatchEvent(new Event('input', { bubbles: true }));
```

断言序：不输入 okBtn.disabled=true → 输错值仍 true → 输入工作区名（`batchConfirmExpected` 组级=名 trim，
页面级/未分组=DELETE）→ false → 提交 → 条目消失 + 计数归零 + 通知「批量操作完成 已删除 N 项」。

## 票 06 / 07 断言（curl+fs）

```bash
# 归档会话发消息 → 409 + code=session_archived（响应体带 code 字段）
curl -b jar -X POST .../api/sessions/<sid>/messages -d '{"content":{"type":"text","text":"x"}}'   # → 409
# 删除后：transcript 真删（文件消失）+ 墓碑行 + 会话 404
[ -f ~/.claude/projects/-Users-manerfan-workspace-demo/<nativeId>.jsonl ] && echo STILL || echo DELETED
sqlite3 ~/.mobi-e2e/mobi.db "SELECT native_session_id FROM session_tombstones WHERE session_id='<sid>'"
curl -b jar .../api/sessions/<sid> -o /dev/null -w '%{http_code}'   # → 404
```

## 坑

- **归档入口在用户菜单（2026-11-03 迁移）**：PC=SidebarFooter Dropdown（设置下方），移动端=菜单 drawer
  bottomItems（navConfig.mobileNavItems，设置上方，/archived 时自动高亮）。侧栏/移动列表的常驻入口行已删。
  验菜单一句话：Radix 菜单须完整 pointer 序列；**移动端 MobileMenuItem 是 styled div 非 button**
  （`querySelectorAll('button')` 查不到，点 `span` 的 `closest('[class*="css-"]')`）；「新建会话」的
  i18n 文案是「新对话」，别拿它判 drawer 是否打开。
- **归档删了 transcript 后别再验 fork/rewind**——锚点已随 transcript 消失（墓碑只作观测）。
- 会话删除时 CLI 若还在跑，transcript 闸保留（transcriptRetainedReason 返回）；本验收用 dormant 会话
  （回复完成后 CLI 已退）走的是真删路径。
- 多选与页面级 DELETE 门槛未单独真机走（同一 Modal/batchConfirmExpected 组件，单测覆盖）——需要时照组级 recipe 换按钮即可。
