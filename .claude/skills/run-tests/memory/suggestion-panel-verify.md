---
last_verified: 2026-11-18
---

# 斜杠命令 / @提及建议面板验证

## 打开面板

- 焦点打到底座 composer（`.tiptap`）→ `type_text("/hand")` → `#mobi-slash-listbox` 出现。
- **前提：会话的 CLI 必须连过**——斜杠命令来自 sdkMetadata 的 commands；dev 的 dormant
  会话没有命令（页面根本不发 /api/commands 请求），面板永远不弹。要么用生产活会话，
  要么先给 dev 会话发一条消息让 CLI 起来。
- 合成输入后若面板没弹：先 `Meta+A` 全选再 `type_text` 重打；直接追加字符可能拼成
  `/hand/hand`（/ 不在独立词位置 → 不触发）。

## 截断断言（label 完整性）

布局问题 jsdom 测不出，用真实浏览器量：

```js
const line = row.querySelector('[class*="labelLine"]')
const label = line.children[0]; const suffix = line.children[1]
label.scrollWidth > Math.ceil(label.getBoundingClientRect().width)  // true = 被省略号截断
```

- 必须 PC（1728）和移动端（`emulate` 390x844x3,mobile,touch）各跑一遍。
- 生产 built bundle 的 CSS module 类名是 `_suffix_<hash>_<n>`，可用
  `[class*="_suffix_"]` 注入 `<style>` 做修复前/后的对照，不必重新构建。
- 2026-11-18 基线：390px 下 75 个命令里只有 39 字符的
  `/memory-hindsight:hindsight-coding-agent` 仍截断（名字本身宽 299 > 面板 272），
  其余 label 全完整；suffix（参数提示）按预期先被省略号截断。

## 相关实现

- 列表：`ui/base/interactive/suggestion-list/`（SuggestionList + module.css），
  消费方 `features/composer/SlashCommandDropdown.tsx`、`MentionDropdown.tsx`。
- 截断优先级在 `.label` / `.suffix` 的 flex-shrink 权重（suffix 999 先让位）。
