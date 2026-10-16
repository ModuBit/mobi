---
last_verified: 2026-10-16
---

# Agent sidechain drawer 验证

验 #62 缺陷二（drawer 冻结）一类任务的操作 recipe。

## 入口（两种状态不同）

- **运行中**：ComposerInfoPanel 的 TasksPanel 里出现运行中 AgentCard → `[data-testid^="agent-card-"]`，click 即开 drawer
- **已完成**：聊天流里 Agent 卡片（`.tool-call-think`）行内「View details →」链接（文本精确匹配，含箭头）。⚠️ 点卡片 header（`.ant-think-status-wrapper`）只展开行内最终报告，**不开 drawer**

## 实时增长采样

```js
// drawer 打开后按间隔采气泡数，增长即实时链路通
document.querySelectorAll('.ant-drawer-open .drawer-chat-bubbles .ant-bubble').length
```

- 采样要**每次重新查询** `.ant-drawer-open`（React 重渲染可能换节点）
- 派发子代理任务建议要求「每读一个文件先报告一行」，拉长可观测窗口；只读三文件的任务 ~25s 就跑完，容易错过
- 历史恢复验证：轮次结束后重开 drawer，气泡应从 API 历史路径恢复（数量 ≈ DB sidechain 行归一后的 block 数）

## 后台任务 runtime_state 断言（U-4 / #62 缺陷一）

```bash
# running 中 DB 必须非空（旧 bug 是内存链有值 DB 为 null）
sqlite3 ~/.mobi-e2e/mobi.db "SELECT json_extract(runtime_state,'$.backgroundTasks') FROM sessions WHERE id='...';"
```

页面 reload 后任务面板应从 DB 恢复显示任务描述文本。

## composer 发消息补充

自定义 textarea 用 React setter + `input` 事件（见 input-box.md）；`fill` 工具会写 value 但不触发 React 状态，发送键仍 disabled。

## 后台任务卡停止钮验证（ConfirmMorph，2026-10-16 起）

- **桌面分支**：uiarc ConfirmMorph 在卡片行内——选择器 `[data-face][data-mode]`（face=idle/confirming/pending/done/error）；触发钮一击进 confirming（真实 i18n 环境下确认问题文案「确定停止该后台任务？」），3s confirmTimeout 自动复位
- **ConfirmMorph 必须用 CDP click（uid 点击）**：evaluate 里 `el.click()` / 合成 PointerEvent 序列都不翻 face（真实输入事件才触发）；点击后立刻截 confirming，3s 后自动回 idle
- **移动端分支**：ConfirmMorph 不渲染；sheet 入口是 `[data-testid^="bg-task-card"]` 内 `style.width === '22px'` 的 div，点击开 antd Drawer（「停止」按钮）
- **移动端会话操作菜单**（批 D 验收用）：菜单抽屉里会话行 `⋮` 按钮 `aria-label="更多"`（不是「更多操作」——那是别处的），点开 BottomSheet（重命名/置顶/换工作区/移至最近/休眠/删除）
- **触发素材**：发消息点名 Bash + `run_in_background=true` 执行 `sleep 900`（sleep 短于 turn 时长会错过卡片）；确认「真停止」会销毁卡片，验证形态时不要点确认
- **jsdom 与真机 i18n 差异**：组件测试走 i18nKeyStub（断言 key），BackgroundTaskCard.test 走真实 i18n——选择器别写 key 文本，用 `button[aria-label]` 宽选择器
