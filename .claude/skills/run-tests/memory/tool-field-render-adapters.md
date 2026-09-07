---
name: tool-field-render-adapters
description: 新增 tool 字段（block.tool.xxx）时必须适配的三处渲染链路 + structuredPatch diff 渲染验证 recipe
metadata:
  type: recipe
  last_verified: 2026-09-07
---

# 新增 tool 字段的渲染适配点（易漏）

tool-result 新字段从 `normalizeAgent`（读 `tool_use_result`）→ `reducerTimeline`（挂 `block.tool`）之后，**手动枚举 tool 字段的适配点有 3 处，漏一处就某些视图丢字段**：

1. `domain/tool/types.ts` `ToolInfo` — 类型声明（没有则 TS 拦住后两处）
2. `chat/blocks/ToolCallBlock.tsx` `ToolCallPreviewContent.adaptedBlock` — 聊天主列表（父 + child 两处 tool 字面量）
3. `tool-card/ToolDetailDrawer.tsx` `chatBlockToToolCardBlock` — 详情 Drawer

排查法：全局搜 `createdAt: tool.createdAt` / `createdAt: child.tool.createdAt` 等枚举点。
视图层（EditView/EditResultView/WriteResultView/MultiEditView）各自消费，展开卡片走
`getToolViewComponent`（EditView）**不是** EditResultView——只接 result 视图会漏掉展开态。

# structuredPatch diff 行号验证 recipe（2026-09-07 已验证）

- CC 的 `tool_use_result.structuredPatch[].lines` 格式：unified 前缀（' '/'-'/'+'）+ 原行内容，**前缀后无分隔空格**（对照真实文件实证）；oldStart/newStart 即文件真实行号；Edit/MultiEdit/Write 三工具都有
- E2E 步骤：`seq -f "line %g: ..." 1 40 > ~/workspace/demo/lineno-fixture.txt` 造中段编辑目标 → 发消息让 Claude Edit 第 20 行 → 完成后点工具组 header 展开 → 点 Edit 卡片 → `evaluate_script` 抓 `div[style*="display: table"]` 行（两 cell：行号/内容）
- 断言：removed 行显示 old 行号、added/context 行显示 new 行号，且等于文件真实行号
- 渲染纯函数在 `web/src/components/tool-card/views/structuredPatchUtils.ts`，自 diff 回退逻辑保留在 DiffView（执行中预览无 patch 时用）
