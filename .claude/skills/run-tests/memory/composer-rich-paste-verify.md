---
name: composer-rich-paste-verify
description: composer 富文本粘贴 E2E——合成 ClipboardEvent 验证文件/长文本转附件、Markdown 块转换、行内标记原样、URL autolink
metadata:
  type: recipe
  last_verified: 2026-11-12
---

# composer 富文本粘贴验证

ChatInput 的 `handlePaste` 优先级：消费方附件钩子 → text/html 走 PM 默认解析 → 纯文本块级 Markdown 转富文本 → 其余默认插入。

## 合成事件 recipe（页面内 evaluate_script）

编辑器实例：`document.querySelector('.ProseMirror').editor`（TipTap 会把实例挂到 dom 上）。

```js
const pm = document.querySelector('.ProseMirror');
const dt = new DataTransfer();
// 文本：dt.setData('text/plain', text)
// 文件：dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
```

## 判据

- **图片/文件粘贴**：编辑器正文保持空；附件 chip 出现（名字文本如 `image.png`，含 blob 预览）；落盘在**工作区** `~/workspace/demo/.mobi/uploads/YYYY-MM/`（不是 `~/.mobi-e2e`）。上传名带短 ID 后缀
- **>1000 字符纯文本**：转 `pasted-text.txt` 附件，`event.defaultPrevented === true`，正文为空
- **块级 Markdown 源文本**（`# 标题`/`- 一`/围栏）：`defaultPrevented === true`，DOM 出现 `<h1>`/`<ul>`，`editor.getMarkdown()` 回吐同样结构
- **行内标记纯文本**（`aa *beta* aa`、`const a = 2 ** 3; // *x*`）：**原样字面**，DOM 无 `<em>/<strong>/<del>`。若出现格式 = StarterKit bold/italic/strike 的 paste rule 又生效了（`enablePasteRules: ['link']` 被改掉）
- **裸 URL 粘贴**：DOM 出现 `a[href="https://…"]`，wire `[url](url)`（link 的 paste rule 必须保留）
- **代码块语法高亮**（2026-11-12）：`editor.commands.insertContent('```ts\nconst x = 1\n```', { contentType: 'markdown' })` 后 `pre code` 内出现 `span.hljs-keyword` 等 token；token 颜色双档（dark `rgb(255,123,114)` / light `rgb(215,58,73)`，来自全局 `styles/highlight.css`）。高亮是 Decoration：`editor.getMarkdown()` 仍回吐纯围栏、`getHTML()` 无 span
- **无语言围栏不泄漏 `plaintext`**：打字 ` ``` ` + 空格造 codeBlock 后 `editor.getJSON().content[0].attrs.language === null`，`editor.getMarkdown()` 以裸 ` ``` ` 开头（没有 ` ```plaintext `）。注意 `highlightAuto` 被包成 plaintext，所以无语言代码块**不出现** hljs token，属预期

## wire 语义验证（2026-11-12）

`getWireText` 无公开句柄，最可靠的判据是**真发送后查消息 API**：

```bash
SID=$(cat /tmp/e2e-session-id.txt)
curl -sf "http://localhost:2224/api/sessions/$SID/messages" -b /tmp/e2e-cookies.txt \
  | jq -r '[.messages[] | select(.content.role=="user")][-1].content.content[0].text' | od -c
```

- 纯文本段落（`R&D a_b [c] *.ts`）：落库必须逐字一致，无 `&amp;` / `\_` / `\*`（`editor.getMarkdown()` 会转义，这正是要绕开的旧 bug）
- `! ` 命令：`! echo a && echo b > /tmp/x && cat /tmp/x` 落库必须保真 `&&` / `>`；同时在页面里确认 CLI 真把它当一条 bash 命令执行
- 富文本 + 连续空段落：`editor.getMarkdown()` 出现字面 `&nbsp;`，落库必须没有 `&nbsp;`（围栏内除外）
- 代码块：落库围栏无语言名（或与 `attrs.language` 一致），无 `plaintext`

## 回退 / 引用恢复（2026-11-12）

- **回退恢复富文本**：消息 `更多操作` → `回退并编辑` → 二次面板点 `仅回退对话`；composer 的 `editor.getHTML()` 必须出现 `<strong>` / `<ul>`，`getText()` 不含 `**`（验证 `setMarkdownWithEditor` 回填）
- **代码块内加引用**：先 `setTextSelection` 把光标放 codeBlock 内，再在消息正文里造 Range 选区并 `dispatchEvent(new Event('selectionchange'))`，等 `添加到对话` 按钮出现后点击；断言仍只有 1 个 codeBlock、文字未变，chip 落在其后的新段落
- **草稿恢复富文本**：会话页 `setContent` 造粗体 + 列表 → 等 2s → reload → `editor.getHTML()` 仍含 `<strong>/<ul>`；new-session 页不支持 reload 恢复（`composerStateRef` 是内存 ref，只在 isPending 重挂时生效），别拿 reload 验它

## 清理

附件 chip 删除钮是 `.anticon-close`，定位到含文件名的 `div[style*="border-radius: 22px"]` 容器内再 `.click()`；残留附件会随发送一起上传。

## 坑

- jsdom 单测里用普通 `Event('paste')` + defineProperty clipboardData 即可；真机 E2E 用 `ClipboardEvent` + `DataTransfer`
- 直接用 `ed.commands.setContent(...)` 造富文本时尾部会多一个空 paragraph（TrailingNode），断言 wire 用 trimEnd
- **E2E 会话的 CLI 沙箱拒绝写 `/tmp`**（`Operation not permitted`，2026-11-12 实测）：要验证 bash 真的执行/写文件，路径放 `~/workspace/demo` 下；`/tmp` 只适合写宿主侧 cookie/临时脚本
- 发送后 session 可能进入「意图确认」/流式态（发送键变 `停止`），此时 Enter 不提交，先点 `跳过并提交` 或等 turn 结束再发下一条
