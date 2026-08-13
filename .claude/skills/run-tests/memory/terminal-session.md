---
name: terminal-session
description: 触发终端游离会话（startedBy=terminal）— script 造 PTY 后台跑 CLI
metadata:
  type: recipe
  last_verified: 2026-08-13
---

# 终端游离会话（验证 Recent 区）

验证「终端跑 `mobi` → 会话出现在侧边栏 Recent 区」时，bash 无 TTY，直接跑 CLI 不行；用 macOS `script` 造 PTY 后台启动：

```bash
cd ~/workspace/demo && nohup script -q ~/.mobi-e2e/logs/terminal-session.log \
  /Users/manerfan/.bun/bin/bun /path/to/mobi/packages/cli/src/index.ts --profile e2e \
  >/dev/null 2>&1 &
```

- 默认命令（无子命令）= claudeCommand → 终端会话，注册到 hub 后 Web Recent 区出现（标题默认取目录名）
- profile 从 `~/.mobi/profiles/<name>.env` 加载，**与 cwd 无关**，任意目录可跑
- typescript log（terminal-session.log）可能一直空——以 Web 侧 Recent 区出现会话为准
- 收尾：`pkill -f "script -q.*terminal-session.log"` 再跑 cleanup
