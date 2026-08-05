---
name: chat-verify
description: 对话交互 / 等待轮询 / 权限审批 / 排队消息 / 停止 abort / 渲染验证 / 触发工具折叠分组
metadata:
  type: recipe
  last_verified: 2026-08-05
---

# 对话与验证

## 步骤

1. 聊天输入框发消息（[[input-box]] 规范，可带 `submitKey: Enter` 提交）
2. 等待 Claude 思考回复：`take_snapshot` 每 2-3s 轮询
3. 遇权限请求 → 浏览器点「允许」/「本次会话允许」
4. 验证渲染：`take_snapshot`（优先，查组件存在与状态）/ `take_screenshot`（视觉效果）

## 触发 AskUserQuestion（验证聊一聊 / 选项 UI）

可靠触发 prompt（明确指令模型调用该工具）：
> 我要给这个项目加认证。请用 AskUserQuestion 工具问我一个问题：应该用 JWT 还是 Session？给我两个选项 JWT / Session。

模型（实测 claude-sonnet-4-6）会调 AskUserQuestion → 弹 `AskUserQuestionFooter`（question-circle 图标 + radio 选项 + Other + Submit + **Chat about this** 按钮）。

**聊一聊按钮验证**：点「Chat about this」（英文 locale 文案，zh 是「聊一聊」）→ deny 带 seed reason → 原卡片收起为 denied 态（红点 + question 图标），Claude 按 seed 指令反问「用户想先澄清问题。请问你想澄清哪方面？」+ 列具体澄清方向。用户在普通聊天框继续输入 → Claude 据此重新发问。

**带原因拒绝验证**（普通工具，如 Bash `ls -la`）：权限弹窗的 secondary row 有「Deny with reason」按钮 → 展开 textarea（placeholder "Say why, or how you'd like it changed…"）→ 输入原因 → 点「Send Feedback」→ Claude 收到 reason（实测回应「收到，你想先讨论方案」）。

**坑**
- 原 AskUserQuestion 卡片 turn 结束后折叠进 `.tool-call-think` 组，`evaluate_script` 点 header 难展开（body 不入 DOM）。验证 denied 态渲染优先靠单测；E2E 视觉只能确认红点+标题，body 内容（seed 文案）需精确点 ▸ toggle（antdx Think 折叠态 body 懒渲染）
- i18n 文案改动后 HMR 不生效，`navigate_page` 刷新（reload 偶发丢 page，见 [[browser-connect]]）
## 停止按钮（abort）

mobi 没有独立的停止按钮——**停止 = composer 右下角的 send/stop 合并按钮**（`SubmitButton.tsx` + `submitButtonState.ts`）：

- 输入框有内容 → 发送态（`arrow-up` 图标，running 中也可继续排队）
- **输入框空 + running/sending → 停止态（方块 ■，svg 是 `<rect>`）**
- 输入框空 + 空闲 → 发送态 disabled

要点停止：先 `Ctrl+A` + `Backspace` 清空输入框，按钮才翻成停止态。时间敏感场景（长任务执行中）用 `evaluate_script` 定位 + `.click()` 比 `take_snapshot` 拿 uid 快：

```js
() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const sb = btns.find(b => { const r=b.getBoundingClientRect(); return r.y>1100 && r.x>1000; });
  const svg = sb?.querySelector('svg');
  return { isStop: svg ? svg.querySelector('rect') !== null : false }; // rect = 停止态
}
```

点 `.click()` 即触发 abort（等价 UI 点击，不是调 API）。

## 排队消息（running 中发送）

running 中发消息 → 进 QueuedMessagesBar 悬浮条（`Queued (N)`），不进主 timeline。停止 / turn 结束后消息被消费 → 翻为主 timeline 的独立 user bubble（经 `messages-submitted` SSE → `markMessagesSubmitted` 把 queueState pending→consumed）。

## 坑

- **不用 `wait_for`** — 文本匹配不可靠；用 `take_snapshot` 轮询
- **等待不要急** — Claude 处理需时间，2-3s 轮询
- **停止按钮不独立** — 见上，是 composer 合并按钮的停止态，输入框空才出现
- **i18n JSON 改动 HMR 不生效** — `navigate_page` 刷新页面（注意 reload 偶发丢 page，见 [[browser-connect]]）
- **诊断数据缺失回到代码排查** — 不要用 `evaluate_script` 注入数据或绕过 UI；数据没出现说明代码有问题（`.click()` 点 UI 按钮不算绕过）
- **`take_snapshot` 漏条件渲染的纯布局内容** — 展开态/收起态切换渲染的纯 styled div（如吊顶 `ContextUsageDetail`）a11y tree 常不显示文本节点，看着像没渲染；用 `evaluate_script` 读 `element.innerText` 验证（只读诊断，不改状态）
- **吊顶点击 toggle 不直观** — `SessionContextBar` 点击切换 expanded，但单测外难直接观察；读 `[aria-label="session-context"]` 的 `data-expanded` 属性判断当前态
- **`prompt_suggestion` 首轮被 suppress** — SDK 文档明确「Suppressed on the first turn」；E2E 验证 suggestion chip 必须等**第二轮完整独立 turn**（首条消息 result 到达、running 复位后再发第二条）才出现。只发一条消息断言 chip 不存在是**误判**。同源坑：SDK 直接传 `promptSuggestions: true` 跑单轮也无 `prompt_suggestion`，别据此断定「SDK 没传参」
## 触发工具折叠分组（验证 groupToolCalls）

验证「连续可折叠块（Bash/Read/Grep/Glob/MCP + reasoning）折叠成组」时，**模型在工具调用之间插入的 text 会打断 zone**（text 非可折叠块），每个工具单独成 zone → 不分组。常见 prompt（「依次执行 N 条命令，每条说一句结果」）必然踩此坑。

**要触发分组，prompt 必须强制连续工具、禁止中间文字**：
> 连续用 Read 工具读取这 4 个文件，要求：在整个过程中绝对不要输出任何解释、说明或过渡文字，只连续发起 4 次 Read 工具调用，4 个文件全部读完之后再统一输出总结。文件：package.json、tsconfig.json、README.md、server.mjs

实测产生 `[reasoning, Read×4]` 连续段 → 折叠成一组，标题 `Thought 1.0s, read 4 files`（thinking 时长求和 + tool 计数）。展开组：点 `.tool-call-think` 的 header，`.ant-think-body` 内含 reasoning（ReasoningBlock, `Thought · Xs`）+ 各 tool 卡片。

**读组标题**（区分组 vs 单工具卡片）：组标题是 `span[style*="font-weight"]`，文本为 `Read N files` / `Thought Xs` 等聚合短语；单工具卡片标题是工具描述（如 `List files in current directory`）。两者都用 `.tool-call-think` class，要按标题文本区分。
