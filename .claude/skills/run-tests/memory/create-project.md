---
name: create-project
description: 工作区（原「项目」，2026-09-28 更名）— 建工作区 / 工作区内新建会话 / 归入工作区往返 / 编辑 folders / 删工作区 的 UI 操作
metadata:
  type: recipe
  last_verified: 2026-09-28
---

# 工作区 UI 操作（2026-09-28「项目」→「工作区」全量更名后验证）

侧边栏分区（2026-08-14 起可折叠、空分区默认收起）：`工作区`（工作区分组）/ `最近`（游离会话）。
入口按钮多为 **hover 才显示**（CSS），CDP `click`/`hover` 工具常超时——用 `evaluate_script`
定位按钮 `.click()`（点 UI 按钮不算绕过）。

## 建工作区（新建工作区对话框）—— 两处入口

1. 侧边栏「工作区」分区标题行 `button[title="新建工作区"]`（hover 显示，evaluate click）
2. **新建会话页工作区下拉底部「+ 新建工作区」**（2026-08-14 起，`popupRender` footer）——
   创建完成后自动回填选中，机器/目录随工作区派生，直接发消息即可

对话框操作（两处入口相同，PC Modal / 移动端底部 Drawer）：

1. 填名称：click + `type_text`
2. folder 行：click combobox（**必须用 take_snapshot 拿 uid 再 click**，evaluate 点 `[role=combobox]` div 不聚焦内部 input，type_text 落空）→ `type_text` 全路径 → **不要按 Escape**（见坑）
3. 加第二个 folder：点 "Add folder"，新行同样 snapshot-uid click 后输入
4. 提交按钮变 enabled 后 click

注意：**环境只有一台机器时 Machine 选择器整行省略**（自动选中，2026-08-19 实测），不必找机器下拉。

## 工作区内新建会话

工作区组标题行 hover 出「+」（`.new-session-btn`）→ evaluate 定位 click → 跳
`/sessions/new?workspaceId=<id>`（**只带 workspaceId**，cwd 参数已移除）：工作区自动选中 +
派生回显（机器 · ~/主目录），Sender 即刻可用。发首条消息即建会话，出现在该工作区分组下
（2026-09-28 更名 E2E 实测：DB sessions.workspace_id 正确绑定）。

## 归入工作区 / 移至最近（往返）

- 「最近」行的「归入工作区」：`button[title="归入工作区…"]` click → 对话框选工作区 radio → Confirm
- 工作区组内会话行 more（`button[title="More"]`，与工作区头 More 同 title，**按 DOM 序取第二个**）→ Dropdown 菜单 `移至最近` / `换工作区…` → menuitem 用 evaluate click（a11y uid click 超时）

## 编辑 folders / 删工作区

工作区头 More（第一个 `title="More"`）→ 菜单 `编辑工作区` / `删除工作区`。Edit 对话框中 folder 行「minus」按钮移除，保存后重开 Edit 可验证持久化。Delete 确认弹窗文案含「名下 N 个会话将移至「最近」」；确认后名下会话流入「最近」。

## 坑

- **播种数据必须带 `metadata.machineId`（2026-08-25 踩过）** — 用 store 脚本造会话时 metadata 缺 machineId，「归入工作区」弹窗按会话机器过滤工作区，会显示「该机器暂无工作区」。播种 metadata 里加 `machineId: 'm-e2e'`（与工作区 machineId 一致）即可；改完须刷新页面（弹窗读的是 Web 缓存里的 session）
- **Escape 关掉整个 modal** — 新建工作区对话框内按 Escape（想取消 autocompletion）会把对话框直接关闭，已填内容全丢。folder 路径输完直接进行下一步，不按 Enter 也不按 Escape
- **folder 路径必须在机器主目录内**（hub 校验）— `/tmp/xxx` 会被拒（"Folder path must be within the machine home directory (/Users/…)"），用 `~/workspace/demo` 等 home 下路径
- **folder combobox 输错无法全选重输** — Ctrl+A / Meta+A 在该 combobox 都不生效（Ctrl+A 跳行首，输入变追加），Remove 按钮单行时 disabled；输错了直接 Escape 关 modal 重开重填最快
- **evaluate 点 combobox 不聚焦** — 见上；用 a11y uid click
- **fill_form 灌 folder combobox 会崩整页（2026-08-17 踩坑）** — `fill_form` 对 New Project 对话框的 FolderRow AutoComplete 程序化赋值触发 "Maximum update depth exceeded"（Select 组件 setState 循环），整个 app 崩到 error boundary。恢复：重新 navigate 到 /sessions/new 重填。folder 输入**必须** click（snapshot uid）+ `type_text`，禁 `fill`/`fill_form`
- **hover 条件渲染按钮 CDP 工具点不到** — 工作区组「+」、行内 more、Assign 按钮都是 hover 显示；dispatch 合成 mouseover 不触发 CSS :hover，直接 evaluate `.click()` 即可
- **menuitem 用 a11y uid click 超时** — antd Dropdown 弹出菜单项需 evaluate `[role="menuitem"]` 文本匹配后 `.click()`

## 会话置顶 / 取消置顶（2026-08-14）

- 桌面：会话行 hover 操作中的 pin 按钮，`button[title="Pin"]` / `[title="Unpin"]`（hover 条件渲染，evaluate `.click()`）
- 移动端：长按会话行 → ActionSheet「置顶 / 取消置顶」
- 验证点：置顶 → 「置顶」分区（SidebarWorkspaces/MobilePinnedGroup）出现该会话且自动展开，原分组（工作区/最近）即时过滤掉；取消 → 回原分组。SSE 驱动（session-updated 全载荷 → workspaceViews 三键连带失效），无需刷新
