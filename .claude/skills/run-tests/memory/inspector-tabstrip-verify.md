---
name: inspector-tabstrip-verify
description: 检查器页签条（TabStrip）验证 recipe——堆页签造溢出 / 量收窄下限与横向滚动 / 关终端页签验 PTY 真被杀
metadata:
  type: recipe
  last_verified: 2026-10-13
---

# 检查器页签条（TabStrip）验证

页签条的真机命题只有三类：**溢出时滚不滚**、**收窄到哪为止**、**关闭的副作用**。

## 1. 堆页签：`+ → 打开文件 → 点文件` 循环，每轮净增一个 tab

单靠终端（最多 3 个）+ 审查 + 文件树最多 4-5 个页签，在 420px 面板里**造不出溢出**。
要多少有多少的做法：`openFileTreeTab` 只在「当前没有 tree tab」时新建，而点文件会把 tree tab
**就地转成 file tab** —— 于是每轮「打开文件 → 点一个文件」净增一个 file tab（**每轮换不同文件**，
同路径会命中去重、退化成只激活）。

```js
// 「+」是 Radix DropdownMenu：合成 pointerdown 就能开（见 [[pitfalls-general]]）
const fire = (el, t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, buttons: t === 'pointerdown' ? 1 : 0 }))
const plus = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '新建')
fire(plus, 'pointerdown'); fire(plus, 'pointerup'); plus.click()
await sleep(300)
const item = [...document.querySelectorAll('[role="menuitem"]')].find(m => m.textContent.trim() === '打开文件')
fire(item, 'pointerdown'); fire(item, 'pointerup'); item.click()
await sleep(700)
// antd Tree 的选中在内容 span 上：点 role=treeitem 外层不触发 onSelect
const node = [...document.querySelectorAll('[role="treeitem"]')].find(t => t.textContent.trim() === 'CLAUDE.md')
const cands = [...node.querySelectorAll('*')].filter(e => e.textContent.trim() === 'CLAUDE.md')
;(cands[cands.length - 1] ?? node).click()
```

菜单已开时别再对着 `+` 发 pointerdown（会 toggle 关掉），先判 `document.querySelectorAll('[role="menuitem"]').length`。

## 2. 量溢出与下限

```js
const list = document.querySelector('[role="tablist"]')
list.clientWidth   // 可用宽
list.scrollWidth   // 内容宽；> clientWidth 才说明真的溢出、滚动分支可达
;[...document.querySelectorAll('[role="tab"]')].map(t => t.getBoundingClientRect().width)
```

- **`scrollWidth === clientWidth` 就是没溢出**：别急着说「滚动已验证」。页签若允许无限收缩
  （`min-width: 0`），会把 9 个页签压成每个 38–51px 的 stub，永不溢出——**滚动是死代码**
  （2026-10-13 实测后给 TabDiv 加了 `min-width: 96px` 下限）
- 断言滚动生效要三件套：`scrollWidth > clientWidth`、`scrollLeft` 随选中项移动
  （末尾应等于 `scrollWidth - clientWidth`）、选中 tab 的 rect 落在 tablist rect 内
- 键盘路径用**真实** `press_key`（focus 可以 evaluate 里 `focus()`）——合成 KeyboardEvent 也走
  React onKeyDown，但真机键盘才排除「事件是合成的」这类疑点
- 检查器面板宽度由 splitRatio 决定，视口 500px 时面板约 420px：窄面板 + 8 个页签就够，不必真缩窗口
- 移动端：`Emulation.setDeviceMetricsOverride({width:390, height:844, deviceScaleFactor:2, mobile:true})`
  比 MCP `resize_page` 可靠（后者在 macOS 上被窗口最小宽度卡住，innerWidth 不动）

## 3. 关终端页签 → PTY 真被杀

`clearCachedInstance('terminal:<sessionId>:<terminalId>')` → dispose → `terminal:close`，PTY 是
**daemon 的直接子进程**（`ppid === daemon pid`），PTY 里跑的是 `/bin/zsh`：

```bash
ps -eo pid,ppid,command | awk '$2==<daemonPID>'          # 建终端前先记基线
ps -o pid,ppid,command -p <ptyPid>                       # 关闭后只应剩表头 = 已回收
```

- **只读！** 严禁 `pkill`/`pgrep -f`（本机曾误杀生产 hub，见 feedback_pkill-scope-isolation）
- 顺带确认会话自身的 CLI 进程（`bun ... claude --mobi-startin…` + SDK 子进程）仍在 = 没误伤会话
- 关闭 × 用**真实 CDP click**（uid 来自 snapshot）；非活动 tab 的 × 是 `opacity: 0`，
  但透明元素照常命中，不必先 hover

## 4. 关活动 tab 后的焦点

关活动 tab 时组件接管焦点（`nextFocusAfterClose` → 顶上来的那一项）。断言：
`document.activeElement === document.querySelector('[role="tab"][aria-selected="true"]')`
（关最后一个 tab → 焦点落到它的前一个）。关**非活动** tab 则选中与焦点都不动。
