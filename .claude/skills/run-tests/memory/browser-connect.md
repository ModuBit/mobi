---
name: browser-connect
description: Chrome DevTools MCP 连接 / 复用 / 僵尸进程清理
metadata:
  type: recipe
  last_verified: 2026-07-29
---

# 浏览器连接

Chrome DevTools MCP 首次调用自动启动 Chrome，后续复用。

## 步骤（按序尝试）

1. `new_page` 打开目标 URL — 多数直接成功
2. 报 "browser already running"（上个会话 Chrome 还在）→ `list_pages` 能连上就复用：`close_page` 关多余页，或 `navigate_page` 导航到目标 URL
3. `list_pages` 也连不上（进程僵死）→ 清理后重试 `new_page`：
   ```bash
   pkill -f 'chrome-devtools-mcp/chrome-profile'
   ```

## 坑

- **`navigate_page reload` 偶发丢 page** — 改用 `new_page` 重新打开 URL，或 `list_pages` 确认后 `select_page`
