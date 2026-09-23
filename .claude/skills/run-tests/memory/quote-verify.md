---
name: quote-verify
description: 引用特性 E2E 验证——划选 popover / 评论浮层 / chip 列表卡 / 气泡引用组 / 点击定位 / 边界拒绝的 recipe 与合成事件坑
metadata:
  type: recipe
  last_verified: 2026-09-23
---

# 引用特性验证

## 链路 recipe（PC，全部可 CDP 自主完成）

1. **划选**：`evaluate_script` 内 Range 选区（`data-quote-block` 锚内找 Text 节点起止）+ 对 `.chat-scroll-container` dispatch `mouseup({bubbles:true})` → `[data-quote-layer="popover"]` 出现「添加到对话」。注意 popover 挂载是异步的——**同一次 evaluate 里造选区后立刻查 DOM 会查空**，分开两次调用（或 Promise+setTimeout）再断言
2. **添加到对话**：popover 内找文本 `添加到对话` 的叶子 span，mousedown/mouseup/click 三连 → `[data-quote-layer="comment"]` 出现，textarea 自动聚焦 → `type_text + Enter` 保存；空评论直接点「保 存」按钮
3. **chip**：`[data-testid="quote-chip"]` 文案 `N 条引用`；click 打开 `[data-testid="quote-list"]`（编号+excerpt+评论），胶囊旁 `[data-testid="quote-clear-all"]` × 清空全部；点条目 excerpt 定位源消息；Escape 关闭
4. **发送后**：气泡内引用**收起为 chip**（2026-09-23 起，图片/附件/引用统一挪到 bubble header）：`[data-testid="user-quote-chip"]` → click 开 `[data-testid="user-quote-list"]` → 点 `user-quote-item-N` 定位源消息；落库断言 `sqlite3 ~/.mobi-e2e/mobi.db`：user 消息 `$.role='user'`，`content[0].type='quote'` 含 messageId/role/excerpt/comment
5. **模型收到引用的硬证据**：下一条 assistant 消息的 `thinking` 会复述引用与评论内容（XML prompt 被 SDK 正常解析；落库的是结构化 blocks，XML 原文不落库）
6. **点击定位**：引用条目 `.click()` → 源消息 `[data-quote-message-id]` 锚 → `.quote-locate-flash` 挂上（1200ms 后摘除，**断言要在点击后 1.2s 内**）；源消息在视口顶时 scrollTop 保持 0 是正常的

## 边界拒绝（同为 happy path 一部分）

- 跨 `[data-quote-block]` 锚选区 → popover 不弹
- 引用组禁区：`getComputedStyle(group).userSelect === 'none'`，Range 造选区得空文本，popover 不弹

## 移动端视口验证（2026-09-23）

- **`resize_page` 有窗口最小宽限制（390 请求 → innerWidth 500）**，测移动端溢出必须用 `emulate` 的 viewport（`390x844x3,mobile,touch`）；innerWidth 会读到 414 左右属正常
- **emulate 切视口会整页重渲染丢 composer 引用状态**——先切视口再走划选→添加流程
- 列表卡宽度断言：`document.querySelector('[data-testid="quote-list"]')` 的 `getComputedStyle().width` 应等于 `min(420, 100vw-32)`（390 视口 ≈358px），popper（`.ant-popover`）`right ≤ innerWidth`
- 产物验证注意：emotion 是**运行时注入**，样式在 JS chunk（SessionDetailPage-*.js）不在 CSS 文件——grep 产物 CSS 验证样式会假阴性

## 坑

- **antd Tooltip 的 hover 合成事件不触发**（rc-trigger 过滤）——tooltip 验证必须用 CDP `hover` 工具（真实鼠标事件）对 snapshot uid，约 0.9s 后查 `.ant-tooltip:not(.ant-tooltip-hidden)`
- **>500 字符 tooLong 拒绝**：普通问答回复单块仅 ~300 字符，跨块又被拒——UI 内难自然构造，留单测覆盖即可
- quote E2E 用的模型下拉显示 glm-5.2 但 turn 实际 claude-sonnet-4-6（模型下拉与 turn 无关，别被迷惑）
- **远程验收环境必踩：裸 `crypto.randomUUID` 在 http+IP 访问（非安全上下文）不存在**——新建 uid 时抛错、流程静默中断，localhost 测不出；新代码一律走 `core/lib/uuid.ts` 的 `uuid()`（getRandomValues 兜底），见引用特性首条添加中断事故（2026-09-22）
- 评论键位（2026-09-22 定稿）：Enter 换行、Ctrl/Cmd+Enter 提交、Esc/点外关闭——「Enter 提交」让多行无法输入，用户验收否决过
- **running 时 popover 不闪**（2026-09-23 修）：流式 stick-to-bottom 程序滚动不再关引用浮层，关闭只认 wheel/touchmove 手势后 250ms 内的 scroll——CDP 自测时别用程序 scrollTo 复现「滚动关浮层」，要先 dispatch wheel 事件

## 回应批注（response annotations，2026-09-23 全链路验证）

前置：协议在 CLI（含 agent 引用时注入 `<system-reminder>` + `:mobi-quote{index="N"}` directive），
**bootstrap 重启后新会话才带新协议代码**（会话 CLI 启动即固化代码）。

链路：划选 agent 回复 → 添加到对话 → 评论 → 发「请围绕引用深入讲解」类探针 → 回复中断言：

1. `[data-testid="quote-annotation-1"]`「注释 1」上标按钮渲染；正文无 `:mobi-quote` 原文残留
2. `[data-testid="agent-annotation-chip"]`「N 条注释」聚合 chip 在 agent 气泡 header
3. tooltip 必须 CDP hover（合成事件不触发，同引用 tooltip 坑）~1.2s 后查 `.ant-tooltip:not(.ant-tooltip-hidden)`，内容 = excerpt + 评论
4. 点击按钮 → `.quote-locate-flash` 挂上（1.2s 内断言）
5. chip 点击 → `[data-testid="agent-annotation-list"]` 列表卡，条目 = 编号+excerpt+评论
6. DB 断言 offsets：`messages` user 消息 `content[0].startOffset/endOffset`（json_extract 数组路径写 `'$[0].x'`，bash 双引号下 `$[0]` 会被算术展开——用 heredoc 或单引号 SQL）
7. 移动端 390：chip 列表卡 popper `left=16, right=innerWidth-16, width=100vw-32`（quote-list-popover 全局钳制复用）

探针 prompt 要求「直接回答不要用工具」，否则首轮会触发 Change Title 等工具流干扰选区。
