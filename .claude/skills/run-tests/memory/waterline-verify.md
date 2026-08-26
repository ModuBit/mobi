---
name: waterline-verify
description: 上下文水位/usage E2E 验证——发消息→DB 断言 assistant usage 与 contextUsage→圆环 aria-label 双端断言
metadata:
  type: recipe
  last_verified: 2026-08-26
---

# 上下文水位验证（usage 注入 / contextUsage / ContextRing / ⚡命中率）

验证链路：stream_event 捕获注入 → assistant 消息 usage 落库 → launcher 实时上报 → runtimeState.contextUsage → web 圆环 + turn 概要。

## 步骤

1. 按 [[env-bootstrap]] 起环境、[[login]] 登录、建项目发消息（demo 目录）。prompt 让模型跑 1-2 个读类工具（如 `ls` + `Read`），产生多条 assistant；Change Title 常率先弹审批，点「Allow this session」减少后续弹窗
2. **turn 概要**：turn 结束 take_snapshot，断言 `N tokens · ⚡N%`（⚡只在有 cache 数据时出现）；详情行含 Total Input (incl. cache) / Cache Hit
3. **DB 断言**（e2e 库 `~/.mobi-e2e/mobi.db`）：
   ```bash
   sqlite3 ~/.mobi-e2e/mobi.db "
   SELECT json_extract(content,'$.content.data.message.usage.input_tokens'),
     coalesce(json_extract(content,'$.content.data.message.usage.cache_read_input_tokens'),0),
     json_extract(content,'$.content.data.message.usage.output_tokens')
   FROM messages WHERE session_id='<sid>'
     AND json_extract(content,'$.content.data.message.usage') IS NOT NULL ORDER BY position_at;"
   ```
   断言：in/cc/cr 非零、逐条单调递增；`sessions.runtime_state` 的 `contextUsage.totalTokens` = **最后一条主线 assistant 四项和**（in+cc+cr+out，瞬时水位），**绝不等于** result 累计（概要里更大的那个数）
4. **圆环双端断言**（evaluate_script，比 snapshot 可靠）：
   ```js
   () => Array.from(document.querySelectorAll('svg[role="button"]'))
     .map(r => ({ ariaLabel: r.getAttribute('aria-label'), w: r.getAttribute('width'), y: Math.round(r.getBoundingClientRect().y) }))
   ```
   - PC：圆环 y 在页面底部（composer 工具栏，w=20）
   - `resize_page 390x844`（实际窗口最小宽可能 500，useIsMobile 仍生效）：圆环唯一且 y≈13（ChatPane header，w=22）

## 坑

- 圆环 aria-label 是 `N%`——`svg[role="button"]` 是其稳定选择器；a11y snapshot 里显示为 button "N%"
- e2e 走网关渠道（模型选择器 glm-5.2）时 result.modelUsage 的 key 仍是 CLI 请求名（claude-sonnet-4-6），窗口大小取自该模型（200k），非网关上游
- 两把尺子：turn 概要 tokens = result 累计（流量）；圆环 % = contextUsage/maxTokens（水位）。断言时别混
