---
name: title-sync-verify
description: 会话标题同步验证 — Web rename / change_title MCP 回写 CC customTitle，查 jsonl custom-title entry
metadata:
  type: recipe
  last_verified: 2026-08-12
---

# 会话标题同步验证

验证「Mobi → CC 标题回写」：mobi 侧改名后，CC 的 customTitle（`~/.claude/projects/<encoded-cwd>/<claudeSessionId>.jsonl` 里的 `custom-title` entry）应同步更新。

## 核心验证手段：查 jsonl custom-title entry

不管哪条路径，最终都调 SDK `renameSession()` 追加一行到 session jsonl：
```
~/.claude/projects/<cwd 非字母数字替换为->/<claudeSessionId>.jsonl
```
```bash
grep "custom-title" ~/.claude/projects/-Users-...-demo/<claudeSessionId>.jsonl
# {"type":"custom-title","customTitle":"标题","sessionId":"..."}
```
`claudeSessionId` = 创建会话后该目录下**最新** `.jsonl` 的文件名（SDK init 时创建）。LWW —— 最后一条 customTitle 胜出。

## 场景 1：Web UI rename → CC

1. 会话已创建且 Claude session init 完（jsonl 文件存在）
2. 侧边栏 hover 会话项 → 出现 **edit(Rename)** 按钮 → click
3. rename 输入框出现（value=当前标题）
4. 改名提交（见下坑）
5. 轮询 jsonl：`grep -c custom-title` 出现**新的一条** = RPC 链路通（Web→Hub renameSession→CLI rename-session handler→SDK renameSession）

## 场景 2：CC 调 change_title MCP → mobi + CC

**无需手动触发** —— Claude 系统提示要求「新会话首条消息后调 `mcp__mobi__change_title`」。发一条「你好」，Claude 响应时自动调，生成标题（如「闲聊问候」）。
- 验证 mobi 侧：侧边栏 + 对话区标题都更新（title-changed 事件）
- 验证 CC 侧：jsonl 出现 custom-title entry（= MCP handler 的 syncClaudeRename 生效）

## 坑

- **rename 输入框 Ctrl+A 不全选** — chrome-devtools `type_text` 会**追加**到现有 value 后（如 "闲聊问候"+"Web重命名测试"→拼接），不替换。是 MCP 工具行为非产品 bug。验证只看「新 custom-title entry 出现」即可，不看标题值是否纯净。若需纯净值：click 框 → 连按 Backspace 删空再 type
- **历史 title-changed 事件气泡不回溯** — 对话区内早先的 "title-changed" 系统消息（记录当时的标题）保持旧值，不随后续 rename 更新；侧边栏 + PageHeader 才实时更新。这是正确行为，勿误判
- **RPC best-effort** — CLI 离线 / Claude session 未 init（jsonl 不存在）时 rename RPC 会失败被吞，jsonl 不会写。验证前先确认 jsonl 文件已出现
