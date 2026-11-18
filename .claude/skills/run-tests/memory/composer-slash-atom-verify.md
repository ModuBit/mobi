---
name: composer-slash-atom-verify
description: composer slash 命令原子节点验证：空格触发/面板选中/粘贴/代码块跳过/退格整删/发送 wire 逐字断言 recipe
metadata:
  type: recipe
  last_verified: 2026-11-18
---

# composer slash 命令原子节点验证

验证目标：tiptap composer 里 `/cmd` 收成原子节点（badge 与消息列表一致），发送文本逐字不变。

## 环境与素材

- e2e bootstrap（端口 2224/5175）+ `POST /api/auth {accessToken:"e2e-test-token-mobi"}`。
- **slash 面板/命令集需要 CLI 连过的会话**：先 spawn + 发一条消息让 CLI 起来，
  `GET /api/sessions/:id/metadata` 的 commands 非空才算就绪（同 [[suggestion-panel-verify]]）。
- 浏览器直接开 `/sessions/:id`，`document.querySelector('.tiptap').focus()` 后操作。

## 断言 recipe

逐字输入用 `type_text`（走真实按键）。每步 evaluate 读：

```js
const root = document.querySelector('.tiptap')
({
  text: root.innerText,
  atoms: Array.from(root.querySelectorAll('[data-slash-command]')).map(el => el.getAttribute('data-slash-command')),
  badges: Array.from(root.querySelectorAll('.slash-command-badge')).map(el => el.textContent),
})
```

- 输入 `/compact`（无尾空格）→ atoms 0、面板 `#mobi-slash-listbox` 打开；再按 `Space` → atoms 1、badge `compact`、面板关闭。
- **布局（必须）**：原子化后段落仍是单行——`p.getBoundingClientRect().height === computed line-height`，
  且 `img.ProseMirror-separator` 的 computed display 必须为 `inline`。PM 在无 contentDOM 的原子后
  插占位 img；编辑器 `injectCSS:false` 时缺上游 `img.ProseMirror-separator { display:inline !important }`，
  Tailwind preflight 的 `img{display:block}` 会让徽章独占一行、光标掉到下一行（2026-11-18 用户报，
  修复在 chat-input.css）。只数 atom/badge 数量查不出这类回归。
- 不在命令表的命令（`/zzznotacmd`）同样原子化（语法判定）。
- 句中命令 `please /zzznotacmd then rest` → 1 个 atom（前导空格收进节点）。
- 代码块：`` ```js `` 建块后输入 `/compact ` → atoms 0、`pre code` 文本原样。
- 粘贴：`new ClipboardEvent('paste',{clipboardData:dt})` 派发到 `.tiptap`（`dt.setData('text/plain', 'paste /zzznotacmd arg')`）→ 1 atom。
- 退格：光标停在节点后按 Backspace 两下 → 文本无残留（第一下选中、第二下整删；不会出现半截命令名）。
- 面板选中：`/hand` → listbox → Enter → atom（走 replaceTextRangeWithAtom）。

## 发送 wire 逐字断言（关键）

axios 走 XHR，evaluate 里 patch `XMLHttpRequest.prototype.open/send` 记录
`url.endsWith('/messages')` 的 body，点发送后读 `window.__sentBodies`：

- 期望 body `{"content":[{"type":"text","text":"please /zzznotacmd then rest"}]}` —— 原子节点经 renderText 还原，空格一个不差。
- 消息气泡侧：`.x-markdown .slash-command-badge` 文本与 composer 一致——**不带 `/`**（box 图标已表达命令语义，2026-11-18 用户定稿）。

## 已知边界（验收基线）

- **紧邻两个命令**（`/compact /zzzcmd `，中间只有原子自带的尾随空格）：第二个不原子化、保持纯文本
  ——tiptap InputRule 的 matchedDocLength 守卫把跨 atom 的 match 跳过；wire 文本仍正确，只是少一个 badge。
- jsdom 测不了原生退格删除：单测用 `setNodeSelection` + `deleteSelection` 表达语义；真机验收用 Backspace。
- 真 IME 组合输入 CDP 驱动不了（同 [[ime-composition-verify]]）；`type_text` 直插中文不构成 IME 覆盖。
