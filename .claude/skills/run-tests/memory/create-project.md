---
name: create-project
description: 项目实体化 — 建项目 / 项目内新建会话 / 归入项目往返 / 编辑 folders / 删项目 的 UI 操作
metadata:
  type: recipe
  last_verified: 2026-08-13
---

# 项目实体化 UI 操作

侧边栏分区：`Projects`（项目组）/ `Recent`（游离会话）。入口按钮多为 **hover 才显示**（CSS），CDP `click`/`hover` 工具常超时——用 `evaluate_script` 定位按钮 `.click()`（点 UI 按钮不算绕过）。

## 建项目（New Project 对话框）

1. 入口：`document.querySelector('button[title="New Project"]').click()`（Projects 标题行，hover 显示）
2. 填名称：click + `type_text`
3. folder 行：click combobox（**必须用 take_snapshot 拿 uid 再 click**，evaluate 点 `[role=combobox]` div 不聚焦内部 input，type_text 落空）→ `type_text` 全路径 → **不要按 Escape**（见坑）
4. 加第二个 folder：点 "Add folder"，新行同样 snapshot-uid click 后输入
5. 提交按钮变 enabled 后 click

## 项目内新建会话

项目组标题行 hover 出「+」（`.new-session-btn`）→ evaluate 定位 `.new-session-btn` click → 跳 `/sessions/new?cwd=<primary>&projectId=<id>`，表单已锁 cwd（disabled combobox）+ 项目 chip。发首条消息即建会话，出现在该项目组下。

## 归入项目 / 移至最近（往返）

- Recent 行的「归入项目」：`button[title="Assign to project…"]` click → 对话框选项目 radio → Confirm
- 项目组内会话行 more（`button[title="More"]`，与项目头 More 同 title，**按 DOM 序取第二个**）→ Dropdown 菜单 `Move to Recent` / `Change project…` → menuitem 用 evaluate click（a11y uid click 超时）

## 编辑 folders / 删项目

项目头 More（第一个 `title="More"`）→ 菜单 `Edit Project` / `Delete Project`。Edit 对话框中 folder 行「minus」按钮移除，Save 后重开 Edit 可验证持久化。Delete 确认弹窗文案含 `N session(s) under it will be moved to "Recent"`；确认后名下会话流入 Recent。

## 坑

- **Escape 关掉整个 modal** — New Project 对话框内按 Escape（想取消 autocompletion）会把对话框直接关闭，已填内容全丢。folder 路径输完直接进行下一步，不按 Enter 也不按 Escape
- **evaluate 点 combobox 不聚焦** — 见上；PathCascader 的 [[create-session]] recipe 用的是 a11y uid click，同样适用
- **hover 条件渲染按钮 CDP 工具点不到** — 项目组「+」、行内 more、Assign 按钮都是 hover 显示；dispatch 合成 mouseover 不触发 CSS :hover，直接 evaluate `.click()` 即可
- **menuitem 用 a11y uid click 超时** — antd Dropdown 弹出菜单项需 evaluate `[role="menuitem"]` 文本匹配后 `.click()`
