---
name: output-style-verify
description: output style 特性验证——DB 观测点、init 时序偏差坑、切换链路断言
metadata:
  type: recipe
  last_verified: 2026-09-03
---

# output style 验证

## DB 观测点（e2e 库 sessions 行）

```bash
sqlite3 -readonly ~/.mobi-e2e/mobi.db "SELECT \
  json_extract(metadata,'\$.sdkMetadata.outputStyle'), \
  json_extract(metadata,'\$.sdkMetadata.availableOutputStyles'), \
  json_extract(runtime_state,'\$.outputStyle') FROM sessions ORDER BY seq DESC LIMIT 2"
```

- `runtime_state.outputStyle`：**当前生效值的权威来源**。链路：CLI session.outputStyle → keep-alive（≤2s）→ hub 落库。切换 / resume 回放都看它
- `metadata.sdkMetadata.availableOutputStyles`：init 上报的可选列表（含自定义 style 名），**大小写基准**：`default` 小写 + 四个驼峰（Proactive/Concise/Explanatory/Learning），与 shared OUTPUT_STYLES 常量一致
- `metadata.sdkMetadata.outputStyle`：**init 时快照，会系统性滞后**——init 发生在 applyFlagSettings 之前，新建/切换重启后都报 settings 层值（如 `default`）而非生效值。web 切换器当前值必须 runtimeState 优先（ChatContainer 已如此），别用 sdkMetadata 判生效值

## 切换链路断言

web 确认切换 → `runtime_state.outputStyle` 变化 + `metadata.nativeSessionId` 换新（/clear 语义）。
风格生效软验证：Concise 下发代码任务，回复应「结果前置、无铺垫」（对照 Learning 的 TODO(human)/请求写码特征）。

## 坑

- **init 先于 flag apply**：applyStartupOutputStyle 在 query attach 后调，initializationResult 已返回——任何依赖 init 的 style 值都是旧值
- 新建页输出下拉在 a11y 树是空 listbox，选项文本要用 `.ant-select-dropdown .ant-select-item-option` 的 textContent 取；点选要 mousedown/mouseup/click 三连
- 每会话首个 prompt 弹 Change Title 审批（glm 网关），「Allow this session」一次免除
