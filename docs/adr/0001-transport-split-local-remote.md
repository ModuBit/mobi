# local 与 remote 模式采用不同 transport 承载 hook 与 mobi MCP

## Status

accepted（2026-09-06）

## 背景

`change_title`（mobi MCP）与 SessionStart hook（sessionId 绑定）需要在 Claude 侧与 mobi 侧之间通信。历史上两种模式统一走「本地 HTTP server + settings 文件注入」：每个会话起两个监听 `127.0.0.1` 随机端口的 HTTP server，并生成临时 hook settings JSON。

remote 模式下 Claude 以 SDK Query 形态跑在 mobi 进程内，HTTP server 是纯浪费（进程内回调可达）；且每个会话多占两个端口、多一个临时文件生命周期要管理。local 模式下 claude 是独立子进程，进程内回调不可达，HTTP 是唯一通道。

## 决定

核心逻辑抽为一套共享代码（`change_title` 工具工厂 + `onSessionFound` 绑定逻辑），transport 按控制方向分流：

| | local（终端控制） | remote（Web 控制） |
|---|---|---|
| mobi MCP | HTTP server（重接共享工厂） | SDK `createSdkMcpServer` 进程内 server |
| SessionStart hook | HTTP hook server + settings 文件 | SDK `hooks.SessionStart` 进程内回调 |
| settings 注入 | `--settings` 文件（hook 条目 + env + crossSessionInbound） | `Options.settings` 内联对象（仅 crossSessionInbound / hooksConfig），不落盘 |

## Considered Options

- **彻底只留 in-process（废弃 local 的 HTTP）**：不可行，local 的 claude 子进程无法消费进程内 server。
- **只留 HTTP（维持现状）**：remote 模式持续为每个会话付出两个端口 + 一个临时文件的代价，换取的是多 agent 时代才需要的通用性。
- **settings 文件照旧（仅裁 hook 条目）**：SDK `Options.settings` 支持内联对象，remote 无落盘必要。

## Consequences

- 多 agent 扩展（非 Claude flavor）时，为该 flavor 增加 HTTP 适配器即可，共享核心不变。
- `mcp__mobi__change_title` 工具名与 allowedTools 预授权列表保持不变，SDK 按注册名 `mobi` 生成前缀。
- remote 模式的 `onSessionFound` 仍为双源幂等（SDK hook 回调 + systemInit），绑定逻辑无单点。

## 现状修正（2026-09-12）

后续 [ADR 0005](/docs/architecture/0005-agent-apps-mcp-route.md) 落地时把 server 按职责拆成两个，工具前缀随之改变——上面的工具名已不是现状：

- `mobi` → 拆为 `mobi-core`（内置基础能力：change_title、web 工具）与 `mobi-apps`（应用工具族）。
- 当前工具名：`mcp__mobi-core__change_title`、`mcp__mobi-core__web_search` / `web_fetch`、`mcp__mobi-apps__*`。
- 「预授权列表保持不变」不再成立：`allowedTools` 现列 8 个工具，且 A/B 类工具（仅 remote 注册）也在其中。

transport 分流本体的结论未变。现状细节见 [MCP 模块文档](/docs/architecture/cli/mcp/README.md)。
