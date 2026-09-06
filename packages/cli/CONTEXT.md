# CLI（Agent 会话运行时）

mobi CLI 侧的领域语言：本地拉起并托管 Claude Code 会话进程，向 hub 同步会话状态与消息。

## Language

### 会话控制方向

**local 模式**:
本地终端控制——用户在本机终端直接操作，mobi spawn 独立的 claude 子进程，用户与该子进程交互。
_Avoid_: 交互模式、interactive（旧口头称呼）

**remote 模式**:
远程控制——会话经 hub 由 Web 端驱动，Claude 以 SDK Query 形态跑在 mobi 进程内（headless，无终端 UI）。
_Avoid_: headless 模式（旧口头称呼）

两个词的区分标准是**谁在控制会话**（本地终端 vs Web 远程），不是进程拓扑。

### 进程角色

**Runner**:
常驻的会话管家进程，spawn 并跟踪 Claude 会话子进程；经 supervisor 的 unix socket 接受组件级启停。

**Supervisor**:
组件守护进程，托管 hub 与 runner 的拉起、崩溃退避重启；控制通道为 unix domain socket。

**Hook Server**:
local 模式下接收 Claude 子进程 SessionStart hook 的本地 HTTP server（hook 经 hook-forwarder 命令转发）。

**mobi MCP Server**:
承载 `change_title` 等面向模型的工具的 MCP server；local 模式为 HTTP transport，remote 模式为 SDK 进程内 server。
