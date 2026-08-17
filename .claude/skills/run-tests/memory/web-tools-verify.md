---
name: web-tools-verify
description: Web 工具（WebSearch/WebFetch alias 到 mobi-web MCP）设置子页 + 工具替换链路 E2E 验证
metadata:
  type: recipe
  last_verified: 2026-08-17
---

# Web 工具 E2E 验证（toolAliases → mcp__mobi-web）

配置链路：`/settings` 分组入口（mobile）/ 左侧分区导航（PC ≥992px）→ `/settings/web-tools` 子页
→ hub `GET/POST /api/machines/:id/web-tools`（+ `POST .../web-tools/verify`）→ runner RPC → 落盘
**`~/.mobi-e2e/settings.json` 的 `webTools` 段**。运行链路：SDK `toolAliases` 重定向 WebSearch/WebFetch 到 in-process MCP。

## E2E-1 配置子页链路（2026-08-17 review 修复后 UI）

子页结构：用途路由卡（web_search/web_fetch 两个 Select 即时保存，**allowClear 可清除**）+ Providers 区（每 provider 卡：外置开关 + 点卡头展开内联凭据编辑器，展开有 grid-rows 过渡动画）。

1. mobile 视口（390x844）`/settings`：入口卡列表；Web 工具入口副标题位状态徽标（**以路由为准**：有 search/fetch 路由=绿点已启用，仅开关打开=未配置，机器离线=灰）；PC 视口（≥992）`/settings` 直接渲染默认通知分区 + 左侧 200px 分区导航（active 高亮 + Tavily 徽标外显，compact 态只在 enabled 显示绿点）
2. 无 provider 时路由卡为引导态（**无 combobox**，DOM 断言 `document.querySelectorAll('[role="combobox"]').length === 0`）
3. 开 provider 开关 → 即时保存 → 路由卡出现两行 Select；**保存后编辑器不收起、草稿不丢**（react-query invalidate 重读，子树不卸载）；返回 `/settings` 徽标即时刷新（同一 queryKey）
4. 点 provider 卡头（a11y tree 中是 `button "Tavily" expandable`）展开编辑器；未设凭据时直接编辑态，**空草稿下 Save disabled、Verify 也 disabled（无已存凭据可验）**；已存凭据时预览态有「验证连接」按钮（空草稿也可用——runner 用已存 key）
5. 输入 key → Verify（fake key 走真实 tavily → 401 → auth 文案「tavily Unauthorized: missing or invalid API key.」内联回显）→ Save → 回**只读预览态**显示掩码串（如 `tvly-******56`）+「Replace」「验证连接」按钮
6. 路由 Select：**任何行不锁定**（含单 provider 有值），allowClear 图标可清除路由（清除=teardown 第一步，之后才能禁用被引用的 provider）——旧「有值锁定」语义已废弃
7. 禁用被路由引用的 provider → 前端拦截（warning toast + 开关不动 + 不落盘）；**先清路由再禁用则成功**
8. 落盘断言：`webTools.providers[0].credentials.apiKey` 明文、enabled、`searchProviderId/fetchProviderId`；**无 preview/掩码串落盘**；清除路由后对应字段从 settings.json 消失
9. 保存失败（runner 校验拒）→ toast 显示 runner 具体原因（如 `provider "tavily" 缺少凭据：apiKey`），非通用「保存失败」

## E2E-2 工具替换链路（fake key → 401）

1. 建项目发消息："用 WebSearch 工具搜索一下今天杭州天气"
2. WebSearch 触发权限弹窗（卡片显示内置名 "Web Search"）→ Allow
3. 断言三处证据：
   - 工具分组标题 `Thought 0.3s, search the web 1 time · 1 failed`
   - 展开工具卡片后 tool_result 原文：`tavily HTTP 401 Unauthorized（凭据可能失效，请到 mobi 设置页更新 provider 配置）`
   - 模型转述可见 alias 后真实工具名：`(MCP) mobi-web:web_search`

## 坑（2026-08-16/17 实测）

- **alias 不隐藏原始 MCP 工具** — 模型看到工具列表里同时有内置名（alias 映射）和
  `mcp__mobi-web__web_search`，WebSearch 401 后模型会**直调 MCP 工具重试**（同样 401），
  再转 WebFetch 抓站。验证 401 文案第一次失败即可收敛，后续审批可 Deny 结束回合
- **直调 MCP 工具的卡片标题显示原始名**（如 `Web Fetch mcp__mobi-web__web_fetch: <url>`），
  alias 调用显示内置名（"Web Search"）——两种都正常
- **截图与 a11y tree 可能不一致**（视觉帧 vs 当前 DOM）——以 `evaluate_script` 查 DOM 为权威
  （引导态断言 combobox 数量曾因此误判）
- **E2E 环境浏览器 profile 残留 debug 解锁态**（localStorage 跨 cleanup 存活）→ 设置入口列表
  出现 Debug 入口属预期，不是回归
- 工具卡片 body 展开后 a11y tree 可能不列全文，用 TreeWalker evaluate 抓文本（见 [[pitfalls-general]]）
- 首轮还会有 Change Title 审批弹窗，Allow 即可
