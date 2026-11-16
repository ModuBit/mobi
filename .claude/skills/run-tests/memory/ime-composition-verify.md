---
name: ime-composition-verify
description: IME composition 类 bug 的浏览器复现手法（CDP 无法驱动系统输入法，用合成事件等价模拟）+ 从 React fiber 挖 tiptap editor 实例
metadata:
  type: recipe
  last_verified: 2026-11-16
---

# IME composition 复现（composer 拼音 Backspace 打断案，2026-11-16）

## 背景

CDP `Input.dispatchKeyEvent`/`type_text` 注入渲染器，**不经过系统 IME**——真实 composition 无法用 CDP 驱动。等价模拟手法可复现「composition 中 JS 层行为」并定因。

## 手法（三件套）

1. **合成 composition 态**：`ed.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))` —— ProseMirror 的 compositionstart 监听吃 dispatchEvent，`view.composing` 真实翻 true（收尾记得派 compositionend 复位）。
2. **模拟 IME 直改 DOM**：直接改 `p.firstChild.textContent` + `range.setStart/collapse` + `sel.removeAllRanges()/addRange(range)`（光标必须移，readDOMChange 读 DOM selection），再派 `compositionupdate`。MutationObserver 异步 flush，等 100–200ms。
3. **观测 dispatch**：`editor.on('transaction', spy)` 记 `tr.getMeta('composition')`——readDOMChange 的合成同步 tr 恒带 composition meta；**keymap/命令链 tr 不带**。composition 活跃期间出现无 meta 的 dispatch = 有代码在打断合成。

## 从 React fiber 挖 tiptap editor 实例

`.ProseMirror` 节点自身无 fiber key（tiptap 自管 DOM）；在 `parentElement` 上找 `__reactFiber$*`，沿 `f.return` 上溯 + 遍历每层 `memoizedState` 链，找 `{ view, getHTML, … }` 形状的 hook state（useEditor 的返回值）。拿到后 `editor.view` 即 EditorView（可 patch dispatch / 读 composing）。

## 本案根因（已修，留作同类问题参照）

prosemirror-view ≤1.42.8 的 readDOMChange「Same for backspace」分支：composition 中删字符（inlineChange 且 `endA > start && endB == start`）会派发**无 isComposing 的合成 Backspace** 给 keymap → tiptap keymap 的 Backspace 链（undoInputRule/joinBackward…）dispatch → updateView 重写合成锚定 DOM → 浏览器 abort 合成，拼音（含隔音符）字面 commit。**修复 = prosemirror-view ≥1.42.9**（`dispatchKey`：`view.composing → return false`）。红→绿回归测试在 `packages/web/tests/components/chatInput.test.tsx`（composition 中删字符不得出现无 composition meta 的 dispatch）。

## 坑

- **jsdom 测同类场景须桩 `view.coordsAtPos`**（readDOMChange 的 `scrollIntoView()` → coordsAtPos 在 jsdom 无 layout 抛错）。
- **`find node_modules/.bun -name "prosemirror-view@*"` 返回的第一个目录不是实际解析版本**——多版本共存时按 lock/测试报错路径里的版本号为准。
- 依赖升级后 vite `.vite/deps` 缓存仍旧：须重启 web dev + 页面 reload，再从页面 `fetch('/node_modules/.vite/deps/@tiptap_pm_view.js')` grep 版本特征（如 `dispatchKey`）确认加载的是新代码。
