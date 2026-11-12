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

## 清理

附件 chip 删除钮是 `.anticon-close`，定位到含文件名的 `div[style*="border-radius: 22px"]` 容器内再 `.click()`；残留附件会随发送一起上传。

## 坑

- jsdom 单测里用普通 `Event('paste')` + defineProperty clipboardData 即可；真机 E2E 用 `ClipboardEvent` + `DataTransfer`
- 直接用 `ed.commands.setContent(...)` 造富文本时尾部会多一个空 paragraph（TrailingNode），断言 wire 用 trimEnd
