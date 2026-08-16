---
name: web-tools-verify
description: Web 工具（WebSearch/WebFetch alias 到 mobi-web MCP）配置页 + 工具替换链路 E2E 验证
metadata:
  type: recipe
  last_verified: 2026-08-16
---

# Web 工具 E2E 验证（toolAliases → mcp__mobi-web）

配置链路：Web 设置页卡片（`/settings`）→ hub `GET/POST /api/machines/:id/web-tools` →
runner RPC → 落盘 **`~/.mobi-e2e/settings.json` 的 `webTools` 段**（与 hub 自身 settings 同文件）。
运行链路：SDK `toolAliases` 把内置 WebSearch/WebFetch 重定向到 in-process MCP `mcp__mobi-web__web_search/web_fetch`。

## E2E-1 配置页链路

1. `/settings` 滚到 "Web Tools" 卡片。无 provider 时 alert 显示
   "Not configured — model web tool calls will return a not-configured notice"
2. 启用 Tavily switch → click API Key 输入框（`textbox "Enter API Key"`）→ Ctrl+A → type key
3. Search/Fetch Provider 两个 combobox 各自 click → listbox 选 "Tavily" → Save → toast "Saved"
4. 落盘断言（`~/.mobi-e2e/settings.json`）：
   `webTools = { searchProviderId:'tavily', fetchProviderId:'tavily', providers:[{id:'tavily',enabled:true,credentials:{apiKey},timeoutMs:15000}, {id:'bocha',enabled:false,credentials:{},timeoutMs:15000}] }`
   （bocha disabled 空凭据条目是默认行为，不算偏差）
5. 刷新 `/settings`：凭据回显 "Set (leave blank to keep)"、输入框 placeholder 变
   "Leave blank to keep current value"；**不改动直接 Save** → apiKey 不变（merge 语义 E2E 锁定）

## E2E-2 工具替换链路（fake key → 401）

1. 建项目发消息："用 WebSearch 工具搜索一下今天杭州天气"
2. WebSearch 触发权限弹窗（卡片显示内置名 "Web Search"）→ Allow
3. 断言三处证据：
   - 工具分组标题 `Thought 0.3s, search the web 1 time · 1 failed`
   - 展开工具卡片（click 卡片标题）后 tool_result 原文：
     `tavily HTTP 401 Unauthorized（凭据可能失效，请到 mobi 设置页更新 provider 配置）`
   - 模型转述可见 alias 后真实工具名：`(MCP) mobi-web:web_search`

## 坑（2026-08-16 实测）

- **alias 不隐藏原始 MCP 工具** — 模型看到工具列表里同时有内置名（alias 映射）和
  `mcp__mobi-web__web_search`，WebSearch 401 后模型会**直调 MCP 工具重试**（同样 401），
  再转 WebFetch 抓站。验证 401 文案第一次失败即可收敛，后续审批可 Deny 结束回合
- **直调 MCP 工具的卡片标题显示原始名**（如 `Web Fetch mcp__mobi-web__web_fetch: <url>`），
  alias 调用显示内置名（"Web Search"）——两种都正常
- 工具卡片 body 展开后 a11y tree 可能不列全文，用 TreeWalker evaluate 抓文本（见 [[pitfalls-general]]）
- 首轮还会有 Change Title 审批弹窗，Allow 即可
