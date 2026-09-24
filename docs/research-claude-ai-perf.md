# claude.ai 性能冲刺调研（2026-09-24）

> 调研对象：Anthropic 博客《How we made claude.ai 3x faster in two weeks》（https://claude.dev/blog/how-we-made-claude-ai-faster/ ，Raymond Wang / Sam Attard / Issac G.，2026-09-23 发布）。
> 调研方式：全文精读 + mobi 仓库代码映射核实（web 高亮链路 / reload 站点 / composer 与消息列表热区 / 纯 JS 热路径 / 遥测设施）。
> 定位：这篇是一次「Claude 主导、人掌舵」的两周性能冲刺复盘，方法论（确定性测量 + CI 棘轮 + 循环化）与具体优化（流式渲染重构、UTF-16、hook 普查）对 mobi 都有直接借鉴价值；且它验证的正是 mobi 的产品形态——AI agent 长会话的 Web 交互性能。

## 总评

文章最有价值的不是单条优化，而是一个可复制的飞轮：**把「用户能感知的慢」翻译成实验室里可确定性计数的东西，再把计数变成 CI 里只降不升的棘轮**。墙钟时间噪声太大没法当门禁，指令计数、React commit 数、style recalc 数、DOM mutation 数都是确定性的——一旦有了数，「测量」就从第零步（埋点→等数据→再理解问题）变成第一步（有数就能爬坡）。

对 mobi 的特殊意义：这次冲刺是用 Claude Tag（内部研究模型）在 Slack 线程里跑出来的，人只做雄心、品味、方向三件事——这与 mobi「远程控制 Claude Code」的定位互为印证：性能工程本身已经是 agent 活。mobi 的会话性能问题（流式渲染、消息窗口、composer 卡顿）与 claude.ai 高度同构，但 mobi 体量小得多，全盘照搬不划算，本文第三节逐项给出「做 / 不做 / 缓做」判断。

---

## 一、背景与方法论（文章摘要）

### 1.1 背景数字

- 整体：2026 年 8 月，两周冲刺，claude.ai + 桌面端核心体验**约 3x 提速**；估算每天为用户省下数万小时等待。（§开头）
- P75 分 journey 前后值（4 个 journey 占用户活动 95%，共拆成 13 项独立测量）：

| Journey（P75） | 前 | 后 |
|---|---|---|
| 全新加载到可输入 | 3.1s | 0.55s |
| 发起新 Claude Code 会话 | 0.8s | 0.3s |
| 加载 Cowork 云会话 | 2.6s | 0.73s |

（§THE BRIEF）

- 节奏：手选约 20 个项目起步，**第 3 天命中 13 个目标中的 12 个**；最忙一天合入 **200+ 变更**；两周合并 **3000+ 变更**，零客户可见事故、零回滚；同时并行 **150+ 线程**；引入近 **200 个 feature flag**，过半在冲刺结束前已清理。（§THE BRIEF / SCALING HORIZONTALLY / GUARDRAILS）

### 1.2 方法论五条

1. **确定性测量替身 + CI 棘轮**（§ANYTHING CAN BE HILL CLIMBED）：纯 JS 热路径用 Valgrind + `node --predictable` 数指令（一次运行、无需统计）；浏览器路径用替代阶梯——React commit 数、V8 precise coverage 函数调用数、style recalc 数、DOM mutation 数。每个基准两职：实验室可移动的指标 + CI 中**只许下降**的护栏数字；每日任务在计数下降时自动压低上限。不与墙钟相关或 flaky 的基准直接丢弃，不让 Claude 爬错山。
2. **循环（the loop）**（§THE LOOP, THREAD BY THREAD）：六步——开线程指出慢段 → Claude 追踪并建基准 → 实验室出结果后提 PR（按风险拆分，用户可见改动上 flag）→ 部署后读线上数据 → 有效则棘轮锁定、无效则关 flag 迭代 → 同一 journey 找下一个慢点。冲刺期间 150+ 线程同时跑这个循环。
3. **测量即第一步**（§ANYTHING CAN BE HILL CLIMBED）：核心教训原话——「With Claude, measuring something makes it tractable」。传统流程测量是第零步（埋点后等数据），有 Claude 后是爬坡第一步；最高杠杆的动作就是**找到更多可测量的东西**。
4. **护栏前置**（§GUARDRAILS）：因为碰的全是热路径（首屏、composer、transcript），安全机制先于优化建立——每个 PR 过自动评审 + 至少一人批准、单测先于优化、用户可见改动全部躲在短命 flag 后面。flag 堆积后开专门线程分级（kill switch / ramp）并逐个退役。性能收益在快节奏代码库里会衰减，项目证明有效后立即投资保护（见静态 composer 的四层护栏）。
5. **人的三角色**（§STEERING）：**Ambition**（Claude 默认保守，人负责把它推得更猛——「please be braver」「the targets are not the stopping point」）；**Taste**（每线程有具名人类 owner，用户可感知的改动必须给出前后录屏供裁决——表格逐格出现还是逐行、骨架屏何时出现、逐字渐隐值不值 1/5 帧预算）；**Direction**（线程刻意收窄到单一基准/journey，人只管排序、合并互相踩的线程、砍收益递减的线程——一条 900 行 PR 换来一句「2ms/send 不值维护一个 build 插件」的否决）。

### 1.3 优化清单（含量化收益）

| 优化项 | 手段 | 量化收益 | 文章章节 |
|---|---|---|---|
| 静态 composer | HTML 里直接烘焙可输入的 composer 静态副本，React 初始化期间即可打字；React 渲染直接画在其上 | 演示视频可输入 4.00s → 0.33s；配 jsdom 漂移测试 + 14 视口 1px 对齐 + 击键直通测试 + 线上 0.1px 位移上报四层护栏 | THE BRIEF / GUARDRAILS |
| 侧边栏 layout-shift 源归因 | 直接消费 Layout Instability API 的 `sources`，映射到命名区域（sidebar/transcript）× 阶段（首绘前/可输入后）；集成测试红 20/20 → PR 绿 20/20 | 单次 shift 仅 0.008（远低于 0.1 阈值，CLS 根本测不出），归因后发现 **31% 的页面加载**在可用后仍有无交互位移，按名逐批修掉 | THE LOOP |
| 流式渲染重构 | 完成块 memoization（消除每 chunk O(message length) 重复功）、增长中代码围栏的 tokenize 移入 worker、表格逐格揭示 | 单线程近 60 个 PR；长回复主线程阻塞总时长 ~750ms → ~200ms，CPU 约 1/3，120Hz MacBook 全程 120fps；对外口径「流式 ~4x 平滑、慢机器卡顿少 9x、最差冻结短 4.5x」 | AN 8-MILLISECOND BUDGET |
| UTF-16 单字节拷贝 | 回复 markdown 含任一非 Latin-1 字符（em dash、弯引号）→ V8 整串存 UTF-16 → 所有高亮 regex 走两字节慢路径 → 高亮完成代码块可冻结整页约 1 秒；修复仅 20 行：高亮前把代码块拷贝成单字节字符串 | 页面约 1s 冻结消除 | SCALING HORIZONTALLY |
| hook 普查 | React hook 普查 composer 打字路径 | 发现 **6,900 个 hook、900 个 store 订阅**随每次击键重渲染 | SCALING HORIZONTALLY |
| `:root:has()` 选择器 | 统计 style recalc 次数 | 单个 `:root:has()` 选择器给**每次 DOM 变更**增加 24ms | SCALING HORIZONTALLY |
| 隐藏 reload | 追踪首绘后的代码路径 | 残留的 `location.reload()` 造成**每天 50 万次隐藏刷新**，所有加载类指标都看不见 | SCALING HORIZONTALLY |
| IndexedDB 克隆 | 读空闲 tab 的 profiler 采样 | 相同的缓存快照**每分钟两次**被克隆写入 IndexedDB，全在主线程 | SCALING HORIZONTALLY |
| 120Hz 帧预算基准 | headless Chrome DevTools begin-frame 控制，240 begin-frame 精确步进 8.33ms，「这帧是否塞进 120Hz 预算」变成精确读数；此后成为夜间任务 | 流式平滑度从 60fps 上限爬到 120fps 精确验收 | AN 8-MILLISECOND BUDGET |
| 导航提速组合 | composer 跨会话保持挂载、hover 预取会话、侧边栏重渲染 −90%；桌面壳预编译 V8 code cache | 归入 13 项测量的导航/启动目标（THE BRIEF） | THE BRIEF |
| 指令计数双热路径 | Valgrind 剖析消息树装配路径 + 状态行扫描器：前者 1/4 指令是 megamorphic 字典查找（同一 message ID 解析三次） | 指令数 −48% / −31%，墙钟 −78% / −44%，两个新棘轮入库 | ANYTHING CAN BE HILL CLIMBED |

另有两个值得一提的故事：Chrome 对托管浏览器新标签页 56px footer 的预渲染尺寸差（ Speculative loading 隐性布局位移，静态 composer 提早首绘后暴露，靠 pinned layout + 预渲染流程测试修复，§GUARDRAILS）；flag 协调线程的 kill switch / ramp 分类法（§GUARDRAILS）。

---

## 二、mobi 借鉴映射

### 2.1 UTF-16 高亮两字节慢路径 → **悬崖不成立，但流式 fence 全量重高亮成立**

**文章做法**：整条回复 markdown 是一个大字符串，一个 em dash 就把 Latin-1 单字节串打回 UTF-16，所有高亮 regex 走两字节慢路径（§SCALING HORIZONTALLY）。

**mobi 现状**：
- 聊天流 markdown 代码块链路：`packages/web/src/components/ui/Markdown.tsx`（components 覆盖）→ `packages/web/src/components/ui/AutoDetectCodeBlock.tsx` → `@ant-design/x` CodeHighlighter → **react-syntax-highlighter（Prism 全量主包、正则、主线程同步）**。
- 文件查看链路：`packages/web/src/core/utils/shiki.ts` → shiki/core + `createJavaScriptRegexEngine`（JS 正则引擎，同样是主线程但静态一次性、异步 `useShikiHtml`，非聊天流式——文件内注释明确「不加防抖（聊天流式场景才需要）」）。
- **关键差异**：mobi 内容以中文为主，消息字符串在 V8 里本来就是 two-byte，不存在「一个特殊字符把整串从单字节打回两字节」的悬崖——mobi 的常态就是文章修复后的状态。且代码 fence 本体是独立字符串（常见纯 ASCII），mobi 天然已按块拆分，不等价于「整条消息一串」。

**真正的可借鉴点**：文章流式重构的另外两招——「完成块 memoization」mobi 已通过 x-markdown incremental patch 覆盖一半（`MARKDOWN_STREAMING_CONFIG` 的 `incremental: true`，见 `.claude/skills/upgrade-deps/references/x-markdown-patch.md`：6x 节流下 >100ms 长任务 304 → 4~7 个）；**「tokenize 移入 worker」未做**——流式期间增长中的代码 fence 每帧对整个 fence 重跑 Prism（同步主线程），这是 mobi 与文章「逐帧计时找慢点」方法论最对口的落点。

**建议**：UTF-16 单字节拷贝**不做**（前提不成立）；流式代码 fence 的高亮 worker 化 / 防抖列入中期候选，动手前先用文章方法逐帧计时取证（详见 2.5 的 dev-only 观测）。

### 2.2 残留 reload → **mobi 无幽灵 reload，已知坑修复到位**

**文章做法**：追踪首绘后代码路径发现残留 `location.reload()` 造成每天 50 万次隐藏刷新，加载类指标全看不见（§SCALING HORIZONTALLY）。

**mobi 现状**（grep `packages/web/src` 全部出现点）：

| 文件 | 行为 | 评估 |
|---|---|---|
| `core/utils/reload.ts:24` | `reloadPage` 具名导出（为测试 mock 抽出） | 无风险 |
| `core/pwa/forceUpdate.ts:67,91,106,109` | 强制更新流程，reload 均在 `await` 之后或 controllerchange/超时回调里 | 异步任务，不踩坑 |
| `core/pwa/registerSW.ts:67` | controllerchange 事件回调 | 异步事件，不踩坑 |
| `core/pwa/registerSW.ts:79` | waiting worker 失效时同步兜底 reload，经 UpdatePrompt 点击触发 | 点击 handler 内**无 setState 前置**，不构成「setState 后同步 reload」模式 |
| `components/layout/SidebarFooter.tsx:125` | PWA 菜单「刷新」onClick 直接 reload | 无 setState 前置，安全 |
| `components/layout/MobileMenu.tsx:212` | **已带 `setTimeout(0)` defer + 成因注释** | 已知 PWA 坑的唯一踩点，修复到位 |

**结论**：mobi 的 reload 全部是用户显式触发，不存在文章那种首绘后幽灵路径；「同步 setState 紧跟 reload 被吞」的唯一踩点（MobileMenu）已修复且有注释留痕。**无需动作**；唯一可留意的是 registerSW.ts:79 属「事件 handler 同步栈内 reload」，当前无 setState 前置所以安全，若未来有人在 UpdatePrompt 的点击链路里加状态更新需复查。

### 2.3 composer / 消息列表热区 → **体量小三个数量级，不做全量普查，只收窄已知全量重渲染点**

**文章做法**：hook 普查发现 composer 打字路径 6,900 hooks + 900 store 订阅逐击键重渲染（§SCALING HORIZONTALLY）。

**mobi 现状**（量级盘点）：
- `packages/web/src/components/composer/ChatComposer.tsx`（1163 行）：约 21 个 hook 调用、6 useEffect、14 useCallback，聚合 useComposerDraft / usePromptSuggestion / useMentionInteraction / useSlashCommandInteraction / useDirectoryCapabilities / useAttachmentHandling 等约 12 个自定义 hook。
- `packages/web/src/components/composer/ComposerInfoPanel.tsx`：**单组件订阅 6+ 个 store**（useForegroundTasks / useChatBlocksById / useBackgroundTasks / useTeamMembers / useTeamName / useMessages(selector)），且代码注释已自认 trade-off：「useSyncExternalStore 下 store 每次 SSE 写入都 notify，本面板会随消息变动重渲染……若流式期重型子树 reconcile 开销显著，后续加 selector 缓存优化」。
- `packages/web/src/components/chat/ChatContainer.tsx`（1451 行）：14 useEffect + 19 useCallback + 约 20 个自定义 hook——聊天热区最重的一个文件。
- `packages/web/src/components/chat/BubbleListChat.tsx`（385 行）：16 useRef / 4 useEffect，相对收敛。
- 数据层：`core/data/stores/messageWindowStore.ts`（536 行 external store，SSE 每写 notify）。

**结论**：mobi 热区合计数千行、数十 hook、个位数 store 订阅点——比 claude.ai 的 6900/900 小三个数量级，**全量 hook 普查收益低，暂不做**。值得做的是点状收窄：ComposerInfoPanel 已知随每次 SSE 写入重渲染，其注释已预留 selector 优化方向，可作为热区第一个（可能也是唯一需要的）优化点。

### 2.4 纯 JS 热路径指令计数基准 → **落点确认，两文件均在且纯 JS 可跑**

**文章做法**：Valgrind + `node --predictable` 对纯 JS 热路径数指令，一次运行即得确定性数字，CI 棘轮只降不升；实证相关性：指令 −48%/−31% → 墙钟 −78%/−44%（§ANYTHING CAN BE HILL CLIMBED）。文章选的热路径之一恰好是「装配会话消息树的例程」。

**mobi 现状**：两个候选落点均确认存在：
- `packages/cli/src/claude/utils/assistantPartialAssembler.ts`——纯函数装配器（`Map<msgId, Pending>` 累积 + message 边界 flush），无 DOM、无 IO，输入可用固定 SDK 消息序列 fixture，是理想的第一落点；且与文章选的「message tree assembly」几乎同构。
- `packages/web/src/core/data/stores/messageWindowStore.ts`——消息窗口滑动的纯逻辑 external store，依赖极小，次选。

**建议**：列为远期候选（mobi 当前无 CI 基准设施，先有确定性基准文化再谈棘轮）。注意一点：文章方法是 `node --predictable` + Valgrind，mobi 运行时是 bun——这两个模块无 bun 特有 API，基准可在 node 下跑，不冲突。配套方法论先行项：给热路径建 fixture 回放（现成的会话消息序列即可）。

### 2.5 Layout Instability 按源归因 → **无生产遥测设施，做 dev-only / E2E 版本**

**文章做法**：CLS 阈值内（单次 0.008）的位移体感仍然糟糕；直接消费 `layout-shift` entry 的 `sources`，映射到命名区域 × 阶段，配「红 20/20 → 绿 20/20」的集成测试，再从线上归因数据逐批修（§THE LOOP）。

**mobi 现状**：web 端**没有任何客户端遥测设施**——grep `PerformanceObserver` / `web-vitals` / `reportWebVitals` / sentry / posthog 全部零命中；性能相关计时仅存在于组件内部（`useStreamingContent.ts` 的揭示节奏、`ChatContainer.tsx` 的滚动手势窗口）。mobi 是自托管本地优先工具，引入生产遥测违背产品定位。

**建议**：不做生产遥测；做**dev-only 归因 + E2E 断言**——在 `MainLayout.tsx` 挂载 useEffect（现有 SW 注册同一位置）注册 `PerformanceObserver('layout-shift')`，仅 `import.meta.env.DEV` 启用，把 `sources` 映射到 mobi 的命名区域（sidebar / chat / composer / drawer）；E2E（/run-tests skill 的 CDP 环境）可断言关键页面「无命名区域位移」，等价于文章的红绿测试但不需要线上数据。这同时服务 2.1 的流式取证需求。

---

## 三、落地建议

### 短期可落地（不动架构）

1. dev-only layout-shift source 归因观测器（MainLayout 注册，命名区域映射，console 输出）
2. ComposerInfoPanel 的 store 订阅 selector 收窄（注释已预留方向）
3. E2E 关键页「无命名区域位移」断言（借 /run-tests CDP 环境）

### 中期方向性（与进行中特性合并考虑）

1. 流式增长代码 fence 高亮的 worker 化 / 防抖——动手前先用 2.5 的观测器逐帧取证，确认 Prism 重高亮确实是长任务主因
2. 消息窗口 store 的确定性基准 fixture 回放（为指令计数棘轮铺路）
3. flag 分级法（kill switch / ramp + 逐个退役）可直接抄进 mobi 现有 featureGate 体系

### 暂不做

- UTF-16 单字节拷贝（中文内容下悬崖不存在）
- 生产环境遥测 / web-vitals 上报（违背自托管定位）
- 全量 hook 普查（体量不值）
- 静态 composer（mobi 首屏不含重 composer，收益不成立；但它的四层护栏设计值得在 mobi 做「HTML 预热壳」时参考）

### 工程文化

- 「证明基准与墙钟相关，否则拆掉」——mobi 若引入任何性能基准，必须先证明它跟真机体感相关，防止爬错山（文章 §ANYTHING CAN BE HILL CLIMBED 的明文纪律）。
- 「2ms 不值 900 行」的否决案例——性能优化同样要过 Taste 关，复杂度预算与毫秒收益对表。

---

## 四、流式取证（2026-09-24 E2E 实测）

用 §2.5 的观测器 + longtask PerformanceObserver 在真实流式会话（e2e 环境，glm-5.2，2500 字长文压测 prompt）量化 fence 高亮成本：

| 场景 | 长任务数 | 阻塞总时长 | 占空比 | p50 | p95 | 最差 |
|---|---|---|---|---|---|---|
| 含 4 代码块，无 throttle（桌面） | ~3-5 | ~0.3s | <1% | — | — | ~190ms |
| 含 4 代码块，6x CPU throttle | 133 | 21.9s | 21% | 144ms | 319ms | **1081ms** |
| 无代码块同长文，6x throttle | 77 | 11.4s | 13% | 149ms | 192ms | 346ms |

**结论**：

1. **桌面端流式健康**：无 throttle 下整轮流式仅 3-5 个长任务，帧 p95=19ms——§2.1 的「fence worker 化」对桌面无立项依据。
2. **移动端（throttle 模拟）代码块是主要增量**：同为 2500 字，代码块使长任务 +73%（133 vs 77）、阻塞时长 +92%、最差停顿 3.1 倍（1081ms vs 346ms）——增长中 fence 的 Prism 全量重高亮是主因，与 memory `streaming-smoothness` 的 6x throttle 结论互相印证。
3. **layout-shift 零位移**：两轮流式全程 `__mobiPerf` 零新增位移（chat/composer 区域标注生效）——流式追加不产生布局位移，§2.5 的 E2E 位移断言对聊天流是恒真命题，断言价值在登录页等无标注区域（实测登录页存在每 ~2.6s 一次的周期性微位移，量级 ~0.0001-0.003，待归因，属低优先级）。
4. **新发现**：会话页空闲态存在每 ~10s 一次的 ~50ms 周期性长任务（无 throttle 即可见），来源未定位（疑似轮询/refetch），量级无害但值得一次 idle 归因排查。→ **2026-09-24 复查：未能复现**。代码侧排除 sseClient watchdog（纯日期比较）与 hub 心跳（30s）；E2E 四个受控空闲窗口（空页面 45s / 小轮次会话 90s / 长文会话 90s / 重探针 35s，含 resource timing 与 setInterval 计时包装）均零长任务、零周期 API 调用。判定为一次性环境因素，不追。已布防：`__mobiPerf` 增加 `getLongtasks()` 长任务环形缓冲（dev-only），野中复现时直接有数据。

**§2.1 建议修订**：fence 高亮优化立项（中期），但方案优先**流式期间对增长中 fence 降频高亮/防抖**（完成后终态高亮一次），复杂度远低于 worker 化；worker 化仅在降频后仍不达标时升级。依据 `docs/conventions/performance.md`：桌面收益不成立，移动端收益成立但先取低复杂度方案。

---

## 附：来源与回查

- 一级来源：How we made claude.ai 3x faster in two weeks，claude.dev/blog，2026-09-23。文中每条文章侧 claim 标注的章节名：THE BRIEF / ANYTHING CAN BE HILL CLIMBED / THE LOOP, THREAD BY THREAD / SCALING HORIZONTALLY / GUARDRAILS / STEERING / AN 8-MILLISECOND BUDGET。
- mobi 侧关键文件（均已实地核实）：
  - 高亮：`packages/web/src/components/ui/Markdown.tsx`、`packages/web/src/components/ui/AutoDetectCodeBlock.tsx`、`packages/web/src/core/utils/shiki.ts`
  - x-markdown patch：`.claude/skills/upgrade-deps/references/x-markdown-patch.md`
  - reload：`packages/web/src/core/pwa/{forceUpdate,registerSW}.ts`、`packages/web/src/core/utils/reload.ts`、`packages/web/src/components/layout/{MobileMenu,SidebarFooter,UpdatePrompt,MainLayout}.tsx`
  - 热区：`packages/web/src/components/composer/{ChatComposer,ComposerInfoPanel}.tsx`、`packages/web/src/components/chat/{ChatContainer,BubbleListChat}.tsx`、`packages/web/src/core/data/stores/messageWindowStore.ts`
  - 基准落点：`packages/cli/src/claude/utils/assistantPartialAssembler.ts`
- 关联 memory：`project_xmarkdown-incremental-patch`、`project_pwa-sync-reload-swallowed`、`project_message-window-store`、`xmarkdown-append-only-assumption`、`project_streamdown-migration-research`、`streaming-ux-smoothness`。
