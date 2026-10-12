# Vendored: @vectorize-io/hindsight-coding-agents

本目录是对 npm 包 `@vectorize-io/hindsight-coding-agents`（MIT）的 **vendor 落位**，版本钉死随
mobi 二进制分发（官方每日 autoUpdate 已设计性禁用——配置 `autoUpdate: false`，由 mobi 管理的
coding-agent.json 携带；见 `.scratch/agent-memory/spec.md`）。

## 来源与裁剪

- 上游：https://github.com/vectorize-io/hindsight （`hindsight-integrations/coding-agents`）
- vendor 版本：**0.8.0**（2026-10-08，`npm pack @vectorize-io/hindsight-coding-agents`）
- dist 为 tsup 逐入口自包含打包（零运行时依赖，仅 node 内置模块），故按 claude-code 真实
  spawn 链裁剪，仅保留 7 个文件：
  - `claude-hook.js` / `claude-sessionstart-hook.js` / `claude-stop-hook.js` — 三个 CC hook 入口
  - `mcp-server.js` — MCP server（`hindsight_*` 工具）
  - `daemon-start.js` — 本机 daemon 模式启动（`uvx hindsight-embed`）
  - `deepen.js` — 冷启动后台 backfill
  - `survey-supervisor.js` — codebase survey 监管
- 其余 ~50 个 dist 文件为其他 harness（codex/cursor/qwen/zcode…）入口，均裁除——各入口内置的
  harness 分发表中的引用是数据不是依赖

## 本地新增（非 vendor，mobI 维护）

- `.claude-plugin/plugin.json` / `hooks/hooks.json` / `.mcp.json` — 上游 plugin.json 是 dcode
  Agent Plugin 形态（`${PLUGIN_ROOT}`），此处改写为 CC 插件格式（`${CLAUDE_PLUGIN_ROOT}`，
  hooks 用 exec form）；**TS 常量单源在 node-core bundledPlugins，repo 文件与常量的一致性由
  bundledPlugins.test 锁定**
- `skills/hindsight/SKILL.md` — 上游 `skill/SKILL.md` 原样拷贝（生成物，勿手改）

## 配置契约（mobi ↔ 插件；**不改 dist 代码**）

**本目录的 dist 与上游发布逐字节一致，不打任何本地补丁**——所有策略差异一律落在 mobi
生成的那份配置文件上。回归守卫：`packages/cli/tests/runtime/runtimeAssets.test.ts` 断言
6 个入口保持上游 `raw.pageRefreshEveryTurns || 1` 形态（被打补丁即红）。

### 为什么不用 `pageRefreshEveryTurns: 0` 表达「从不刷新」

上游用 `||` 解析该键：`0` 是 falsy → 被当成「未配置」吞成 `1`，于是上游**没有任何值**能
表达「从不」。真正的判据在下游 `if (cadence > 0 && turns % cadence === 0)`。

故 mobi 用 **`-1` 哨兵** 承载「从不」：负数 truthy 能穿过 `||`，又让 `cadence > 0` 为假 →
永不注入。编码落在 daemon：`packages/daemon/src/config/memorySettings.ts` 的
`encodePageRefreshInterval`（mobi 对外语义仍是「0 = 从不」，只在写配置文件那一刻翻译）。

上游若哪天把 `||` 修成 `??`，`-1` 依然成立，**无需回头改任何地方**。风险：上游若给该键
加数值校验（如夹到 ≥0），哨兵会被夹回 0 → 又被 `||` 吞成 1（静默失效）——升级时留意。

### 变更生效链路

dist 打进二进制（embeddedAssets）→ daemon 启动时解包到
`<MOBI_HOME>/runtime/<ver>/plugins/memory-hindsight/`（**探针文件在即跳过重写**）。
故改配置文件相关逻辑后需重建二进制；已解包的机器要删掉该 runtime 插件目录让它重新释放
（版本号不变时不会自动重放）。

## 重新 vendor（升级流程）

```bash
cd /tmp && rm -rf hs && mkdir hs && cd hs && npm pack @vectorize-io/hindsight-coding-agents
tar xzf *.tgz
cp package/dist/{claude-hook,claude-sessionstart-hook,claude-stop-hook,mcp-server,daemon-start,deepen,survey-supervisor}.js <本目录>/dist/
cp package/skill/SKILL.md <本目录>/skills/hindsight/SKILL.md
# 同步更新本文件版本号 + bundledPlugins.ts 中 vendored 资产清单（若有文件增减）
```

升级前必读：CC hook 协议版本间有变动（上游加 hook 事件需重跑 install 的场景），升级后须跑
memory 插件的 PoC 验证（.scratch/agent-memory/issues/01 验收项），并复核上面「配置契约」一节
——`||` 形态是否变了（runtimeAssets.test 会红着提醒）、`-1` 哨兵是否仍有效。

## 运行要求

- 用户机器需 `node`（hook/MCP 以 `node` 拉起 vendored 入口）
- 连接信息经环境变量注入：`HINDSIGHT_API_URL` / `HINDSIGHT_API_TOKEN` / `HINDSIGHT_CONFIG`
  （配置分层：默认 < env < 配置文件——mobi 用 HINDSIGHT_CONFIG 指向自己管理的
  coding-agent.json，与用户自有 hindsight 配置隔离）
