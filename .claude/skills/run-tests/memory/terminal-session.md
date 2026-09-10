---
name: terminal-session
description: 触发终端游离会话（startedBy=terminal）— script 造 PTY 后台跑 CLI；⚠️ 2026-09-11 直跑报 Unable to connect 待查
metadata:
  type: recipe
  last_verified: 2026-09-11
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
- ⚠️ **2026-09-11 直跑报 "Unable to connect to Mobi Hub" → local-only 模式**（TUI 出 confirm 提示，选确认会走 `service supervise --sync` 起本地服务；sessions 表 0 行）——源码版与编译产物 A/B 行为一致，非编译态回归；同日 runner spawn 路径 hub 连接正常。疑 PTY 直跑下 profile 加载/连接时序问题，待查。启动就绪判断别只看进程在，要看 sessions 注册或 TUI 文案
- ⚙️ script/PTY 长驻进程同样会被沙箱组回收，用 [[env-bootstrap]] 的 perl setsid 解法包裹
