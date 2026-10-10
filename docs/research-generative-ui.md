# Generative UI / Intelligent UI 调研（2026-10-09）

> 调研对象：ChatGPT Intelligent UI（GPT-6，2026-10）及其三个开源对标——a2ui（Google）、json-render（Vercel）、openui（Thesys）。
> 调研方式：一手源直读（官方仓库/博客/规范）+ deep-research 工作流（104 子代理、22 源、110 条声明、top-25 三票对抗核查全部确认）。
> 定位：为「mobi 会话输出内嵌可交互富 UI」选型。结论与 spec 见 `.scratch/generative-ui/`。

## 总评

四家在解同一个问题——**agent 输出不止 markdown，而是受限组件目录内的可交互 UI，流式渲染、本地交互、零额外模型调用**——但收敛出了两条路线：

1. **声明式组件协议**（a2ui / json-render）：模型只产受 catalog 约束的 JSON，客户端用自己的组件库渲染，零模型代码执行。
2. **沙箱代码交付**（ChatGPT DIL / Anthropic MCP Apps / AppBlock）：模型写 DSL 或完整 HTML/JS，服务端/客户端编译后在沙箱（Web Worker / iframe）里执行。

mobi 的 ADR 0007 安全基线天然倾向路线 1；路线 2 作为逃生舱保留（现有 `:mobi-artifact` iframe 渠道即等价物）。

---

## 一、已验证事实（三票对抗核查全票通过）

### 1.1 A2UI（Google，Apache-2.0，16.6k★ / 1,383 commits，2026-10-09 快照）

| 维度 | 事实 |
|---|---|
| 版本 | **v0.9.1 生产**（`application/a2ui+json` MIME）/ **v1.0 RC**（草案期 v0.10；新增 client-to-server RPC `actionResponse`、action IDs、theme→surfaceProperties；规范 2025-11-20 创建、2026-06-08 更新）/ v0.8 legacy。v1.0 目标 **2026 Q4 定稿**，官方自标 early-stage public preview「Expect changes」 |
| 格式 | **扁平组件列表 + ID 引用**（adjacency list）：树结构隐式构建，组件可乱序发送，root 到达即渐进渲染（缺失引用渲染占位符）；Agent SDK 边流式解析边 heal 残缺 LLM JSON；消息协议提供 `createSurface/updateComponents/updateDataModel` 增量更新。v1.0 新增 Single-Message UI Instantiation（初始树内嵌） |
| 安全 | 线格式层面**零模型代码执行**，且为**协议强制**：v1.0 规范（1453 行逐字核验）要求每个渲染函数声明 `allowedCallers`（rendererOnly/agentOnly/rendererOrAgent），渲染器运行时以 `INVALID_FUNCTION_CALL` 拒绝越权调用。⚠️ 「Smart Wrapper / 信任阶梯」**不在协议里**（spec 全文 grep 无此术语），属渲染器文档层——自定义组件路径把安全责任显式移交给开发者（README 原文「places security firmly in the developer's hands」） |
| 传输 | transport-agnostic，**官方绑定含 MCP**（tool calls / tool outputs / resource subscriptions）+ AG-UI（标准绑定）/ A2A / SSE / WS / REST |
| 渲染器 | React / Flutter / Lit / Angular 官方（roadmap 自标 ✅ Stable，README 仍称 evolving），共享 `@a2ui/web-core` 库；AndroidX a2ui-compose 1.0.0-alpha01（2026-09-23）。内置组件集 Standard→**Basic** 更名，定位 fallback 不推荐 |
| 治理 | Google 创建，CopilotKit 为 spec 设计伙伴（非主要代码作者） |

来源：[a2ui.org](https://a2ui.org) · [v1.0 规范](https://a2ui.org/specification/v1.0-a2ui) · [GitHub](https://github.com/a2ui-project/a2ui) · [Google 官方博客](https://developers.googleblog.com/a2ui-v0-9-generative-ui) · [InfoQ](https://www.infoq.com/news/2026/07/google-a2ui-genui)

### 1.2 json-render（Vercel，Apache-2.0，18.5k★ / 231 commits）

| 维度 | 事实 |
|---|---|
| 架构 | **catalog/registry 双件护栏**：`defineCatalog`（Zod typed props + actions + 组件描述）约束 AI 只能产 catalog 内 JSON；`defineRegistry`/`Renderer` 把 catalog 类型映射到宿主实际组件；`catalog.prompt()` 直接生成 system prompt（含组件描述/props schema/可用 actions）。模型只产 JSON 不产代码；`$computed` 只调宿主注册函数 |
| wire 格式 | `{root, elements: {id: {type, props, children: [ids]}}}`——与 A2UI 独立收敛于**扁平 + ID 引用**结构（差异：a2ui 扁平数组+容器内 child IDs，json-render ID 键控 map+统一 children 字段）；另有 `@json-render/yaml` 线格式编译到同一 spec |
| 流式 | **SpecStream 增量编译**：`createSpecStreamCompiler` 逐 chunk push 返回 `{result, newPatches}` 立即可渲染；JSONL 每行一条 RFC 6902 JSON Patch（RFC 6901 Pointer 路径）；YAML 线格式同样带流式解析器 |
| 状态 | 声明式交互闭环（无需模型往返）：`$state` / `$cond/$then/$else` / `$template` / `$computed` / `$bindState` 双向绑定 / 内置 `setState` action（自动重算可见性与动态 props）/ 元素级 `watch`（值变化触发 action，非首渲染）。**幸存证据中最完整的客户端状态故事** |
| Claude 集成 | `@json-render/mcp`（0.21.0，2026-09-18）现成接入 Claude/ChatGPT/Cursor/VS Code——走 **MCP Apps iframe HTML bundle 路径**，与 React 内嵌渲染是两条架构路径 |
| 组件 | `@json-render/shadcn` 36 个 Radix+Tailwind 组件，双入口：`/catalog`（零 React 依赖的 Zod 定义，可服务端复用）+ 主包（React 实现）。registry 架构明确支持替换为自有设计系统 |
| 风险 | 0.x 无 API 稳定承诺，曾出现 3 个月发布间隔；「matches your schema, every time」是营销——实际机制是 prompt 引导 + Zod 校验，**非服务端受约束解码**；catalog 非完整 XSS 防线（href/alt 等字符串 props 仍由 AI 提供） |

来源：[GitHub](https://github.com/vercel-labs/json-render) · [json-render.dev](https://json-render.dev)（[streaming](https://json-render.dev/docs/streaming) / [a2ui](https://json-render.dev/docs/a2ui)）· [InfoQ](https://www.infoq.com/news/2026/03/vercel-json-render) · [LogRocket](https://blog.logrocket.com/vercel-json-render-dynamic-ui)

### 1.3 交叉验证结论

- **「扁平 + ID 引用」是行业共识**：a2ui 与 json-render 独立收敛，结构层级等价。
- **a2ui ↔ json-render 互认**：Google 官方声明 json-render 已把 A2UI 支持作 PoC；json-render 文档确认原生支持 A2UI；a2ui.org 渲染器名录收录 json-render。跨组织互操作，非同一团队。
- **OpenUI 的「省 53-67% token」未经独立证实**：厂商自测——tiktoken 静态计数（GPT-5 编码器，非模型实际输出）、7 个自选场景、对照格式自选；有第三方评审确认 benchmark 套件在仓库可复现，但无人独立重跑。新基准（openui.com）自称对 A2UI 1.8-2.6× 成本优势，同为厂商自测。
- **Anthropic 官方 Agentic UI 路线是 MCP Apps**（2026-01-26 发布，Claude web/desktop 内建）：resource-first `ui://` URI 指向预构建 HTML/CSS/JS，宿主沙箱 iframe 渲染——**不是声明式 JSON 协议**。（此条经源抓取，未进 top-25 核查集，按中高置信对待。）

## 二、一手来源、未交叉验证（按厂商自述打折）

### 2.1 OpenUI / OpenUI Lang（Thesys）

- 行式声明 DSL（v0.1 规范）：每行一条 ID 绑定语句，首行必须绑 root，流式优先；官方对比表自称 token 1x（vs json-render 3x / a2ui 3x / CopilotKit 4x）、内置 chat UI、自带数据获取——**全部为厂商自述**。
- 提供 `@openuidev/a2ui` 桥接 A2UI 协议（自己承认协议层以 A2UI 为准）。
- ~~许可仅「terms described in LICENSE」（非标准 OSS 措辞）~~ **已修正（2026-10-10 用户核实）**：GitHub repo 实为 MIT。

### 2.2 ChatGPT Intelligent UI（GPT-6，2026-10）

来自 [Thesys 逆向报告](https://www.openui.com/blog/how-chatgpt-intelligent-ui-works)（单一利益相关方，方法论详实：流量抓包 + bundle 逆向 + 编译器字节级复刻）：

- **DIL 推理格式**：Markdown + JSX 式组件标签 + `{@body}` JS 状态语句 + `{expression}` 插值 + `{#if}/{#each}`。
- **服务端编译**为 JS program + constants 表（存 `model_dil_v2`）：表达式包 `__dilSafe` 错误隔离、静态文本外移 constants、状态注入稳定 key（跨重编译存活）、半成品截断修复（未闭合标签自动闭合/丢弃 + recoveryDiagnostics）、catalog 校验剥非法属性。
- **客户端运行时**：沙箱 iframe + Web Worker（lockdown 移除网络/定时器/消息/eval 后冻结全局，`new Function` 求值，watchdog 超时隔离），产出 UI ops（二进制 diff）由主线程原生组件绘制；函数只传 `fn#1` 标识符。
- **交互不调模型**：滑杆等在 worker 内改状态返回增量 ops；`GenUI.issueNewTurn/copy/openUrl` 是逃逸出口（回灌为新用户消息）。
- **数据不经模型转写**：`AsyncImage`/`Entity`/`Cite` 由服务端解析后 patch 进响应；工具结果按 ID（`turn448791product0.displayed_price`）引用。
- **AppBlock 逃生舱**：自包含 HTML/CSS/JS 在独立域 iframe（共享 Tailwind base + 主题变量 + 尺寸自适应）。
- **已知毛边**（mobi spec 的反面清单）：流式全量重编译重发（重发代码占 83% 带宽，275KB patches / 6.3KB 文本）；交互重发未变属性（一次点击 158 ops 仅 4 个有效）；刷新丢状态；模型看不到 UI 状态；follow-up 永远重生成而非修改；表达式静默失败（逻辑错误无检测）；无效属性诊断不回灌模型。

## 三、对 mobi 的裁决性事实

1. **mobi 是宿主**——组件目录、渲染器、状态模型都在 mobi 手里，`@json-render/mcp` 的 iframe 路径不适用，应走 React registry 内嵌路径。
2. **a2ui 的 MCP 绑定是传输最短路径**——mobi 会话进程已有 host-owned MCP 基建（agent-apps），A2UI 消息可直接复用该通道。
3. **ChatGPT 的全量重编译流式策略不要抄**——json-render 的 JSONL patch（RFC 6902）增量模型与 mobi SSE 管线契合度最高。
4. **工具结果 ID 绑定**与 mobi turn journal 天然对口（防模型转写数据出错）。
5. **`GenUI.issueNewTurn` 的等价物**在 mobi 有现成落点（消息受理 deep module / composer backfill）。
6. **OpenUI 落选理由（2026-10-10 修订）**：~~许可模糊~~（用户核实实为 MIT，已修正）；核心卖点（token 效率）是厂商自测且对 mobi 非约束项；自造 DSL 对 Claude 输出可靠性是负资产（A2 实测已部分证伪：17/17 解析）；单一公司治理仍成立。若将来 token 成本成为瓶颈可重评。

## 四、开放问题（spec 需裁决或跟进）

- Anthropic 是否会有声明式 Generative UI 的原生 roadmap（现有官方路线是 MCP Apps 沙箱 iframe）。
- A2UI v1.0（2026 Q4）相对 v0.9.1 的完整破坏性变更集（幸存声明只覆盖三条，evolution guide 另有 catalog 组合性破坏变更）。
- SpecStream patch 流与 XMarkdown append-only 流式假设的兼容成本（PoC 验证）。
- a2ui ↔ OpenAI 是否互认标准（本轮无证据）。

## 五、ZCode 实况（2026-10-09 源码核查）

ZCode（本地 v3.14.3 源码，`~/workspace/github/study/ZCode/`）**没有 generative-ui 框架实现**：无 a2ui/json-render/openui 依赖（pnpm-lock 零命中）、无组件目录/spec 渲染器、无模型自述组件树通道。它有的是一条窄交互路径：

- **`AskUserQuestion` 工具**（`contracts/src/tools/ask-user-question.ts`）：结构化选项卡——1-4 个问题 × 2-4 选项，multiSelect，每选项可带 `preview`（HTML **片段**）。preview 在 Zod 契约层就做了边界：禁 `<script>/<style>`、禁 html/body/doctype、必须是片段。答案经 interaction-broker 收集后回填为工具结果，UI 侧折叠视图（`ToolCallBlocks/renderers/ask-question.tsx`）只渲染问答文本，交互态在独立 interaction 通道。
- 本质是「**交互卡 = 特化工具调用**」，与 mobi 的权限审批弹窗同族，不是自由组合的生成式 UI——组件词汇固定（question/option/preview），无声明式状态、无流式渲染。

对 mobi 的含义：ZCode 未趟过这条路，无可抄实现；其「交互卡收口为单个工具 + 契约层 sanitize」的做法值得在 catalog 组件（如 Form/Button）的输入边界设计中借鉴。

## 六、Open Intelligent UI（CopilotKit，2026-10-10 调研）

仓库 [CopilotKit/OpenIntelligentUI](https://github.com/CopilotKit/OpenIntelligentUI)，MIT，1.7k star / 220 fork / 157 commits（新项目）。README + docs（architecture / visualization-routing / interactive-answers / bring-to-your-app，raw 直读）。**栈：Next.js 前端 + CopilotKit runtime + AG-UI 协议 + Python Deep Agent（LangGraph/FastAPI）**——与 mobi 的 bun/TS + Claude Agent SDK 栈不兼容，不可直接引入；价值在架构验证与契约设计。

### 架构（与 ChatGPT 同题对照）

| 维度 | Open Intelligent UI | ChatGPT |
|---|---|---|
| 双层 | A2UI（仅 Table catalog）+ 沙箱自定义 UI（**主体**：chart/diagram/calculator/map 全走它） | Native UI（主体，70 组件）+ AppBlock（逃生舱） |
| 沙箱 UI 形态 | `generateSandboxedUi` 工具 → 流式 HTML/CSS/JS 进 Websandbox iframe | AppBlock 原始 HTML 进双层 iframe |
| 沙箱 UI 流式 | **有序契约**：initialHeight → placeholderMessages → css → html → jsFunctions → jsExpressions；CSS 完成前保持 placeholder，先渐进更新预览 iframe，最终初始化正式 iframe | 无（AppBlock 完成后一次性出现） |
| 呈现决策 | **独立路由器模型 Jev**（TypeSafe System One 商业 API，`jev-latest`）每条用户消息决策一次：text / table / chart / diagram / calculator / map；无静默 fallback（Jev 失败=turn 失败） | 模型内化（训练） |
| 回灌 | host bridge 仅暴露校验过的 `sendPrompt({text})` 与 `openLink({url})`；「显式携带当前选中值、绝不自动发送」 | `GenUI.issueNewTurn` 等 |
| 快照语义 | follow-up = 新 turn 新快照；**无跨调用 patch API**，iframe 控件状态不自动同步给 agent | 同（follow-up 重新生成） |
| 沙箱注入 | 共享主题 CSS + CDN importmap 注入 | Tailwind base + `--viz-*` 主题变量 + 尺寸自适应 |

### 裁决性事实（对 mobi）

1. **「沙箱自定义 UI 当主体」被验证可行**——CopilotKit 把 chart/diagram/calculator/map 全放沙箱路径，A2UI 只留表格；佐证 Phase 2（AppBlock）可以承载远比「逃生舱」大的份额。
2. **沙箱 UI 可流式渐进渲染**——有序参数契约（css 先行占位、html 渐进、js 最后）解决了 ChatGPT AppBlock「整块等完成」的观感缺口；mobi Phase 2 的流式设计有现成契约可抄（`docs/architecture.md` + renderer 源码 MIT 可读）。
3. **回灌语义与我们三档回路③的「模型中介」形态一致**——显式 sendPrompt 带当前值、不自动发送、控件状态不自动成为 agent 记忆；CopilotKit 与 ChatGPT 在此收敛，可作为 mobi 档③第一版的参照（佐证脑暴 Q4 推荐②）。
4. **独立路由器模型（Jev）对 mobi 非必需**——CopilotKit 用 Jev 是因为回答模型是通用 chat 模型；mobi 的 agent 本来就是 Claude，形态决策可以（也应该）由 Claude 自己做（system prompt + catalog 说明），多一个路由模型反而多一次调用、一个失败面和一个商业依赖。
5. 不可采用栈但可抄：有序流式契约、host bridge 校验边界、A2UI Table 的约束（≤12 列 ≤200 行、行宽校验、provenance 标签必填——数据溯源标注值得并入 mobi 数据绑定设计）。

### 未验证项

- renderer（`open-generative-ui/`）源码实现质量未读（下一步如 Phase 2 采纳其契约设计时再深读）。
- Websandbox 是三方库（Supabase 系），其安全模型未核查。
