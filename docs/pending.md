# 待确认逻辑

记录暂时跳过、稍后需要深入梳理的逻辑。

> 已完成/已失效条目定期清理，历史内容见 git log。**条目编号保留不复用**（代码注释、memory 中有 `#40` 式引用）。

---

## 1. ~~技术债：CLI 端 Web Server 框架不统一~~（触发式，暂不迁移）

**决策**（2026-08-15）：HookServer（`packages/cli/src/claude/utils/startHookServer.ts`，Node `http` 手写）**不迁移** Fastify。核查：仅 1 个端点（`POST /hook/session-start`）、单一调用方（`runClaude.ts`）、职责单一（SessionStart hook 检测 sessionId 漂移），Fastify 的类型化路由/schema 验证在单端点场景发挥不出来，迁移属纯一致性 churn；而该链路管 sessionId 关联，回归风险不对称。

**触发条件**：hook 需求变复杂时顺势迁移——加第二个端点、需要 schema 验证、或需要流式 body 处理。

---

## 2. ~~Local 模式下 SubAgent 消息缺失~~（暂不处理，2026-08-15）

**决策**：价值不高——Local 模式下在 Web UI 看消息的场景极少。待 Local 模式使用成为常态再评估。

**相关文件**：
- `packages/cli/src/claude/utils/sessionScanner.ts` — SessionScanner 实现
- `packages/cli/src/claude/claudeLocalLauncher.ts` — Local 模式启动器
- `packages/cli/src/claude/claudeRemote.ts` — Remote 模式（对比参照）

**待确认**：
- SessionScanner 只监听主 agent 的 JSONL 文件（`~/.claude/projects/{hash}/{sessionId}.jsonl`），不监听 subagent 消息
- `findSessionFiles()` 只收集 `currentSessionId` + `pendingSessions` 的文件，不包含 subagent 文件
- Remote 模式通过 SDK 的 `query()` 迭代器天然获取所有消息（包括 subagent 的 tool use/result），Local 模式缺少这部分
- 是否需要补全 subagent 消息监听，以及 subagent 的 JSONL 文件路径规则

---

## 3. ~~Permission 系统重构~~ ✅ 已解决（2026-08-15 逐项核查 + 3.3 实施）

四个子项的命运：

- **3.1 ExitPlanMode 模式丢失 — 设计已变更解决**：Web 端 `PermissionFooter.approveWithMode('acceptEdits' | 'default' | 'auto')` 让用户批准 plan 时显式选择退出后模式，「记住原模式恢复」的思路被更好的交互取代
- **3.2 EnterPlanMode 未追踪 — 已解决**：`claudeRemoteLauncher` 跟踪 `enter_plan_mode` tool_use，成功后 `handleModeChange('plan')` 同步
- **3.3 假拒绝 hack — 已拆除（本次实施）**：核实 SDK `query.setPermissionMode` 官方支持运行时切换（plan 无特例）且进入 plan 已走该路径后，退出对称化：批准 → `allow` + `handleModeChange(mode)`（写 session + 通知运行中 Query），替代 deny + `PLAN_FAKE_REJECT` + `PLAN_FAKE_RESTART` 队列注入 + launcher 拦截伪造 tool_result。顺带删除 `sdk/prompts.ts`（仅含两个魔法字符串）与 `MessageQueue.unshift`（hack 专用注入通道）。UX 改善：批准后同 turn 无缝执行计划，无重启延迟。单测 4 用例 + E2E（Approve (Auto) 档：Write 免审批 + 指示器 compass→bulb + 同 turn 继续）验证
- **3.4 SDK 消息有损转换 — 已过时**：userLog 现为 `{...baseFields, ...userMsg}` 全量 spread 不丢字段；sidechain UUID 注册是活代码

## 4. Task 工具 prompt 展示应由前端处理

**相关文件**：
- `packages/cli/src/claude/claudeRemoteLauncher.ts:287-299` — 生成虚拟 user 消息
- `packages/cli/src/claude/utils/sdkToLogConverter.ts:237-257` — `convertSidechainUserMessage` 方法
- `packages/web/src/` — 前端渲染

**现状**：
- CLI 在检测到 `Task` 工具调用时，从 `tool_use.input.prompt` 提取内容，生成一条虚拟 sidechain user 消息发送到 Hub
- 目的是让 Web 端展示 subagent 的任务描述
- 但 `tool_use` 消息本身已包含完整的 `input.prompt` 数据，前端可以直接从 tool_use block 中读取并渲染

**问题**：
1. 多了一条不必要的网络消息
2. `convertSidechainUserMessage` 方法仅为此场景存在
3. 前端无法区分"用户真的说了这句话"和"subagent 的任务描述"

**重构方向**：
- 前端 Task 工具卡片直接从 `input.prompt` 读取并展示任务描述
- 移除 `claudeRemoteLauncher.ts:287-299` 的虚拟消息生成逻辑
- 移除 `sdkToLogConverter.ts` 的 `convertSidechainUserMessage` 方法

---

## 6. `-c`（continue）模式未复用已有 mobi session

**相关文件**：
- `packages/cli/src/agent/sessionFactory.ts:127-137` — `extractResumeSessionId` 只识别 `--resume` / `-r`
- `packages/cli/src/commands/claude.ts:137-141` — claude 参数透传

**现状**：
- `mobi --resume <sessionId>` 会通过 `extractResumeSessionId` 解析出 claudeSessionId，查找已有 Hub session 并复用其 tag
- `mobi -c`（continue，恢复最近一次对话）透传给 Claude Code 后，Claude 会恢复已有会话，但 mobi 端不识别 `-c` 参数
- 结果：同一个 Claude Code session 对应多个 mobi session

**原因**：
- `-c` 没有显式 session ID，需要从 Claude 的项目会话历史中查找最近的 session
- `extractResumeSessionId` 未覆盖 `-c` / `--continue` 参数

**待修复**：
- `extractResumeSessionId` 需要识别 `-c` / `--continue` 参数
- 当检测到 `-c` 但无显式 session ID 时，需通过 Claude 的项目会话目录（`~/.claude/projects/{hash}/`）或 Hub API 查找该工作目录下最近的 session，获取其 claudeSessionId 后走复用逻辑

---

## 7. Web 端支持渲染 Claude Code 的 Recap 消息

**相关文件**：
- `packages/web/src/components/chat/ChatContainer.tsx` — 消息渲染
- `packages/web/src/chat/` — 消息解析与归约
- `packages/cli/src/claude/utils/sdkToLogConverter.ts` — SDK 消息转换

**待确认**：
- Claude Code 在 resume 会话时会生成 recap 消息（对话摘要），当前 Web 端是否已正确识别和渲染
- recap 消息在 SDK 消息流中的 type / subtype 标识
- 前端消息解析器（messageParser / reducerTools）是否需要适配 recap 类型
- recap 消息的展示样式（折叠/展开、区分于普通消息）

---

## 8. Snapshot 全量推送的带宽优化

**相关文件**：
- `packages/cli/src/claude/utils/streamSnapshotSender.ts` — Snapshot 生成与发送
- `packages/web/src/components/ui/Markdown.tsx` — 前端逐字揭示渲染

**现状**：
- CLI 每 500ms 发送一次完整累积内容的 snapshot（非 delta），保证断线重连/刷新后内容完整
- 典型场景（5000 字符回复、20 个 snapshot）实际传输量约为增量的 20 倍
- 本地/局域网场景下带宽开销可忽略，可靠性收益远大于传输成本

**待优化场景**：
- Hub 部署到云端或同时有大量客户端连接时，重复传输会成为瓶颈
- 超长回复（5 万字符+ tool output）累积传输量可达 MB 级别

**优化方向（delta + checkpoint）**：
- 常规 snapshot 发送增量 delta（仅新增内容），客户端本地累积拼接
- 每隔 N 次（如 5 次）发送一次全量 checkpoint，用于客户端校验和断线恢复
- 客户端断线重连时，从最近 checkpoint 恢复后继续接收 delta
- 增加客户端累积状态管理和 delta 校验逻辑，复杂度中等

**优先级**：
- 低优先级，当前本地/局域网场景无需优化
- 当 Hub 上云或多客户端并发时再实施

---

## 9. Web 端权限审批支持 "Always Allow"（永久允许）

**相关文件**：
- `packages/web/src/components/chat/PermissionRequest.tsx` — 权限审批 UI
- `packages/web/src/components/tool-card/PermissionFooter.tsx` — 工具卡片内权限 UI
- `packages/cli/src/claude/utils/permissionHandler.ts` — CLI 端权限处理

**现状**：
- Web 端权限审批只支持：
  - 普通工具：Allow / Allow for session / Deny
  - Edit 工具：Allow / Allow all edits / Deny
- CLI 端支持 "Always allow"（写入项目/用户配置文件），Web 端暂不支持

**待实现**：
- Web 端增加 "Always allow" 选项
- 通过 SDK 的 `updatedPermissions` + `destination: 'projectSettings'` 持久化权限规则
- 需确认前端 UI 设计（避免选项过多）

**优先级**：
- 低优先级，当前会话内授权满足基本需求
- 后续根据用户反馈决定是否实现

---

## 11. Team Agent UI 支持 — Hook 状态追踪方案待实现

**相关文件**：
- `packages/hub/src/sync/teams.ts` — Hook 事件处理代码（已实现，待激活）
- `packages/hub/tests/sync/teams.test.ts` — Hook 处理测试（已通过）
- `packages/cli/src/claude/claudeRemote.ts` — SDK `hooks` option 配置点
- `packages/web/src/core/data/stores/teamAgentsStore.ts` — 待创建
- `packages/web/src/components/composer/TeamAgentPanel.tsx` — 待创建
- `packages/web/src/components/composer/TeamAgentCard.tsx` — 待创建

**设计文档**：`docs/superpowers/specs/2026-05-31-team-agent-support-design.md`（本地，gitignored）
**实施计划**：`docs/superpowers/plans/2026-05-31-team-agent-ui-support.md`（本地，gitignored）

**现状**：
- Hub 已实现 team state 提取（TeamCreate/Agent(team_name)/TaskUpdate/SendMessage），Task 1（hook 事件处理 + 测试）已完成并提交
- Web UI 组件（store + panel + card + 集成）尚未实现
- Team agent 的 **idle/completed 状态追踪**依赖 hook 事件输入数据

**核心问题 — SDK Hook 输入数据获取**：

| 方案 | 可行性 | 说明 |
|------|--------|------|
| `includeHookEvents: true` | ❌ 不可行 | `SDKHookStartedMessage` 只有事件名（`hook_event`），不含输入数据（`teammate_name`、`team_name` 等） |
| SDK `hooks` option JS 回调 | ✅ 可行 | 回调直接收到完整 `HookInput`（`TeammateIdleHookInput`/`TaskCompletedHookInput`），类型安全 |
| HTTP Hook Server 扩展 | ⚠️ 可行但重 | 需 shell 进程 + HTTP 中转，比 JS 回调重得多 |

**SDK `hooks` option 实现方式**：
```typescript
// claudeRemote.ts sdkOptions.hooks
hooks: {
  TeammateIdle: [{
    hooks: [async (input) => {
      // input: { hook_event_name: "TeammateIdle", teammate_name, team_name, session_id, ... }
      // 转发到 Hub
      return { continue: true }
    }]
  }],
  TaskCompleted: [{
    hooks: [async (input) => {
      // input: { hook_event_name: "TaskCompleted", task_id, task_subject, teammate_name?, team_name?, ... }
      // 转发到 Hub
      return { continue: true }
    }]
  }]
}
```

**暂停原因**：hooks 回调方案实现复杂度高（回调闭包 onMessage、IPC 双向通信、最小化阻塞等）

**无 hook 时的降级行为**：
- Member 生命周期：active → shutdown（无 idle）
- Task 生命周期：in_progress → completed（通过 TaskUpdate）
- 自动清理仅在 TeamDelete 时触发

**待完成（按实施计划顺序）**：
1. ~~Task 1: Hub teams.ts hook 处理~~ ✅ 已完成
2. Task 2: CLI 开启 hooks 回调并转发 team 相关事件
3. Task 3-8: Web 端 store + UI 组件 + 集成
4. Task 9: 集成验证

---

## 13. 页面刷新后 Agent 执行状态丢失

**相关文件**：
- `packages/shared/src/messageClassification.ts` — `tool_progress` / `tool_use_summary` 分类为 `ephemeral`
- `packages/web/src/domain/chat/reducerTimeline.ts:94-111` — `agent-progress` 事件更新 ToolCallBlock 的 metrics/summary
- `packages/hub/src/sync/sessionCache.ts` — runtimeState（已有 backgroundTasks 同模式）

**现状**：
- `tool_progress` 和 `tool_use_summary` 被分类为 `ephemeral`：SSE 实时推送正常，历史查询时过滤
- Web 端通过 SSE 实时收到 `agent-progress` 事件，更新对应 ToolCallBlock 的 `agentMetrics`（token 消耗、工具次数）和 `agentSummary`
- **刷新页面后**：Hub 历史查询不返回 `ephemeral` 消息 → `agent-progress` 事件丢失 → ToolCallBlock 无 metrics/summary → 直到下一个实时 `tool_progress` 到来才恢复

**影响**：
- 功能无影响，仅体验上的小缺陷（agent 执行中间状态暂时空白）
- agent 执行完成后，最终指标通过 `tool_result` 的 `agentMetrics` 字段持久化在 ToolResult 中，不受影响

**评估过的方案**：

| 方案 | 做法 | 成本 | 决定 |
|------|------|------|------|
| runtimeState 存储 agentProgress | 在 `runtimeState.agentProgress[toolUseId]` 存最新 metrics/summary，复用 backgroundTasks 同模式 | 低（~70 行 + 测试） | 暂不实施 |
| 客户端缓存（localStorage） | 浏览器端缓存最新 agentProgress | 中，跨设备不一致 | 不采用 |
| 保留最近 N 条 ephemeral | DB 中仅保留每类最近一条 | 高，需新清理逻辑 | 不采用 |

**暂不实施原因**：
- 需要每条 `tool_progress` 到达时频繁更新 runtimeState（写入 DB）
- 需要额外清理逻辑（`tool_result` 到达时清除对应条目）
- 当前体验缺陷可接受，等下一个 `tool_progress` 自然恢复

---

## 15. 项目列表分页/限制展示数量

**现状**：
- `SidebarProjects`（PC）和 `MobileMenuDrawer` 内嵌项目列表（Mobile）均全量展示所有项目折叠组
- 项目组本身是折叠的（只显示一行标题），占用空间小
- 项目数量从会话 path 聚合而来，当前场景下一般 3~8 个，不会无限增长

**潜在问题**：
- 引入 Project 实体（#14）后，用户可能手动创建/关联大量项目
- 长期使用后历史项目积累可能超过 20+，导致列表过长

**优化方向**：
- 默认展示最近活跃的 N 个项目（如 10 个），其余折叠到"更多项目"入口
- 或引入项目归档机制，归档后不在主列表展示
- 待 Project 实体落地后根据实际数据量决定

---

## 16. 通知角标跨端同步

**相关文件**：
- `packages/web/src/core/data/stores/notificationBadgeStore.ts` — 角标状态（一期前端本地）
- `packages/hub/src/notifications/` — 通知中心（未来扩展点）

**现状（通知重设计一期）**：
- ready/permission 角标仅在前端本地 store 维护（`sessionId → {ready, permission}`）
- 进 session 详情页时清零；跨设备不同步
- 多设备场景：设备1 收 toast 产生角标，设备2 不知道；用户在设备2 上看不到角标

**后续方向**：
- Hub 维护每个 session 的未读 ready/permission 计数（runtimeState 同模式）
- 前端通过 SSE / session 查询获取，跨设备一致
- 进详情页时上报"已读"，Hub 清零
- 代价：Hub 写入 + 清理逻辑，约中等复杂度

**触发条件**：多设备使用成为常态、用户反馈角标不一致时实施

---

## 18. 通知重设计收尾清理项

通知重设计一期落地后的零散清理（均非阻塞，可独立小 PR）：

**相关文件**：
- `packages/web/src/components/layout/SidebarSessionItem.tsx` — 死代码组件
- `packages/web/src/core/pwa/registerSW.ts` + `packages/web/vite.config.ts` — SW dev 调试矛盾
- `packages/web/src/core/data/hooks/useNotificationSetup.ts` — namespace 死参数

**待清理**：
- **SidebarSessionItem 死代码**：全项目无引用（实际侧边栏用 `SessionList` 的 `@ant-design/x` `<Conversations>`）。删除避免未来误改（本次 Unit 5 曾误在其上加角标，review 才发现）
- **SW dev 调试矛盾**：`vite.config.ts` `devOptions.enabled: true` 但 `registerSW.ts` 在 `import.meta.env.DEV` 跳过 SW 注册 → dev 模式 SW 构建但不注册。如需 dev 调试 SW（push），需对齐两者（pre-existing，非本次引入）
- **useNotificationSetup namespace 参数**：当前 `void namespace` 占位（hub 从 token 解析 namespace，client 不传）。若确认未来 unsubscribe 也不需要 client 传 namespace，可删参数（YAGNI）；reviewer 评估为「尊重预留决策」，非必须改
- **测试补充**：`usePwaMode` 的 change/unmount 路径、`useNotificationSetup` 的 subscribe 失败路径，可补测试锁死行为

**优先级**：低，一期功能完整；稳定后逐项清理

---

## 19. Web 端首屏加载体积优化

**相关文件**：
- `packages/web/vite.config.ts` — 构建配置（无 manualChunks 分包策略）
- `packages/web/src/router.tsx` — 路由（静态 import 所有页面，无懒加载）
- `packages/web/package.json` — 依赖清单（含 `three` 死依赖）
- `packages/web/src/components/terminal/TerminalView.tsx` — 终端视图（`@xterm` + addons）
- `packages/web/src/components/ui/Markdown.tsx` — markdown 渲染入口

**现状**（实测 2026-06-16）：

| 模式 | 体积 | 请求数 | 说明 |
|------|------|--------|------|
| dev（vite dev）| ~40MB | ~350 | 预构建不压缩/不分包/不 tree-shake，**正常现象，不代表线上** |
| prod（dist）| 11MB | — | 主 JS `index-*.js` 3.4MB（gzip ≈ **1MB**）|

**手机端慢的真实判断**：
- dev 体积是 prod 的 ~4 倍，移动网络下加载 40MB 必然慢（1 分钟+）—— **不该用 dev 模式评估手机体验**
- 但即便 prod，首屏 JS gzip ~1MB 对远程控制工具仍偏重，手机弱网/低端机下仍慢，有真实优化空间

**dev 预构建体积大头**（`node_modules/.vite/deps` 实测）：

| 文件 | dev 大小 | 说明 |
|------|---------|------|
| `es-CdRkq_LD.js` + `es-B4a07Xbr.js` | 3.1M + 2.3M | 疑架构图/可视化传递依赖（src 无直接引用，待定位归属）|
| `@ant-design_x.js` | 1.3M | Ant Design X（AI 组件库，核心依赖）|
| `lucide-react.js` | 1.1M | 图标库（dev 全量；prod 按需 import 会 tree-shake）|
| `cytoscape.esm` | 848K | 图布局库（src 无直接引用，疑传递依赖）|
| `motion` / `katex` | 520K / 484K | 动画 / 数学公式（+ 一组 KaTeX 字体）|
| `@xterm/xterm` | 404K | 终端（仅终端页需要）|
| `highlight.js` | 220K | 语法高亮 |

**已确认的问题点**：
1. **无路由懒加载**：`router.tsx` 静态 import `LoginPage`/`SessionDetailPage`/`NewSessionPage`/`SettingsPage`，所有页面代码进首屏
2. **`three` 死依赖**：`package.json` 声明 `three`，`src` 无任何引用 → 直接删除
3. **markdown/语法高亮栈重叠**：`marked` + `@ant-design/x-markdown` + `react-syntax-highlighter` + `highlight.js` 四套并存，有去重空间
4. **`cytoscape` + `es-*` 体积最大**（dev 合计 ~6M），但 `src` 无直接引用 → 需定位是哪个库的传递依赖，评估是否必需

**已做好的**：
- `vconsole`（276K）通过动态 `import()` 按需加载，未触发不进 bundle ✅

**优化方向（按 ROI 排序）**：
1. **路由级懒加载**：`SessionDetailPage`/`NewSessionPage`/`SettingsPage` 改 `React.lazy` + `Suspense`，首屏只保留登录/列表必需代码
2. **终端懒加载**：`@xterm` + addons 动态 import 到 `TerminalView`，非终端页不加载
3. **删 `three` 死依赖**
4. **定位 `cytoscape`/`es-*` 传递依赖来源**：用 `rollup-plugin-visualizer` 做 prod 产物分析，确认归属后按需/移除
5. **markdown 栈去重**：评估四套库的重叠，统一到一套
6. **确认 `lucide-react` 按需 import**（`import { X } from 'lucide-react'`，非 `import *`）

**目标**：首屏 JS gzip 压到 400-500KB 以内。

**优先级**：中。手机端（弱网/低端机）是核心场景，prod 首屏 ~1MB 在弱网下仍慢。

**触发条件**：先用 `bun run build && bun run preview` 在手机验证 prod 真实体积（而非 dev），确认仍是痛点后再按 ROI 实施。

## 20. 多 tab 同账号 sendToast 照投打扰（边缘场景，暂不处理）

**现状**：`sseManager.sendToast` 投递给该 namespace 所有活跃连接（含 hidden），这是有意设计——后台 tab 由前端收到后转系统通知（单 tab 后台兜底，无 push 订阅时也能收到）。

**边缘场景**：同账号开多 tab，visible tab 正盯某 session（`decideToastAction` 返回 ignore），hidden tab 仍弹系统通知，绕过 ignore 语义；或 visible+hidden 并存时同一事件收到 antd toast + 系统通知两次打扰。

**为何暂不处理**：多 tab 同账号非 mobi 目标场景（个人单用户单 tab 为主）。改 `sendToast` 按 visible 过滤会破坏单 tab 后台兜底（需重新设计 `trySendToast` 决策树），投入产出比低。

**触发条件**：多 tab 同账号成为常态、用户反馈后台 tab 误弹系统通知时实施。

**相关文件**：
- `packages/hub/src/sse/sseManager.ts` — `sendToast` 投递所有活跃连接
- `packages/web/src/core/notifications/toastDecision.ts` — 前端三分支决策
- `packages/web/src/core/providers/SSEProvider.tsx` — toast 处理分支

---

## 22. session 关闭后文件浏览降级到 machine 级 handler（调研）

**背景**：InspectorPane 的文件浏览（`list-directory`/`read-file`）走 **session 级 RPC**，handler 注册在每会话子进程（`mobi claude`）里——子进程退出（session 关闭）即失效，报 "RPC handler not registered"。当前用「恢复会话」覆盖层引导用户 resume（`InspectorPane` `!active` 时早返回 resume 层）。此为与 hapi 一致的正确兜底，但意味着 session 关闭后**完全无法浏览文件**。

**相关文件**：
- `packages/cli/src/api/apiSession.ts:89` — session 级 `registerCommonHandlers(metadata.path)`（含 `listSessionDirectory`/`readSessionFile`）
- `packages/cli/src/api/apiMachine.ts:97` — machine 级 `registerCommonHandlers(process.cwd())`（runner 守护进程，已注册同款 handler，scope 前缀 `machineId:`）
- `packages/hub/src/sync/rpcGateway.ts:223,211` — `listSessionDirectory`/`readSessionFile` 走 `sessionRpc`，无 fallback
- `packages/hub/src/web/routes/sessions.ts:463` — `GET /sessions/:id/list-directory` 路由
- `packages/web/src/components/session/InspectorPane.tsx` — 当前 `!active` resume 覆盖层

**待调研方案（借鉴 hapi 未走通的思路）**：
mobi 的 runner 守护进程**已注册**一份 machine 级文件/目录 handler（`apiMachine.ts`，与 session 级同方法名、不同 scope 前缀）。理论上可让 hub 在 session 级 RPC 抛 "not registered" 时**降级到 machine 级 RPC**，用 `session.metadata.path` 作为 workingDirectory，从而 session 关闭后仍能浏览该项目的文件。

**关键不确定点**（需验证后再决定是否实施）：
1. machine 级 handler 的 cwd 是 runner 启动时的 `process.cwd()`，**不一定是目标 session 的项目目录**——多项目场景下 machine 级 handler 用哪个 cwd？是否支持按 session.metadata.path 动态指定？（hapi 的 `ListMachineDirectory` 带 cwd 参数，mobi 需确认）
2. terminal 无法降级（纯 socket 转发，必须 session 子进程在线）——本方案仅对「文件浏览」有效
3. 权限边界：machine 级 handler 绕过 session 级审计，需评估安全影响（任意 session 关闭后都能读其项目文件？）

**hapi 对照**：hapi runner 也注册了 machine 级 `ReadFile`/`ListDirectory`/`Bash`（`hapi/cli/src/api/apiMachine.ts:95`），但其 hub 路由**未实现** sessionRpc→machineRpc 的 fallback（`rpcGateway.ts:286-289` 找不到 socket 直接抛错），所以 hapi 实际也未做到 session 关闭后文件可用。mobi 若实施，需自补这层 fallback。

**决策**：暂不实施。当前 resume 覆盖层方案足够；待「session 关闭后仍需查看文件」成为明确需求、且上述 cwd/安全问题有结论后再评估。

**优先级**：低，按需触发。

---

## 24. 文件流式端点（`/read-file`）quality review 遗留项

Task 5（commit `28acf9a`，hub 流式端点）code quality review 通过，以下非阻塞项待后续评估：

**I3 — ENOENT/越权 应映射为 404/403（当前 500）**：
- `packages/hub/src/web/routes/sessions.ts` 的流式端点：`readFileMeta` 失败（含 cli ENOENT、validatePath 越权）统一返回 500
- 语义不准：文件不存在应为 404，路径越权应为 403，前端难以区分「文件没了」vs「cli 挂了」
- 方向：cli `readFileMeta` handler 区分 ENOENT 单独返回标志，或 hub 端按 error 字符串轻量映射（`/ENOENT|no such file/i` → 404，validation 类 → 403）

**I4 — suffix range（`bytes=-N`）当前返回 416**：
- 正则 `^bytes=(\d+)-(\d*)$` 不匹配 `bytes=-5`（RFC 7233 表示「最后 5 字节」）→ isRange=false → 命中 416 分支
- 影响：浏览器 `<video>` seek 末尾、`<audio>` 流式、curl `--range -N`/aria2 等会发 suffix range，当前拿不到数据
- 取决于 Task 6/7 预览方式：若 fetch 手动分片（发 `bytes=start-`）则无影响；若 `<video src>` 原生标签则需补 suffix（正则加 `(\d*)-(\d+)` 分支 + `start = max(0, size-N)`）

**M2 — sessions.ts read 类端点可抽模块**：
- 流式端点 +82 行后 sessions.ts 持续膨胀，Task 8 移除旧 readFile 后若 read 类端点（read-file + 未来 list/search）继续膨胀，可抽 `readFileRoute.ts`。当前内联合理，YAGNI。

**相关文件**：`packages/hub/src/web/routes/sessions.ts:492-581`

**优先级**：低，Task 8 收尾或 Task 6/7 预览方式定了后评估。

---

## 26. 评估是否换掉 `@socket.io/bun-engine`（触发式，非现在）

**背景**（2026-06-25）：上传流式管道（#23）定位到 `@socket.io/bun-engine` 0.1.1 的发送方向二进制附件 bug（`parser.encodePacket` 用 `Buffer.isBuffer` 判断，对 `Uint8Array` 走字符串拼接 → cli `parse error`）。已用 `bun patch` 修复（`patches/@socket.io%2Fbun-engine@0.1.1.patch`：`Buffer.isBuffer` → `ArrayBuffer.isView`，对齐官方 engine.io-parser）。

**为何现在不换**（触发式评估，不是立即行动）：
- patch 是 **1 行 + skill 维护流程**（upgrade-deps 第七步覆盖移除/迁移/重做），维护成本近乎零
- 「维护不活跃」对 patch 反而**有利**：它不更新 → patch 绑定 0.1.1 永远有效；真正风险是 bun-engine **别的 bug** 没人修，而非 patch 本身
- 换方案代价高于收益：
  - `@rvncom/socketio-bun-engine`（社区 fork）：从**官方包**换到**单人维护 fork**，信任降级，未必更稳
  - 默认 engine.io + ws：失 Bun 原生 WS + 重新引入 ws-on-Bun 兼容性赌注（这正是 bun-engine 当初要规避的）+ 全链路 E2E 回归（terminal/session/machine/upload 全走 socket）

**GitHub 现状**（2026-06-25 查证）：
- `socketio/bun-engine` 官方 issue 仅 [#8](https://github.com/socketio/bun-engine/issues/8)/[#9](https://github.com/socketio/bun-engine/issues/9) + 0 PR，无人报告此 binary bug
- 社区已有 fork [@rvncom/socketio-bun-engine](https://github.com/rvncom/socketio-bun-engine)（v1.1.5，含 bug fix + active maintenance）佐证 bun-engine 确有未修痛点
- socket.io 生态有大量同方向 binary 问题（[#3143](https://github.com/socketio/socket.io/issues/3143) server 收 Uint8Array 变 Object / [socket.io-parser #78](https://github.com/socketio/socket.io-parser/issues/78) binary 附件不解码 / [#4828](https://github.com/socketio/socket.io/discussions/4828) Bun 替换 ws 的行为差异）

**换方案的触发条件**（出现任一即重新评估）：
1. bun-engine 出了**别的、patch 修不动的 bug**（不活跃 = 没人修，致命）
2. `@rvncom/socketio-bun-engine` 证明**长期稳定 + 社区广泛采用**（从单人项目变可信）
3. socket.io 官方**明确放弃** bun-engine
4. 项目遇到 bun-engine 的**另一个阻塞问题**（那时一次性换掉，回归成本摊销）

**备选方案**（触发时评估）：
- A. 换 `@rvncom/socketio-bun-engine`（同 Bun 原生 WS 架构，迁移成本最低）
- B. 换默认 engine.io + ws（官方但失 Bun 原生性能 + ws-on-Bun 兼容回归）
- C. hub→cli 二进制段改 base64（绕过，膨胀 33% 仅内网段，半改善）

**优先级**：低，触发式。无触发信号则保持 patch 现状。

---

## 28. 中途采纳（agent 运行时新消息自动 interrupt、在 tool 边界采纳）

**背景**：排队消息功能（本次实施）落地后，消息入队默认是「轮次级」采纳——等当前 agent loop 跑完（`ResultMessage`）才被 SDK 拉取。本项是再进一步的「tool 边界级」采纳：agent 运行时用户发新消息 → mobi 主动调 `queryRef.interrupt()` → claude 在下一个安全点（当前 tool 跑完）结束本轮 → 队列里这条消息立即被采纳，实现 Claude Code TUI 那种"自然对话、随时转向"的体感。

**为何 deferred**（2026-07-12 用户决策）：
- 本次先交付 hapi 同款的「轮次级排队 + 悬浮 + 取消」体验（gated pump + invokedAt + QueuedMessagesBar + byPosition），已能独立成立
- 中途采纳要在「消息入队」与「出队喂 SDK」之间编排 interrupt 时序（检测 running 状态、interrupt 异步生效、aborted result 触发、`still_queued` 回执对账、interrupt 超时兜底），复杂度中等偏上，单独做更稳

**技术机制**（已验证，待实施时直接用）：
- SDK 官方原生支持：`Query.interrupt()`（"Only available in streaming input mode"），文档把 "Queued Messages (process sequentially, **with ability to interrupt**)" 列为 streaming input 的核心收益
- v2.1.205+ 的 `interrupt_receipt_v1` 能力：`interrupt()` 返回 `SDKControlInterruptResponse = { still_queued: string[] }`（survive interrupt 的消息 UUID），用于取消竞态对账
- 关键约束（SDK 源码 `sdk.mjs` `streamInput` 验证）：SDK 对输入流是 **eager `for await`**，拿到消息微秒级写进 claude stdin、**不门控 loop 边界**。所以"tool 边界采纳"必须靠 interrupt 主动制造提前的 loop 结束，没有第三条路（详见 spec 调研结论）

**与本次功能的衔接点**：
- gated pump 已在 `result`（含 aborted result）统一触发拉取下一条 → interrupt 只是让 result 来得更早，pump 侧无需特判
- `MessageQueue` / `PushableAsyncIterable` / `queryRef.interrupt()`（`claudeRemoteLauncher.ts:88`）本次都已就位，升级时主要加「检测 running + 消息入队即 interrupt」的编排

**Stop 语义已定（选项 2，与 hapi 一致）**：用户点停止 → `interrupt()` 当前 turn → 队列里下一条照跑（不清队列）；hapi 用 `abortController.abort()`+重启 claudeRemote 实现，mobi 用更优雅的 `interrupt()`（不重启 SDK），语义等价。此语义在本次功能中即已生效（gated pump 在 aborted result 时拉取下一条），无需等本项。

**相关文件**（本次功能落地后）：
- `packages/cli/src/claude/claudeRemote.ts` — `userInputLoop` / `sdkOutputLoop`（interrupt 编排注入点）
- `packages/cli/src/claude/claudeRemoteLauncher.ts` — `queryRef.interrupt()`、`handleAbortRequest`
- `packages/cli/src/utils/MessageQueue.ts` — 入队时机检测 running

**优先级**：中。本次轮次级体验上线后，若用户反馈"中途转向不够即时"再实施。

---

## 29. Web 字体刷新跳变（品牌字体加载导致 swap 闪烁）

**背景**（2026-07-16）：用户反馈每次刷新页面，字体渲染有明显的"先后过程"——几秒内字体从系统字体逐步变成阿里普惠体，视觉跳变明显。每次刷新都复现（即使字体已缓存，仍要重新解码）。

**根因**：
- `packages/web/src/styles/fonts.css` 用阿里巴巴普惠体 3.0，Regular 单文件约 3.8MB，加 Medium/Bold + JetBrains Mono 总共几个 MB
- 所有 `@font-face` 设 `font-display: swap`：解码期间先用 fallback 系统字体渲染，每个字重解码完依次 swap 成品牌字体 → 明显的"渐进变脸"
- `index.html` 只 preload 了 Regular + JetBrains Mono Regular，Medium/Bold 未 preload，多字重先后就绪加剧跳变
- 即使字体已被 HTTP 缓存，每次刷新仍要重新解码几 MB，swap 期依旧可见

**涉及文件**：
- `packages/web/src/styles/fonts.css` — `@font-face` 定义（`font-display`、`unicode-range`）
- `packages/web/index.html` — 字体 preload
- `packages/web/src/styles/variables.css` — `--font-sans` / `--font-chat` / `--font-sans-fallback` 字体栈

**方案**（待决策，取决于"品牌字体是否必须为硬需求"）：
1. **换系统字体**（最简单、零成本零风险）：`--font-sans` / `--font-chat` 改系统字体栈（`PingFang SC` / `Microsoft YaHei` / `sans-serif`），零加载零跳变。代价：放弃阿里普惠体品牌字体。
2. **子集化**：把阿里普惠体裁到常用字集（如 GB2312 一级约 3755 字），文件降到几百 KB，解码快到 swap 几乎不可见。**注意**：子集化后必须去掉 `unicode-range` 声明（否则声明范围内的缺失字形会显示豆腐块且不触发回退）；极少数子集外的生僻字/特殊符号会自动回退系统字体，视觉上略有字体不统一，但不影响可读性。
3. **内容淡入**：在 `document.fonts.ready` 之前隐藏内容或显示骨架，字体就绪后整体淡入。保留品牌字体与完整字符覆盖，代价是首屏短暂等待（可设超时兜底强制显示）。
4. **`font-display: optional`**：一行改动，不 swap。缓存命中且解码快时首帧即品牌字体，否则本次停留在系统字体、不再切换。大文件下"看不到品牌字体"的概率较高。

**优先级**：低（纯视觉体验，非功能阻塞）。待确认品牌字体是否为硬需求后选定方案。

---

## 30. 流式逐字渲染仍有偶发不流畅

**背景**（2026-07-16）：流式逐字渲染经过深度修复（见 [docs/architecture/web/streaming.md](architecture/web/streaming.md)）——修复了 5 层叠加问题：① React StrictMode 下 cleanup cancel raf 但 `rafRef` 未归零导致 tick 永不执行；② CLI snapshot/full 的 localId 不一致（sdkUuid ≠ body.uuid）导致 TextBlock 重 mount；③ `isStreaming` 依赖未就绪的 isRunning；④ 首批 `useState(target)` 全显；⑤ full message 后 Markdown 用 content 覆盖 display。E2E 验证 reasoning 逐字渐增（`0→11→17→23→25`）生效。但用户真实环境测试反馈"略有点问题"，仍有偶发不流畅。

**可能残留**：
- 快模型（如 glm）text 一批 snapshot 就完整，snapshot 阶段极短，逐字不明显（非 bug，模型速度限制）
- 某些时序边界（如 snapshot 到达时 isSnapshot 尚未标记、或 isRunning 状态延迟）可能导致个别批次跳变
- 多批 snapshot 间的追赶节奏（速率自适应）可能需调优

**涉及文件**：
- `packages/web/src/components/ui/useStreamingContent.ts` — 逐字揭示 hook
- `packages/web/src/components/chat/buildBubbleItems.tsx` — isStreaming 判定
- `packages/cli/src/claude/utils/streamSnapshotSender.ts` — snapshot flush 节奏

**排查方向**：复现时按 [streaming.md 的调试方法](architecture/web/streaming.md#调试方法) 加 `[BB]`/`[SC]`/`[TICK]` log，依次确认 raf 是否执行（坑 1）、snapshot/full 的 block.id 是否稳定（坑 2）、streaming 是否 true（坑 3）。

**优先级**：中。核心机制已修复，残留为偶发体验细节。

---

## 31. Tool Use snapshot 渐进式透出 partial input（方案 2）

**背景**（2026-07-23）：已实现方案 1（`content_block_start` 立即下发 `input={}` 占位，消除 Write/Edit 生成 input 期间的盲区，见 [spec](superpowers/specs/2026-07-23-tool-use-placeholder-snapshot-design.md)）。方案 1 占位期不显示 input 细节（file_path 等要等 `content_block_stop` 才出现）。

**目标**：在 `input_json_delta` 流式累积期间也节流 flush，对累积的 **partial JSON** 容错提取已完成的 key（如 `file_path`），让用户看到文件路径等参数先于完整 input 出现。

**复杂度/风险**：
- partial JSON 不完整，无法直接 `JSON.parse`——要么引入 `jsonrepair`（依赖体积），要么自写容错 key 提取（转义/嵌套/字符串未闭合的坑）
- Write 的 `content` 字段可能很大，每次 flush 都 parse + 传输，带宽与 CPU 开销上升（与 #8 带宽优化冲突，需权衡）

**涉及文件**：
- `packages/cli/src/claude/utils/streamSnapshotSender.ts` — `append(tool_use)` 标 dirty 节流 flush；`buildBlocks` 对未 ready tool_use 容错 parse 累积 input
- 前端 `ensureToolBlock` 已支持同 id input 渐进更新，无需改动

**触发条件**：方案 1 上线后用户反馈「占位期想知道在写哪个文件/什么参数」时再做。当前 YAGNI。

**优先级**：低。

---

## 32. Hub SIGTERM handler 偶发不触发（依赖 exit handler 兜底）

**背景**（2026-07-24）：生产 hub+runner 在 23ms 内同时收到 SIGTERM（进程组批量终止，见 exits.log）。最小复现实验证明 **Bun 能正常触发 `process.on('SIGTERM')` handler**（handler 执行 + exit code=0）。但 exits.log 显示 hub 那条记录是 `reason=error-exit signal=null exitCode=143`——即只有 `process.on('exit')` 兜底跑了，signalHandler 未执行。runner/cli 则正常走了 signalHandler（`reason=signal-term`）。

**现状**：已加 `installExitHandlers` 的 `onExitSync` 选项，hub 在 exit handler 里同步 `clearHubState` 兜底，避免幽灵 pid 残留。退出原因已由 `exits.log` 完整记录（含父进程谱系 ppid/parentCommand，见 P1-4）。

**未解**：hub 的 signalHandler 为何偶发不触发。怀疑信号到达时机与事件循环调度的交互（hub 长期 `await new Promise(()=>{})` 阻塞、或密集同步操作期间信号被延迟到默认退出路径）。需可重现案例才能深入。

**排查方向**：
- 用 `scripts/observe-sigterm.sh`（eslogger/dtrace）在进程外抓 SIGTERM 的发送者与时机，确认信号确实送达
- 在 hub 加一个 `setInterval` 周期性写心跳，对比信号到达与事件循环状态
- 排查 Bun 版本相关的信号处理已知 issue

**涉及文件**：
- `packages/shared/src/exitLogger.ts` — `installExitHandlers` / `onExitSync`
- `packages/hub/src/index.ts` — `exitCtx` / shutdown
- `scripts/observe-sigterm.sh` — 外部观测脚本

**优先级**：中。兜底已就位，根因待复现。

---

## 34. `Auto` 模型下 claude 子进程静默挂死（无产出、无超时、无提示）

**现象**（2026-07-26，dev 环境实测）：Web 侧选模型 `Auto` 时发送 `/code-review high 全面审查 ...`，会话永远停在 `thinking…`：

| | `Auto` | `Sonnet` |
|---|---|---|
| claude 启动参数 | 无 `--model` | `--model sonnet` |
| claude transcript | 391 字节，7 分钟只有 `enqueue`/`dequeue` 两条 | 正常产出 |
| `task_started` | 0 | 7（约 85s 出第一条） |
| Web 渲染 | 永远 `thinking…` | 「后台任务 7」正常 |

**根因（非 mobi 缺陷）**：卡死时 claude 子进程（PID 48018）已建立到 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`（cc-switch 代理）的连接，代理到上游的连接也是 ESTABLISHED，但上游始终不返回 token。`~/.claude/settings.json` 中 `API_TIMEOUT_MS=3000000`（50 分钟），故不报错、只持续等待。mobi 的事件管道正常（`f217364` 已验证），是上游无响应。

**待改进（mobi 侧可做的）**：用户完全无法区分"模型在深度思考"与"上游挂死"。可考虑：

1. **首 token 超时提示**：会话进入 running 后若 N 秒（如 90s）内未收到任何 assistant/system 输出，Web 给出可感知提示（"仍在等待模型首次响应"），而非只显示动画文案。注意 `/code-review high` 正常也需约 85s 才出第一个 `task_started`，阈值不能太激进。
2. **透出 claude 侧静默状态**：CLI 已能观测子进程有无产出，可作为 runtime signal 上报。

**优先级**：低。环境配置问题引发，但排查成本极高（表象与"skill 不派 finder"完全一致，本次耗费大量时间才定位）。

**涉及文件**：
- `packages/cli/src/claude/claudeRemote.ts` — SDK 消息流消费
- `packages/web/src/**` — running 状态文案与提示

---

## 35. HTML 预览 iframe `allow-same-origin` 安全权衡（引用资源加载 vs 隔离）

**背景**（2026-07-29）：Web 端 HTML 预览（`HtmlPreviewView` 的 `HtmlIframe`）为支持「Live Server 式刷新 + 引用外部 CSS/JS 生效」，做了两处改动：
1. iframe `key` 绑定文件 meta etag → 点「刷新」/切回窗口时 etag 变 → iframe 重建 → 重新加载最新内容（serve-file 已 `cache-control: no-cache`，连带引用资源回源验证）。
2. iframe sandbox 从 `allow-scripts allow-forms allow-popups` **加 `allow-same-origin`**。

**为何必须加 `allow-same-origin`**：sandboxed iframe 不含 `allow-same-origin` 时是 opaque origin，其加载的子资源（CSS/JS）对浏览器是 cross-site no-cors，被 **Chrome ORB（Opaque Response Blocking）** 丢弃，引用的外部样式/脚本完全不生效（实测 `style.css` → `net::ERR_BLOCKED_BY_ORB`）。加 `allow-same-origin` 后 iframe 与 mobi 同源，子资源 same-origin，ORB 不介入（实测 `style.css` → `304` 正常加载）。CORS 头（ACAO）无效——`<link>`/`<script>` 是 no-cors 模式，浏览器不看 ACAO。详见 [chromium #325432959](https://issues.chromium.org/issues/325432959)。

**安全权衡（风险）**：加 `allow-same-origin` 后，**预览的 HTML 内脚本**将能：
- ✅ **httpOnly cookie 仍安全**——JS 本就读不到 httpOnly cookie
- ⚠️ 读 mobi 的 **localStorage / sessionStorage**（同源 JS 可访问）
- ⚠️ 以用户身份**调 mobi API**（同源 fetch 自动带 cookie）

即风险从「完全隔离」放宽到「信任 cwd 里的文件」。

**当前接受的依据**：预览的 HTML 来自用户自己的 session cwd（自有 / Claude 生成），等同用户主动执行该 HTML，信任边界可接受（类 Live Server / CodePen）。用户已知情拍板接受（2026-07-29）。

**后续若要恢复强隔离 + 仍支持引用资源的方向**（目前不做，记录备查）：
1. **服务端内联引用资源**：serve-file 返回 HTML 时，把引用的本地 CSS/JS 内容内联进 HTML（`<link>` → `<style>`、`<script src>` → `<script>`），iframe 保持 opaque origin，子资源不再是独立请求。代价：hub 端解析 HTML + 读取引用文件 + 相对路径解析，复杂度中等；动态加载的资源覆盖不到。
2. **子资源走独立无鉴权静态域**：把预览资源放独立 origin（无 cookie 隔离），iframe 仍 sandboxed——但 mobi 单 origin 架构改造成本高。
3. **CSP 限制**：给 iframe 设严格 CSP 限制脚本能力，但会破坏「预览真实运行 HTML」的预期。

**相关文件**：
- `packages/web/src/components/files/HtmlPreviewView.tsx` — `HtmlIframe` sandbox + etag 刷新
- `packages/hub/src/web/routes/serveFileContent.ts` — serve-file 响应头（`no-cache`）

**优先级**：低。当前信任边界（用户 cwd 文件）可接受；待「预览不可信 HTML」成为场景再评估。

---

## 38. ~~上下文用量条展示~~（已隐藏，功能保留）

> **已隐藏（2026-08-01）**：composer sender 上方的上下文用量条（`ContextUsageThread`）统计数据不准确，先在展示层隐藏。**功能逻辑全部保留**——CLI 的 `contextUsageCalc` 计算、`runtimeState.contextUsage` 传递链、web 组件本身都未动，仅渲染处短路。

**隐藏方式**：`packages/web/src/components/composer/ChatComposer.tsx` 渲染处由模块常量 `SHOW_CONTEXT_USAGE = false` 短路。日后统计口径修正后，置 `true` 即可恢复，无需动其他代码。

**统计不准的可能方向**（未根因调查，仅记录观察）：
- `ContextUsageThread` 的 `totalTokens` 取「最后一条 assistant 的 input+cache_creation+cache_read」，但多 assistant 消息/并发 agent 时会叠错基数；
- 百分比按 `totalTokens / maxTokens`，但 maxTokens 是 `result.modelUsage[model].contextWindow`，不同 model 窗口混算时比例失真；
- 未计入 tool_result 输出、system prompt 等占用。

**相关文件**：
- `packages/web/src/components/composer/ChatComposer.tsx` — 渲染处短路（隐藏点）
- `packages/web/src/components/composer/ContextUsageThread.tsx` — 展示组件（保留）
- `packages/cli/src/claude/utils/contextUsageCalc.ts` — 计算（保留）
- `packages/shared/src/schemas.ts` — `ContextUsage` 类型（保留）

**触发条件**：重做统计口径时（需要把「什么是准的占用」定义清楚），再恢复展示。

**优先级**：低（展示层隐藏，不阻塞功能）。

## 40. 消息列表：Bubble.List 全量渲染已恢复，数据层窗口化（第二步）待做

**状态**（2026-08-03）：方向已定 —— **抛弃 react-virtuoso 虚拟化，切回 antdx Bubble.List 全量渲染**。第一步（恢复 Bubble.List 完整态）已完成并 E2E 验证；第二步（数据层窗口化钳制 DOM）待做。

### 决策过程

react-virtuoso 虚拟化（#10）落地后，**prepend 后持续上滚跳动**严重（估高→RO 实测异步修正，14 次跳动/收缩 3509px）。修复路径逐条排除：

- **内容估高启发式**（`heightEstimates`）不可行：`content` 是 ReactNode（markdown/代码块/工具卡），高度与字符数无关；`maxHeight` 组件（折叠态受 CSS 限高）、group 计算（折叠 vs 展开高度差极大）使估高对离群 item 必错。
- **离屏预实测**（A）准但复杂（离屏渲染须与真实渲染同 CSS/markdown）。
- **加大 `increaseViewportBy`**（B）依赖 virtuoso RO 异步测量，未验证。
- **数据层窗口化**（C，参考 hapi）彻底消除跳动（全量真实高度，无估高无修正），代价是 DOM 随总量增长 → 需 window 钳制。

最终选 C：抛弃虚拟化，Bubble.List 全量渲染。理由：虚拟化的所有坑（估高跳动、firstItemIndex、key 碰撞、遮罩、followOutput trap、scroll-fight）都是虚拟化副产物，全量渲染全部消失；唯一代价（DOM 增长）由第二步 window 解决。

**为何不照搬 hapi**：hapi `message-window-store` 自管 cache（不靠 react-query），因为 react-query infinite query 保留所有 pages 的模型与"trim 旧页省内存"冲突。mobi 用 react-query 管 messages，故 window 走 **bubbleItems 层 trim**（B）——不动数据层、零 trace 断裂风险（mobi `reduceChatBlocks` 的 sidechain parentUUID 链 / tool_use-result 配对在 messages 层 trim 会断），契合 react-query。详见 brainstorming 决策记录。

### 第一步：恢复 Bubble.List 完整态（✅ 已完成）

**改动**：
- 新建 `packages/web/src/components/chat/BubbleListChat.tsx`：antdx `Bubble.List`（`autoScroll={false}`）+ `useStickToBottom`（适配 `.ant-bubble-list-scroll-content`）+ 恢复 prepend 维持 scrollTop（`pendingRestoreRef` + useLayoutEffect delta pin）/ fill 级联 / 顶部 skeleton / prefetch。
- `ChatContainer.tsx`：`VirtuosoChatList` → `BubbleListChat`，CSS 回到 `.ant-bubble-list-scroll-box/content` 式。
- `useStickToBottom.ts`：内容层 selector `[data-testid='virtuoso-item-list']` → `.ant-bubble-list-scroll-content`，逻辑（手势 stop / 几何 re-follow 延时 / smooth 门闩 / pointerDown 守卫）全保留。
- 删 `VirtuosoChatList.tsx` + `VirtuosoChatList.test.tsx`（虚拟化代码留存于 tag `chat-list-virtualized`，已 push）。

**E2E 修复的一个 bug**：`BubbleListRef.scrollBoxNativeElement` 在 `useLayoutEffect` 时为 null（antdx 内部 effect 时序晚于父组件 useLayoutEffect），导致 scrollBoxRef 不设、RO 拿不到 scroller。改用 `querySelector('.ant-bubble-list-scroll-box')`（旧代码方式，不依赖 ref 时序）。

**E2E 验证**（cp dev DB 副本 213 条会话）：

| 项 | 结果 |
|---|---|
| 渲染（Bubble.List 结构） | ✅ scrollBox/content DOM |
| 初始贴底 | ✅ dist=-1，RO fire |
| 流式期贴底 | ✅ 全程 maxDist=0 / over80=0 帧 |
| 流式期 DOM 稳定 | ✅ 10 bubble 0 重建 |
| prepend 历史加载 | ✅ 33→65 bubble |
| prepend 维持视口 | ✅ scrollTop=0+delta，原首项仍在视口 |
| prepend DOM 稳定 | ✅ 原 33 bubble 0 重建 |
| useStickToBottom 协调 | ✅ wheel following=false，RO 不破坏 restore |

**保留**（期间优化全部保留）：`reconcileChatBlocks`/`reconcileBubbleItems` 结构化共享、`buildChatBubbleItems`、`CollapsibleUserMessage` RO measure、`FilePathText` CSS ellipsis、streaming 修复、通知系统、所有 `domain/chat` 逻辑。

### 第二步：数据层窗口化（C-2 已完成，C-1 待做）

**C-2（store 去.pages + 渲染层 window）已完成（2026-08-04）**：新建 `messageWindowStore`（自管 external store，扁平 `DecryptedMessage[]` + 独立游标 + generation 防竞态）替代 `useMessages` 的 `useInfiniteQuery`（消除 react-query pages + SSE append page[0] 三重不匹配）。store 全量不 trim（C-2 钳 DOM 不钳内存）。trim 推到 BubbleListChat 渲染层（reduce 之后，sidechain 天然完整）。window 动态 N [400, 800]（对齐 hapi 双阈值）+ 贴末尾⇄滑动状态机 + N=800 offsetTop restore。SSE/optimistic/submitted/cancel 全改调 store action。单测 1411 + typecheck + lint 全绿。spec: `docs/superpowers/specs/2026-08-03-message-window-store-design.md`，plan: `docs/superpowers/plans/2026-08-03-message-window-store.md`。

**C-1（store 层 turn 边界 trim 钳内存）待做**：在 store 加按 turn 边界 trim（user message + compact-summary + context-cleared 为 turn 起点，保整 turn 保 sidechain）。前提待验证：sidechain ⊆ turn（SDK Task 同步阻塞，子任务不跨 user message 边界）——实测 sidechain seq 分布确认。

**E2E 验证**：C-2 window 滑动/N=800/offsetTop 单测覆盖不到（jsdom offsetTop=0），E2E 受 dev session 恢复环境限制（runner 不恢复 demo session），留实机测（deploy 含 C-2 二进制后真机验证 window 滑动 + N=800 裁顶 + offsetTop restore + 重连补拉 merge + 流式 snapshot update）。

**相关文件**：
- `packages/web/src/components/chat/BubbleListChat.tsx` — Bubble.List + useStickToBottom + restore/fill/prefetch
- `packages/web/src/components/chat/useStickToBottom.ts` — 贴底跟随（适配 Bubble.List）
- `packages/web/src/components/chat/ChatContainer.tsx` — 数据流（reconcile/streaming/通知）

**相关 memory**：[[project_bubble-list-virtualization]]（虚拟化已废弃，tag `chat-list-virtualized` 留存）、[[project_virtuoso-mount-flicker]]/[[project_scroll-fight-pointer-drag]]/[[project_virtuoso-prepend-firstitemindex]]/[[project_virtuoso-followoutput-trap]]/[[project_virtuoso-key-collision]]（virtuoso 踩坑记录，方向已废弃但留作参考）。

**优先级**：高（长会话 DOM 增长会卡顿，需 window 钳制）。

---

## 41. 会话产出「知识化」——可检索的个人 coding 工作日志

**背景**：mobi 的 hub SQLite 里躺着每一次重构、每一次 debug、每一次架构决策的完整会话记录，但目前**用完即弃**——对话流走完就没人再看。这是 mobi 最大的未开发价值。

**痛点**：「上周 Claude 是怎么修那个 race condition 的？」「上次给那个模块加测试，它的思路是什么？」现在完全没法查，只能人肉翻会话。

**为何是 mobi 独有的机会**：CC TUI 是单会话、不留痕的；mobi 天然汇聚了用户所有会话的完整数据。这个数据资产别人没有，mobi 有，却没开发利用。把 mobi 从「远程查看器」升级成「个人 coding 工作日志/知识库」，是产品定位的质变。

**待探索方向**：
- 跨会话全文检索（会话内容 + 文件路径 + 工具操作）
- 会话摘要（每条会话自动生成「做了什么/改了哪些文件/结论」的结构化摘要）
- 按项目/时间/关键词聚合的工作日志视图

**技术成本**：低。数据已在 hub（SQLite + 全量消息），缺的是检索索引 + 摘要生成 + 查询 UI。不涉及核心管道改动。

**优先级**：高。投入小、回报是产品定位跃迁，且具备数据独占性。

---

## 42. 多会话「指挥中心」视图

**背景**：重度使用的真实形态不是「一个会话」，而是**同时开多个 Claude 改不同模块**。但 mobi 的 UI 仍停在单会话心智——切进切出，看不到全局。hub 本就是中心化的，天然拥有跨会话视角，缺的是把这个视角做出来。

**痛点**：同时跑 3 个会话时，手机上无法一屏掌握——谁在跑、谁卡在审批、谁先完成了、谁的 context 快满了。得逐个点进去看。

**与既有探索的区别**：记忆中暂停过的 Task Rows 探索（`.mobi/uploads` 源码）是**单会话内**把扁平对话结构化成任务进度；本项是**跨会话**的全局编排视图，方向不冲突。

**待探索方向**：
- 全局会话状态看板（活跃/等待审批/已完成/context 占用，一屏概览）
- 跨会话事件流（按时间合并多会话的关键事件：完成、卡审批、报错）
- 会话间产出对齐（多会话改同一模块时的冲突预警）

**技术成本**：中。hub 数据已就绪，主要工作在 web 端新增跨会话聚合视图 + 查询。

**优先级**：中。差异化最强，但依赖「多会话重度使用」是否为真实场景——若平时只开一两个会话，优先级下调。

---

## 43. 弱网下「关键消息必达」——投递分层

**背景**：pending 里的 bundle 瘦身（#19）、字体子集化都是「加载快一点」，但移动场景的**本质痛点**是断网（地铁、电梯、切换基站）。mobi 现在是纯 SSE 流，**一断全断**——Claude 在等我审批一个 `rm`，我刚好进电梯没信号，这条 permission 就静默丢了。

**痛点**：关键事件（permission/ready/重要里程碑）没有比普通对话更强的投递保证，与聊天一起走 best-effort SSE。

**待探索方向**：
- **消息分级**：permission/ready/里程碑等「必须响应」事件走可靠通道；普通对话流才走 best-effort SSE
- **可靠通道**：离线缓存（断网期间关键事件落盘）+ 重连必达（补拉未确认事件）+ Web Push 兜底（SW 独立线程，长时后台可靠）
- **现状基础**：Web Push 基建已就绪（visibility 分级投递在用），可在此基础上加「关键事件必达」语义

**技术成本**：中高。要重构投递分层（消息打标 + 客户端确认 + 补拉协议 + 离线缓存），动到 SSE/通知核心链路。

**优先级**：中高。直接补「移动」这个核心场景最疼的洞，是「桌面思维迁移到移动」与「真正为移动设计」的分水岭。

---

## 44. teammate 残留清理 — 已完成的 subagent 条目滞留 teamState

**背景**（2026-08-13）：用户在 teamState 面板看到 **34 个 teammate 全部归属同一会话**——正好是「项目实体化」subagent-driven 开发派出的全部 agent 数（10 任务 × 3 agent + E2E + 终审 + 修复 + 文档同步 = 34）。它们早已完成退出，但条目一直挂着。

**根因**：SDK 的 `TeammateIdle` / `TaskCompleted` hook 回调可获取队友完成事件（见 #11 调研结论），但 mobi **未消费这类事件做 teammate 清理**——条目写入 `runtime_state.teamState` 后无生命周期出口。且 teamState 随 session runtimeState **落库持久化**，父会话结束后仍残留，直到该会话 runtime state 被重置。

**影响**：
- 无资源占用（进程已退出），纯展示层脏数据
- 长会话多派几次 subagent 即重演，越积越多

**方向**：
- 消费 teammate 完成/空闲事件（SDK `hooks` option 的 `TeammateIdle`/`TaskCompleted` 回调，即 #11 已验证可行的方案）→ 从 teamState 移除对应条目，或至少标记为已完成态
- 顺带定义「父会话结束后 teamState 的生命周期」（清空/归档）
- 落在 `.scratch/task-state-sync/` 那批 runtime state 同步问题的延长线上

### 现象二：「清理团队状态」清不掉（2026-08-13 实测）

用户点 TeamAgentPanel 的清理（`clearField="teamState"`）→ teamState 不消失。

**已核实的链路（这部分代码是对的）**：
- UI → `PATCH /api/sessions/:id` `{clearFields:['teamState']}` → `store/sessions.ts clearRuntimeStateFields`（DB JSON 删键 + seq+1）→ `sessionCache.clearRuntimeStateFields`（刷内存 + SSE `session-updated` 携带完整 runtimeState）
- web SSE 侧 `'runtimeState' in delta` → `runtimeStateReplace=true` 全量替换（缺失键会被移除），补丁语义无问题

**根因假设（待验证，证据充分）**：teamState 是**派生态**，派生源是消息历史——`sessionHandlers.ts` 的消息处理对每条含 `Agent`/`Task` tool_use 的消息调 `extractTeamStateFromMessageContent` → `applyTeamStateDelta` 加 member（隐式团队名即 `session-XXXXXXXX`，34 个 member 来自历史里 34 次 Agent 派发）。而该处理路径**会被 resume/重连重放**（`sessionHandlers.ts:274` 注释明说「resume 重放时……」）——清掉派生缓存后，任何一次重放历史消息都会从消息历史**重建** teamState。即：清理只清了缓存，没清（也不该清）派生源，重放即复活。

**修复方向（一并解决）**：
- 派生与清理的优先级：用户清理应记 tombstone（如 runtimeState 记 `_teamStateClearedAt`），重放重派生时早于该时间点的 delta 不再产生 teamState（或：重放路径整体跳过 teamState 重建，只信 live 增量）
- 结合现象一：正常出口应是 teammate 完成/团队结束事件，而非靠手动清理；手动清理则是「重置派生基线」语义

**相关文件**：
- `packages/cli/src/claude/claudeRemote.ts` — SDK `hooks` option 配置点（#11 同款）
- `packages/hub/src/sync/teams.ts` — team state 提取
- `packages/web/src/core/data/` — teamState 展示

**优先级**：中。脏数据影响观感且会累积；实现路径已被 #11 调研铺过一半。

## 45. 项目列表真分页（后端 cursor 分页）

**背景**（2026-08-14）：侧边栏「项目」分区列表已做**前端分页**（`usePagedSectionList`：默认 5 个 + 展开剩余/收起），但数据仍是 hub `GET /projects` 一次性全量返回。

**触发条件**：项目数量显著增长（几百+）时，全量拉取 + 全量内存排序（`getProjects` 的 `MAX(s.updated_at)` 派生排序）成为负担，需要真分页。

**方向**：
- hub `GET /api/projects` 加 cursor 分页（参照 `paginateSessions` 的共享 CTE 分页方案：cursor + total + hasMore）
- 注意排序键是派生的「组内会话最新活动」（`COALESCE(last_active_at, p.updated_at)`），cursor 需锚定该排序值而非纯 id——换页期间会话活动导致的排序漂移要考虑（sessions 分页同款问题的项目版）
- web `useProjects` 迁移到 `useSessionIdsPages` 同款 infinite-query 工厂 + `usePagedSectionList` 的触底后端分页模式（现成骨架，替换数据源即可）
- `AssignProjectModal` / 新建会话项目下拉等全量消费方按需保留全量接口或提高单页上限

**优先级**：低。当前项目量级（个位/十位）下无感知；等量级上来再做。

---

## 46. supervisor 已知边界

- `supervisor.stop/shutdown` 仅发 SIGTERM，子进程挂起信号时 finish 永不完成——需加宽限期 SIGKILL 升级
- `cleanupOrphans` 按持久化 pid 探活击杀，存在 pid 复用误杀理论风险
- `runSupervisor` 编排层零单测覆盖（finish 幂等/idle 竞态/onEmpty 路径仅靠人审），值得补注入式 fake server 测试
- B 路径 launchd/systemd 真机验证未做（安装/开机自启/KeepAlive 拉起/空退出不重拉）
- `hub start-sync` 直接调用时无端口范围校验（仅 service start/restart 经 parseHostPortArgs 校验）
- **`hub start` 不读 profile 的端口配置**（2026-08-15 E2E 踩坑）：supervised 路径端口来自 desired state，空则兜底 2222（default 环境端口）——`mobi hub start --profile e2e` 不带 `--port` 会与 default 环境 hub 撞端口，且 supervisor 健康门可能打到 default hub 上假通过。desired state 初始化时应参考 profile 端口配置

---

## 47. 桌面端应用（macOS）— 可行性结论与技术选型（2026-08-15 探索）

**背景**：探索 mobi 桌面化。需求已澄清：核心动机 = 本地一体化零部署 + 原生体验（Dock/通知/菜单栏）+ 降低分发门槛；CLI 留在系统终端（桌面 app 只承载 Web UI）；先只做 macOS；本地 hub 保留局域网多端访问（手机 PWA 不受影响）。

**核心结论**：**可行性高，mobi 核心改造量接近零**。mobi 二进制已是「hub + runner + Web 资产」自包含单体（bun `--compile`，~93MB），supervisor 已解决「托管 hub+runner、崩溃退避重启」。桌面化的本质是给它套一个原生壳。

**架构（sidecar 模式）**：

```
mobi.app（dmg 分发）
├── 原生壳（Tauri 或 Electron）    ← 窗口、Dock、通知、菜单栏、自动更新
├── mobi 二进制（sidecar，现有产物） ← 启动时等价 mobi service start（复用 supervisor 探活/复用）
└── WebView                        ← 加载 http://127.0.0.1:<port>（现有 Web UI 零改动）
```

行为模型：打开 app = 自动 `mobi service start`（已运行则复用，supervisor IPC 探活可判断）；`mobi claude` / 浏览器 / 手机 PWA 全不受影响——同一个 hub 实例。关窗口可收进菜单栏，hub 继续跑。

**壳技术栈对比**（2026-08-15，Tauri 2 文档已核实 sidecar/updater 为一等公民）：

| 维度 | Tauri 2 | Electron |
|---|---|---|
| 安装体积 | ~110MB（壳只占 ~15MB） | ~250MB+（Chromium ~160MB 叠加） |
| 运行内存 | WKWebView 共享系统 WebKit，~150-250MB | 独立 Chromium，~300-500MB |
| 拉起 mobi | Rust shell plugin spawn（几十行 Rust） | Node child_process（TS 最顺手） |
| 壳自动更新 | updater plugin（签名更新） | electron-updater（最成熟） |
| 签名公证 | 均需 Apple Developer $99/年，工作量相当 | 同左 |
| Web UI 兼容性 | ⚠️ WKWebView 的 SSE/Web Push 行为需实测（WKWebView 不支持 Web Push） | ✅ Chromium 与浏览器一致，零风险 |

**推荐**：Tauri（常驻菜单栏型应用对体积/内存敏感，Rust 代价集中在壳层一次性投入，估 <1000 行）。**建议先做半天级 PoC**（壳 + 手动 `mobi service start` + WebView 加载现有 Web UI，验证 SSE/Socket.IO/cookie 登录在 WKWebView 的实际行为），通过则定 Tauri，不通过退 Electron。

**两个与壳选型无关的共同改造点**（真正要动 mobi 的地方）：
1. **通知桥**：Web 通知走 Web Push（PushService/NotificationHub），WKWebView/Electron 渲染进程都收不到——桌面端通知需 Web UI → 壳层事件桥（Tauri emit / Electron IPC → 原生通知）
2. **登录态注入**：app 自己拉起的 hub 应自动注入信任凭证跳过 JWT 登录界面（hub 侧能力，「零部署」体验的关键）

**mobi 二进制更新**：与壳无关——复用现有 `mobi upgrade`，或随壳捆绑新版。

**状态**：探索结论已记录，待决策是否启动（先 PoC 验证 WKWebView 兼容性）。

**优先级**：待用户决策。
