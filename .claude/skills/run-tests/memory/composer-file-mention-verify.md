---
name: composer-file-mention-verify
description: Sender @ 文件引用验证：目录下钻、点入路径逐字编辑、图文与消息气泡一致、发送原文
metadata:
  type: recipe
  last_verified: 2026-11-18
---

# Sender @ 文件引用验证

- 用 E2E bootstrap + 浏览器登录。在新建会话页选择以 `~/workspace/demo` 为主目录的工作区。
- 输入 `@app`，等 `#mobi-mention-listbox [role=option]` 出现后按 Enter：`@app/` 要有目录图标，面板继续打开。再输 `globals`，等 `app/globals.css` 出现后按 Enter：`@app/globals.css` 要有文件图标，面板关闭。图标用 `.ProseMirror [data-mention-icon] svg` 验，不能只数文本 span。
- 在会话页输入 `复查 @app/globals.css 和 @app/ 只回复 OK`。用 CDP 点击路径正文（不是外层输入框），断言 `getSelection().anchorNode` 是路径文本且 `anchorOffset` 在中间。真 Backspace 只少一个字，文件面板仍关闭。粘贴照 [[composer-rich-paste-verify]]；发送照 [[composer-slash-atom-verify]] 观察 XHR body：只有原样的 text block，消息气泡的文件仍是 `mobi://file/open` 链接。
- 桌面和 390px 触屏模拟各看新建及会话页。比对 `.ProseMirror .mention-file` 和 `.user-msg-bubble a[href^="mobi:"]` 的 computed `fontFamily`、字号、行高、下划线样式；目录对比 `.mention-directory:not(.file-mention-widget)`。颜色随所在表面适配（浅色主题的用户气泡是反色深底），不要求同 RGB。两端短段落高度应为 22px，图标不应触发额外换行。Chrome 普通点击和 Backspace 可验，不代替真实手机键盘或 IME。
- 中文句读探针：输入 `复查：@app/globals.css，@app/ 只回复 OK`，文件和目录各有一个图标，逗号在文件徽章之外。发送后断言气泡链接 `mobi://file/open?path=app%2Fglobals.css`，逗号及后文仍在。输入 `@src/file.constructor`，应显示 `CONS` 普通徽章且页面不崩溃。
- 字体容易漏：消息气泡继承 `--font-chat`，Sender 普通正文是 `--font-body`；只复用图标、颜色和下划线不等于两端样式一致。仅给 Sender 的文件引用和它的图标使用 `--font-chat`，不改普通正文。
