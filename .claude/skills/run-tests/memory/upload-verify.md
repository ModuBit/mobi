---
name: upload-verify
description: 附件上传链路 E2E 验证——AttachPanel「文件」按钮可直接 upload_file / 落盘去重断言 / DB document block 断言 / 模型读取回显
metadata:
  type: recipe
  last_verified: 2026-10-04
---

# 附件上传验证（pending #100 R11）

## 全链路 recipe（PC，CDP 自主完成）

1. **造探针文件**：`/tmp/<probe>.txt`，首行放唯一标记（如 `R100-UPLOAD-PROBE-7f3a`），内容两三行、字节数好认（43B）。
2. **上传**：点 composer「添加附件」→ AttachPanel 弹出「文件」按钮——**该按钮动态 createElement input + click，CDP `upload_file` 可直接对它传文件路径**，无需 handle_dialog。
3. **附件卡断言**：snapshot 出现 `<name> · 43 B` 且无 error 徽标（status=complete）。附件使 canSend 成立，发送按钮 enabled。
4. **落盘断言**：文件在 `<会话 cwd>/.mobi/uploads/YYYY-MM/<name>-<随机去重后缀>.<ext>`（如 `r100-upload-probe-mut3tpdbks68.txt`），逐字节比对内容。
5. **模型可达断言**：发「请读取附件并逐字回复第一行，格式 FIRST-LINE: <内容>」→ `wait_for "FIRST-LINE:"`，回显逐字命中。附件以 @ mention 进上下文，模型 thinking 会确认。
6. **DB 断言**（`~/.mobi-e2e/mobi.db`）：user 消息 content 是数组，附件落为 `{"type":"document","source":{"type":"url","value":".mobi/uploads/2026-10/<去重名>","mimeType":"text/plain"},"filename":"<原名>","size":43}` + text block。**messages 表无 role 列**，用 `rowid` + content 前缀判别（role 在 content JSON 内）。

## 坑

- messages 表结构：`id/session_id/content/created_at/...`，role 在 content JSON 里，别 `SELECT role`。
- 附件卡片是消息内 link（`mobi://file/open?path=...`），可直接从 snapshot 确认去重后文件名。
