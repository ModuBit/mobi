---
name: bubble-layout-classes-verify
description: Bubble.List 显式布局类（替代 .ant-bubble :has()）的 E2E 回归断言集
metadata:
  type: recipe
  last_verified: 2026-10-19
---

# Bubble 布局类（去 :has()）E2E 回归

背景：`.ant-bubble` 上的 `:has()` 在流式插入时重算整棵气泡子树（实测 ~3400 元素 / 20–30ms），
已改为列表项显式声明 class。回归时**别只看一张截图**，按下表逐项断言 computed 几何。

## 断言脚本（页面已登录、打开含工具/事件/产物的会话）

```js
const root = document.querySelector('.chat-scroll-container')
const bubbles = [...root.querySelectorAll('.ant-bubble')]

// A. 样式表里不得再有锚在 .ant-bubble 上的 :has()
const hasRules = []
for (const sheet of document.styleSheets) {
  let rules; try { rules = sheet.cssRules } catch { continue }
  const walk = list => { for (const r of list) {
    if (r.cssRules) walk(r.cssRules)
    if (r.selectorText?.includes(':has(') && r.selectorText.includes('.ant-bubble')) hasRules.push(r.selectorText)
  }}
  walk(rules)
}

// B. 工具气泡 ⇔ bubble-has-tool；body 宽 ≥ 气泡宽 80%
const toolRows = bubbles.map(b => {
  const hasToolDom = !!b.querySelector('.tool-call-think, .tool-call-group, .tool-call-card')
  const hasClass = b.classList.contains('bubble-has-tool')
  if (!hasToolDom && !hasClass) return null
  const body = b.querySelector(':scope > .ant-bubble-body')
  return { hasToolDom, hasClass, bubbleW: b.getBoundingClientRect().width, bodyW: body?.getBoundingClientRect().width }
}).filter(Boolean)

// C. 事件行 ⇔ bubble-event-align-{left,right}；justify-content 生效
const eventRows = bubbles.map(b => {
  const child = b.querySelector('[class*="event-align-"]')
  if (!child) return null
  const dir = child.className.match(/event-align-(left|right)/)?.[1]
  return { dir, hasClass: b.classList.contains(`bubble-event-align-${dir}`), justify: getComputedStyle(b).justifyContent }
}).filter(Boolean)

// D. 状态气泡让位 spacer：高度 === STATUS_PILLS_SPACER_HEIGHT（当前 44）
const spacer = root.querySelector('.ant-bubble.bubble-status-spacer')

// E. 全宽钩子：body / content / content 首子级 均 === 气泡宽
//    artifact 的 content 首子级是 display:contents 的 0 宽 wrapper，属正常（别当塌陷）
```

## 造场景的最小 prompt

一次回合拿齐 D/E 两个场景：

```
1. 在 ~/workspace/demo 写入 e2e-layout-check.html（任意简单 HTML）
2. 用 TodoWrite 建 2 项待办，第一项 in_progress
3. 回复末尾输出 :mobi-artifact{path=".../e2e-layout-check.html"}
```

- TodoWrite → runtimeState.todos → 状态气泡 + spacer 出现
- Write 文件 → 回合结束渲染「已编辑 1 个文件」turn-diff 卡（`bubble-turn-diff-fullwidth`）
- `:mobi-artifact` → HtmlInline 挂 `bubble-artifact-fullwidth`（由组件 imperative 添加，
  不是列表项声明——产物类型要等文件元数据才能裁决）

## 已知边界

- `bubble-event-align-right` 当前**无生产者**（reducerTimeline 只产出 align:'left'），
  E2E 无法覆盖右对齐；靠 `tests/bubble-layout-classes.test.ts` 守卫类名与 CSS 成对存在
- 断言 `.tool-call-think` 时要连 `bubble-has-tool` 一起看：只查 class 存在会漏掉「该加的没加」

## 实测基准（2026-10-19，1440×900）

- 工具气泡：bubbleW 1167 / bodyW 934（80.0%）
- artifact 与 turn-diff：bubble/body/content/首子级均 1167
- spacer：44px、padding-block 0
- 已加载样式表中 `.ant-bubble` 相关 `:has()` 规则数 = 0
