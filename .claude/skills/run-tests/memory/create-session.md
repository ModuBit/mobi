---
name: create-session
description: 创建会话 — 新建 / 选机器 / 工作目录
metadata:
  type: recipe
  last_verified: 2026-08-01
---

# 创建会话

## 步骤

1. 点击「新建会话」
2. 选择机器（机器下拉 / 已默认选中）
3. 输入工作目录（**PathCascader 可直接输全路径，见下**）
4. 消息框发首条消息即创建会话（无独立「创建」按钮）

## 工作目录 PathCascader — 直接输入全路径（首选）

工作目录选择器是 PathCascader（级联 + 搜索），**支持直接输入完整路径，不必逐级展开**：

1. `click` combobox 聚焦（展开下拉）
2. `type_text` 输入全路径（如 `/Users/manerfan/workspace/demo`）—— PathCascader 进入匹配模式
3. **`press_key Escape` 确认**（取消 autocompletion suggestion，保留输入值本身）

⚠️ **不要按 Enter 确认** —— Enter 会选中 autocompletion suggestion（如 demo 下第一个子目录 `app`），路径被补成 `/demo/app/`。Escape 取消 suggestion，保留你输入的值。

校验：消息输入框从 disabled 变 enabled = 路径有效。

### 坑

- **逐级展开笨拙** —— 可点根节点逐级 Down/Enter 展开到目标，但层级多时低效，**优先直接输全路径**
- **type 不进 `[role=combobox"]` querySelector('input')** —— PathCascader 的真实 input 不在 combobox role 元素下，但 `click` combobox + `type_text` 能正常输入（Cascader 内部 input 接管键盘）
- **路径必须在 home 目录下** —— Hub 安全限制，`/tmp` 等非 home 路径被拒；`/Users/<user>/...` 可用
- 输入操作通用规范见 [[input-box]]
