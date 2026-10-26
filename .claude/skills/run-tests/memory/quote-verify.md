---
name: quote-verify
description: 引用特性 E2E 验证——划选 popover / 评论浮层 / chip 列表卡 / 气泡引用组 / 点击定位 / 出向标注 / 降级矩阵的 recipe 与合成事件坑
metadata:
  type: recipe
  last_verified: 2026-10-26
---

# 引用特性验证

## 链路 recipe（PC，全部可 CDP 自主完成）

1. **划选**：`evaluate_script` 内 Range 选区（`data-quote-block` 锚内找 Text 节点起止）+ 对 `.chat-scroll-container` dispatch `mouseup({bubbles:true})` → `[data-quote-layer="popover"]` 出现「添加到对话」。注意 popover 挂载是异步的——**同一次 evaluate 里造选区后立刻查 DOM 会查空**，分开两次调用（或 Promise+setTimeout）再断言
2. **添加到对话**：popover 内找文本 `添加到对话` 的叶子 span，mousedown/mouseup/click 三连 → `[data-quote-layer="comment"]` 出现，textarea 自动聚焦 → `type_text + Enter` 保存；空评论直接点「保 存」按钮
3. **chip**：`[data-testid="quote-chip"]` 文案 `N 条引用`；click 打开 `[data-testid="quote-list"]`（编号+excerpt+评论），胶囊旁 `[data-testid="quote-clear-all"]` × 清空全部；点条目 excerpt 定位源消息；Escape 关闭
4. **发送后**：气泡内引用**收起为 chip**（2026-09-23 起，图片/附件/引用统一挪到 bubble header）：`[data-testid="user-quote-chip"]` → click 开 `[data-testid="user-quote-list"]` → 点 `user-quote-item-N` 定位源消息；落库断言 `sqlite3 ~/.mobi-e2e/mobi.db`：user 消息 `$.role='user'`，`content[0].type='quote'` 含 messageId/role/excerpt/comment
5. **模型收到引用的硬证据**：下一条 assistant 消息的 `thinking` 会复述引用与评论内容（XML prompt 被 SDK 正常解析；落库的是结构化 blocks，XML 原文不落库）
6. **点击定位**：引用条目 `.click()` → 源消息 `[data-quote-message-id]` 锚 → 带 offsets 时走片段高亮（`CSS.highlights` 注册 `quote-fragment-flash`，**2400ms 后摘除，断言与截图都要在窗口内**；2026-09-28 前为 1200ms 整段闪烁）；无 offsets / 解析失败兜底整段 `.quote-locate-flash`；源消息在视口顶时 scrollTop 保持 0 是正常的

## 片段高亮（2026-09-28 全链路验证）

1. **注册断言**：点击引用条目后查 `CSS.highlights`（Map-like，`forEach((v,k))` 遍历）含 `quote-fragment-flash`，高亮 Range 文本应等于落库 excerpt——**Chrome 155 起 `Highlight.ranges` 已移除**（Set-like：`size`/`forEach`/`values`），`[...v.ranges]` 会抛 `v.ranges is not iterable` 且中断探针链路（2026-10-26 实踩）；遍历用 `v.forEach(r => ...)`
2. **视觉断言**：片段 Range 有矩形（`range.getBoundingClientRect()`）且 ::highlight 底色渲染——**截图必须在高亮窗口（2400ms）内**；错过窗口会误判「高亮不可见」（实踩：连拍三次以为 color-mix 不支持，实际是摘除后才截）
3. **`::highlight` 支持 `color-mix()`**（Chrome 153 实测渲染正常），dark 主题下用 `color-mix(colorWarning 35%, transparent)` 可见；antd `colorWarningBg` dark 档 rgb(58,28,8) 黑底不可辨，别用
4. **CSS.highlights 不是 Map 实例**（Chrome 153 `instanceof Map` = false）——特性检测按 duck typing（`typeof registry.set === 'function'`），jsdom 无此 API
5. **vite HMR 不传播 core/lib 纯 TS 模块**：改 quoteLocate.ts 后页面可能继续跑旧模块（excerpt 校验/matches 修复缺失）——必须整页 reload 再验
6. **调试注入的 test 规则/highlight 用完即删**：残留的 test 注册会污染后续断言（实踩：残留 highlight 让人误判定时摘除失效）

## 边界拒绝（同为 happy path 一部分）

- 跨 `[data-quote-block]` 锚选区 → popover 不弹
- 引用组禁区：`getComputedStyle(group).userSelect === 'none'`，Range 造选区得空文本，popover 不弹

## 移动端视口验证（2026-09-23）

- **`resize_page` 有窗口最小宽限制（390 请求 → innerWidth 500）**，测移动端溢出必须用 `emulate` 的 viewport（`390x844x3,mobile,touch`）；innerWidth 会读到 414 左右属正常
- **emulate 切视口会整页重渲染丢 composer 引用状态**——先切视口再走划选→添加流程
- 列表卡宽度断言：`document.querySelector('[data-testid="quote-list"]')` 的 `getComputedStyle().width` 应等于 `min(420, 100vw-32)`（390 视口 ≈358px），popper（`.ant-popover`）`right ≤ innerWidth`
- 产物验证注意：emotion 是**运行时注入**，样式在 JS chunk（SessionDetailPage-*.js）不在 CSS 文件——grep 产物 CSS 验证样式会假阴性

## 坑

- **锚点结构探针**（2026-09-25）：单段 agent 消息的 `data-quote-block` 就落在消息容器自身（与 `data-quote-message-id`/`data-quote-role` 同元素），`agentEl.querySelector('[data-quote-block]')` 会查空——取 block 用 `closest('[data-quote-block]')` 或直接对锚内 `p` 的 text node 造 Range
- **AppTooltip 底座（Radix + pointerenter）CDP hover 测不出**（2026-10-26 推翻旧条目「tooltip 必须 CDP hover」——那只对 antd rc-trigger 成立）：AppTooltip 监听 React `onPointerEnter`，CDP `hover` 只派发 mouse 系事件、瞬移跨界不产生 React enter 模拟所需的 pointerover/out 对（原生 mouseenter 能到、tooltip 不开）。**可靠 recipe**：先 hover 远处元素再 hover 目标造跨界（验证事件通路），tooltip 断言用合成 `PointerEvent`——对任意外部元素 dispatch `pointerout`、对目标 dispatch `pointerover`（bubbles）+ `pointerenter`（不冒泡），~1.2s 后查 `[role=tooltip]`（Radix DOM，**不是** `.ant-tooltip`）。pointerType 必须 'mouse'
- **>500 字符 tooLong 拒绝**：普通问答回复单块仅 ~300 字符，跨块又被拒——UI 内难自然构造，留单测覆盖即可
- quote E2E 用的模型下拉显示 glm-5.2 但 turn 实际 claude-sonnet-4-6（模型下拉与 turn 无关，别被迷惑）
- **远程验收环境必踩：裸 `crypto.randomUUID` 在 http+IP 访问（非安全上下文）不存在**——新建 uid 时抛错、流程静默中断，localhost 测不出；新代码一律走 `core/lib/uuid.ts` 的 `uuid()`（getRandomValues 兜底），见引用特性首条添加中断事故（2026-09-22）
- 评论键位（2026-09-22 定稿）：Enter 换行、Ctrl/Cmd+Enter 提交、Esc/点外关闭——「Enter 提交」让多行无法输入，用户验收否决过
- **running 时 popover 不闪**（2026-09-23 修）：流式 stick-to-bottom 程序滚动不再关引用浮层，关闭只认 wheel/touchmove 手势后 250ms 内的 scroll——CDP 自测时别用程序 scrollTo 复现「滚动关浮层」，要先 dispatch wheel 事件

## 回应批注（XML 命名空间换形后，2026-10-26 mobi-xml-namespace 票 04）

协议已「进出同形」且带命名空间（spec .scratch/mobi-xml-namespace）：进向 `<mobi:quote index role>…</mobi:quote>` XML（shared buildQuoteXml 组装 + `<user-comment>` 评论内嵌），出向自闭合 `<mobi:quote index="N"/>`（`<system-reminder>` 指令教模型输出）。历史读兼容矩阵三格式：`:mobi-quote{}` / `<quote/>` / `<mobi:quote/>`（tokenizer 通用扩展一个管全族，web XML_DIRECTIVE_TAG_NAMES 单源）。
**bootstrap 重启后新会话才带新协议代码**（会话 CLI 启动即固化代码）。

链路：划选 agent 回复 → 添加到对话 → 评论保存（CommentField 的 `.anticon-check` 按钮，Enter 只换行）→ 发探针 → 回复中断言：

1. `[data-testid="quote-annotation-N"]`「引用 N」上标按钮渲染（新 XML 与旧 directive 经 MobiDirective 收敛到同一 QuoteDirectiveMarker）；正文无标签原文残留
2. tooltip 内容 = excerpt + 评论（合成 PointerEvent 验证法见坑一节；CDP hover 测不出 AppTooltip）
3. 点击按钮 → `CSS.highlights` 注册 `quote-fragment-flash`（Chrome 155 用 forEach 遍历，见片段高亮节）
4. **降级矩阵 seed recipe**（Store 造混合形态历史行真机断言）：越界 `index="9"` / 伪造 `index="0"` 原文保留、同 index 重复只留首处、回显形态 `<mobi:quote index="1">…</mobi:quote>` 整体渲染为标注无内容残留（旧 `<quote index="1">…</quote>` 同样收敛）。**三形态混合行的预期基线（2026-10-26 真机实测）**：`:mobi-quote{}` / `<quote/>` / `<mobi:quote/>` 同 index 各一次 + 重复一次时，markers 恰好 **2 个**（DSL 族首处 + XML 族首处各一；XML 族跨形态同 index 去重、DSL↔XML 互不跨族合并），正文字面量残留仅代码围栏内那处；**seed 会话 workspace_id 需手工 UPDATE 补绑**（getOrCreateSession 的 workspaceId 传 undefined 落 loose session，UI 列表不可见）**坑：user 行 seed 时 localId 必须传 null**——带 localId 的 user 行会被 isQueueableUserSubmission 判入 queued 轨道，UI 按排队消息从线程剔除 → 配对输入缺 user → 全部标注降级原文（2026-10-26 实踩：表现为 markers 全消失 + directive 原文回潮）。**纯 Store 造的 session 行没有 executor 执行体，发消息静默排队不回复**——真实模型链路必须走 UI 新对话
5. **steer uuid 配对断言**：长任务（如「数到 40」）运行中划选发 steer → DB 断言 `messages.metadata` 列 user 行 nativeId 与 assistant 帧 `user_message_uuid` 交错各归其主（nativeId 在 metadata 列，不在 content.meta；steer 回复回戳指向自身消息，线性推导在该场景会错配——票 03 价值实锤）

探针 prompt 要求「直接回答不要用工具」，否则首轮会触发 Change Title 等工具流干扰选区。
