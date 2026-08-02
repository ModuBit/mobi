---
name: chat-verify
description: 对话交互 / 等待轮询 / 权限审批 / 排队消息 / 停止 abort / 渲染验证
metadata:
  type: recipe
  last_verified: 2026-08-02
---

# 对话与验证

## 步骤

1. 聊天输入框发消息（[[input-box]] 规范，可带 `submitKey: Enter` 提交）
2. 等待 Claude 思考回复：`take_snapshot` 每 2-3s 轮询
3. 遇权限请求 → 浏览器点「允许」/「本次会话允许」
4. 验证渲染：`take_snapshot`（优先，查组件存在与状态）/ `take_screenshot`（视觉效果）

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
- **SuggestionChip 验证要点** — chip 在 Sender header（输入框上方），a11y snapshot 可见 `✦` + 建议文本 + `suggestion-dismiss` 按钮。采纳 = 点文本 → 草稿回填 + chip 消失；✕ = 点 `suggestion-dismiss` → chip 消失且草稿不受影响。用 `evaluate_script` 读 `textarea.value` 验证回填
