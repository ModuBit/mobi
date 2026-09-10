---
name: terminal-session
description: 触发终端游离会话（startedBy=terminal）— script 造 PTY 后台跑 CLI；断连根因=hub 启动时不可达即降级 local-only
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
- ✅ **"Unable to connect to Mobi Hub" 断连已查明（2026-09-11）**：非 PTY/非编译态问题——是 **hub 在 CLI 启动时真的不可达**（曾因 [[env-bootstrap]] 的沙箱组回收把 bootstrap 连坐杀掉）。CLI 的流程：maybeAutoStartServer 健康探测失败 → 起 supervisor → runClaude 连接仍 ECONNREFUSED → 按设计**立即永久降级 local-only**（commands/claude.ts isConnectionError 分支），无重试窗口；local-only 下直接 spawn 提取的 claude 二进制（编译态 resolve 恰可借此验证）。hub 正常时同命令复现即注册成功（sessions 表 startedBy=terminal）。排查口诀：先 `curl :2224/health` 确认 hub 活着再跑 PTY，报断连先查环境别查代码
- ⚙️ script/PTY 长驻进程同样会被沙箱组回收，用 [[env-bootstrap]] 的 perl setsid 解法包裹
