# Anthropic 工程博客三篇调研：测试选择（TIA）/ Loop 工程 / 自动化 Code Review（2026-09-25）

> 调研对象：
> 1. 《Agentic coding is straining CI. Here's how we scaled test impact analysis at Anthropic》（Sachin Malhotra，2026-09-14）
> 2. 《Loop engineering: Getting started with loops》（Delba de Oliveira / Michael Segner，2026-06-30）
> 3. 《Bringing Code Review to Claude Code》（2026-03-09）
> 调研方式：三篇全文精读 + mobi 仓库映射核实（run-tests 路由 / 测试目录组织 / depcruise / review skills / 后台任务设施）。
> 定位：三篇分别对着 mobi 的三个既有痛点与实践——web 包测试时长（空闲 ~40s、压载 ~400s）、skill 化的验证循环（run-tests / upgrade-deps）、人工触发的双 review skill。格式与结论纪律参照姊妹篇 [docs/research-claude-ai-perf.md](research-claude-ai-perf.md) 与 [docs/research-zcode-interactions.md](research-zcode-interactions.md)，收益/复杂度对表依 [docs/conventions/performance.md](conventions/performance.md)。

## 总评

三篇合起来是同一条故事线的三个切面：agent 把「写代码」变便宜之后，压力沿着 生成 → 验证（CI/测试） → 评审（review） 依次传导。Anthropic 的解法共享同一个思路——**把人的隐性判断编码成机器可执行的确定性结构**：测试选择编码成 listener/selector 服务，循环编码成 trigger/stop-condition 原语，review 编码成 find → verify → rank 的 agent 流水线。

对 mobi 的总体判断：三篇都是大组织规模下的产物（六个月 25x CI job、平均每次 review 15-25 美元），mobi 是单人仓库 + 本地优先，照搬不成立；但每篇都有一条「低配版」可以直接落：TIA 的落点是 run-tests 路由表里加一层「tests/ 镜像 src/」的包内选测规则；loops 的落点是给 upgrade-deps 试一条 goal-loop；code review 的落点是给现有 skill 的输出协议补「severity 排序 + 误报标记」。完整版（选测服务、常驻 routine、产品级 review agent）均不做，依据见第五节对表。

---

## 一、《Agentic coding is straining CI》（TIA）摘要

### 1.1 背景数字（§AI is evolving CI）

- 工程师季度代码量为 2021-2025 均值的 **8x**，其中 **80% 由 Claude 撰写**；测试总量增长 **10x**；CI job 六个月增长 **25x**（文章明言：并非每个测试都跑在每个 PR 上）。
- 核心论点：写代码不再是瓶颈，PR review 被加速后 CI 成为下一个压力点。全量测试跑每个 PR 不可持续：门禁变长、变贵、变得不可信（untrustworthy）。
- 对 agent 的特殊观察：人擅长判断「哪些测试失败与我无关」，agent 需要一个明确的合法测试集才能有效自验证与迭代。

### 1.2 选测机制（§The test impact analysis architecture）

- 服务形态：**确定性（deterministic）测试影响分析/测试选择服务**，依据「历史表现（past performance）+ 包相关性（package relevance）」决定每个变更跑哪些测试。注意：文章**没有**展开静态 call-graph 或覆盖率映射的算法细节——选测依据是测试结果历史 + 包级相关性，而非精细依赖图推演。
- 两个必须保持同步的确定性组件：
  - **listener**：记录每次 CI run 的测试结果；
  - **selector**：读取结果历史，决定每个打开的 PR 跑什么。
- listener 滞后的代价：**20 分钟滞后 = 数万条测试更新未应用**，三种后果——坏变更合入后测试对所有人变红（多处无谓排查）；依赖开始 flaking 则 flaky red 阻塞合入；被修复的测试与新增测试迟迟不被跑到（回归风险）。
- v0 架构是单进程：per-test 历史需要单一写者排序结果 → 无法水平分片。

### 1.3 三次补丁与重构（§The bumpy road to redesign）

| 补丁 | 手段 | 效果持续 |
|---|---|---|
| Patch 1 | 加倍核数（bigger machine） | 70 天 |
| Patch 2 | 按包分片（每包一个单写者 worker，代码由 Claude 生成） | 29 天 |
| Patch 3 | 每日重启（内存每天下午触顶；只找到 4 个 bug、换内存分配器无效、不敢对高负载单例做 memory profiling） | 不到 1 天 |

- Patch 2 期间的看护方式值得单记：作者在内部 Claude Tag 开了一个 **long-running session 专责监控该服务**，listener lag 超过 **50,000 jobs** 就 ping 他续聊上下文——「把服务仪表化当成 Claude 的眼睛耳朵」的实例（Claude 多次主张彻底重构，人每次选择了再打一个补丁）。
- 最终重构：**给服务配数据库（in-memory store）**。listener worker 变为无状态——任意 worker 处理任意结果、append 进 journal 即走、内存不持任何东西，因而水平可扩展；独立小消费进程每几秒把 journal 滚动成 per-test 历史，selector 快速查询。cutover 后积压曲线走平。**1 名工程师 3 周**（一年前约一个季度）。
- 重要澄清：listener 丢结果 ≠ 代码未经测试上生产，而是 selector 用陈旧数据决策——实际后果是多跑了本来就 flaky / 全面失败的测试。

### 1.4 经验（§What I would do differently）

- 「always plan for the exponential」：按**两个季度内 25x 负载**做假设；预算允许时 v0 直接按 10-20x 预估规模设计。
- 补丁与重写的性价比已经反转：加机器/并行/重启买来的时间只有一年前的零头，而彻底重写一个服务也只要零头时间且更可持续——倾斜向重设计。
- 三条架构纪律：给服务装仪表（尤其保证「进出的 CI job 数守恒」可测量）；**状态不放进进程**；关键服务避免单例（除非可测量、可金丝雀）。

---

## 二、《Loop engineering: Getting started with loops》摘要

### 2.1 定义（§Getting started with loops）

loop = **agent 重复工作循环直到停止条件满足**。分类维度四个：怎么触发、怎么停、用什么 Claude Code 原语、适合什么任务。文章明说：不是所有任务都需要复杂循环，**从最简方案开始、选择性使用模式**。

### 2.2 四种 loop（§各自小节）

| Loop | 你交出去的 | 触发 | 停止条件 | 适用 | 用量控制 |
|---|---|---|---|---|---|
| Turn-based | the check | 用户 prompt | Claude 自判完成或需要更多上下文 | 一次性短任务、探索 | 写具体的 prompt + 把验证编码进 skill 减少轮数 |
| Goal-based | the stop condition | 手动 prompt | 目标达成 或 轮数上限 | 有可验证退出条件的任务 | 明确完成标准 + 显式轮数上限（"stop after 5 tries"） |
| Time-based | the trigger | 定时间隔 | 取消 或 工作完成（PR 合了/队列空了） | 周期性工作、对接外部系统 | 拉长间隔，或改事件驱动 |
| Proactive | the prompt | 事件/调度，无人实时在场 | 每任务达成即退出，routine 常驻直到关闭 | 持续到来的良定义工作（bug reports、issue triage、迁移、依赖升级） | routine 路由到更小更快的模型，判断类用最强模型 |

要点摘录：

- **Turn-based**（§Turn-based loops）：每个 prompt 都是一个手动 loop。提升点是把手动的验证步骤编码成 SKILL.md，让 Claude 能端到端自查——skill 里要给 Claude 能**看、测、交互**的工具，检查越量化越好。文中给了 verify-frontend-change 示例：起 dev server → 真实交互改动（点击/输入 + 前后截图）→ console 零新错误 → Chrome DevTools MCP 跑 perf trace 与 Core Web Vitals；任一步失败修完从第 1 步重跑，**不许交回只验了一半的工作**。
- **Goal-based**（§Goal-based loop (/goal)）：Claude 每次想停时由 **evaluator model** 检查目标条件、不满足打回继续。**确定性标准（测试通过数、分数阈值）最有效**。示例：/goal get the homepage Lighthouse score to 90 or above, stop after 5 tries.
- **Time-based**（§Time-based loop (/loop and /schedule)）：示例 /loop 5m check my PR, address review comments, and fix failing CI。/loop 跑本机（关机即停），/schedule 把 loop 移到云端 routine。
- **Proactive**（§Proactive loops）：组合拳——/schedule（定时查新）+ /goal（定义 done）+ skills（怎么验证）+ dynamic workflows（编排 triage/fix/review 多 agent，可并行三个 worktree 探索再对抗评审）+ auto mode（免逐次审批）。

### 2.3 质量与成本（§Maintaining code quality / §Managing token usage）

- 质量四条：代码库本身干净（Claude 跟随既有模式与约定）；给 Claude 自验证手段（skills）；框架文档易达；**用第二个 agent 做 review——fresh context 无偏见、不被主 agent 的推理带偏**。原文金句：**"Loops that write code need loops that check it."** 另：单次结果不合格时不止修个例，**把它编码进系统**，改进所有未来迭代。
- token 六条：选对原语与模型（小任务不上多 agent、便宜模型够用）；明确成功/停止条件（Claude 更快到达但不过早收敛）；大跑前先小样试点（dynamic workflows 可 spawn 数百 agent）；确定性工作用脚本（跑脚本比重推代码便宜）；routine 频率匹配被观察物的变化频率；用 /usage、/goal 无参数（显示轮数与 token）、/workflows 审查用量并可随时停。模型与 effort 档位是最大杠杆。

---

## 三、《Bringing Code Review to Claude Code》摘要

### 3.1 定位与效果（§Managing the review bottleneck）

- 背景：工程师代码产出一年 **+200%**，review 成为瓶颈，「很多 PR 被 skim 而非深读」。
- 产品形态：Code Review = **每个 PR 打开时派一个 agent 团队**，为深度不为速度；Anthropic 内部几乎每个 PR 都跑；Team/Enterprise research preview。与更轻的 Claude Code GitHub Action（开源、保留）互补，Code Review 更彻底也更贵。
- 效果：有实质性 review 意见的 PR 从 **16% → 54%**。**明确不做 approve——那仍然是人的决定**，它只负责把覆盖缺口关掉。

### 3.2 流程（§How it works）

- PR 打开 → 派 agent 团队 → **并行找 bug → verify 阶段过滤误报 → 按 severity 排序** → 产出一条高信噪比的总评 comment + 具体 bug 的 inline comments。
- 规模随 PR 弹性：大/复杂 PR 派更多 agent、读得更深；trivial PR 轻量过。平均一次 review **约 20 分钟**。

### 3.3 量化数据（§Code Review in action）

- 大 PR（>1000 行）：**84% 有 findings，平均 7.5 个问题**；小 PR（<50 行）：**31%，平均 0.5 个**；工程师标记为「不正确」的 findings **< 1%**。
- 案例 1：一行改动看似例行（这类 diff 通常秒批），被标 critical——会破坏该服务的认证。合并前修复，工程师自认独自 review 不会发现。
- 案例 2：TrueNAS ZFS 加密重构 PR，发现**相邻代码里的既有 bug**——类型不匹配导致每次 sync 静默清空加密密钥缓存。latent bug，人类扫 changeset 不会主动去查。

### 3.4 成本与管控（§Cost and control）

- 按 token 计费，平均 **15-25 美元/次**，随 PR 规模与复杂度浮动。Admin 控制：组织月度总花费上限、仓库级开关、分析面板（review 数 / 接受率 / 总成本）。

---

## 四、mobi 借鉴映射

### 4.1 TIA → run-tests 路由的下一层

**mobi 现状（已核实）**：

- run-tests skill（.claude/skills/run-tests/SKILL.md）已有**包级路由**：git diff 文件集 → 决策表（全量 / test:hub|cli|web|shared），明文记录「全量空闲 ~40s（web 31s + 其余 9s），压载可劣化 ~400s」；typecheck/lint 始终全量，CI 兜底。
- 测试组织：四包 tests/ 目录**镜像 src/ 结构**——如 src/core/pwa/swClick.ts ↔ tests/pwa/swClick.test.ts、hub src/config/webApiToken.ts ↔ tests/config/webApiToken.test.ts；web tests 下 **17 个子目录（含 helpers）与 src 顶层子目录同名对应**（chat / components / composer / core / stores / hooks / pages / ...）。**命名镜像惯例稳定存在，是现成的包内选测信号**。
- 依赖图：.dependency-cruiser.js 只是 lint 门禁（包边界 + 循环依赖禁令），**没有持久化的依赖图产物**；但 dependency-cruiser 本身可输出模块级依赖图，codegraph 索引也带符号→测试映射（blast radius 的 "tested via callers"）。
- 「past performance / flaky 历史」信号：**无**——没有按测试记录历史与稳定度的设施。

**判断**：

- **做（低配版，先验证）**：在 run-tests 路由表加一条包内规则——改动集中在 packages/web/src/<dir>/** 且未触共享层（stores/core/协议）时，先跑 tests/<dir>/** 及强关联目录（如组件改动连带 tests/components + tests/hooks），失败或涉及共享文件再升级全包。复杂度 = 几条路由规则；收益 = 正常时 web 反馈从 31s 进一步压向个位数秒。**前置**：按 performance.md 第 1 条先做相关性验证——观察一段时间「镜像选测集」与全量的失败集合是否一致（漏测率），证明有效再写进 skill；无效就撤。
- **不做（完整 TIA）**：listener/selector 式有状态选测服务、按测试的 flaky 历史与动态选择。Anthropic 的前提是 25x CI job 增长、agent 高频开 PR；mobi 单人仓库、CI 只做兜底、日常验证走 run-tests，几十秒的收益撑不起一个有状态服务的复杂度。记 docs/pending.md 观望。
- 顺带可取的一课（§What I would do differently）：若未来 hub 同步/消息链路负载增长，「状态不放进进程、进出守恒可测量、关键服务避免单例」是现成的架构检查清单。当前量级不动。

### 4.2 Loops → 现有循环设施盘点与归类

**mobi 现状（已核实）**：

- 产品代码内**没有任何 cron/定时设施**——全库无 scheduler；后台任务 = SDK 的 run_in_background Bash/Agent（hub 侧 packages/hub/src/sync/backgroundTasks.ts 从 task_started / background_tasks_changed 提取，Monitor 工具恒后台）。注意这是「后台」不是「定时」：没有时间触发器。
- 已有 loop 资产按博客四分法归类：
  - **Turn-based + verification skill**：run-tests 就是博客说的「把人工验证编码成 SKILL.md」——typecheck → 单测 → lint → E2E 四步自验证，检查量化（如 cli 248/248、lint warning budget 0）。这是博客框架下 mobi 最成熟的一条，**已达标，无需动作**。
  - **Goal-based**：未使用。候选是 upgrade-deps skill——「升级完成且 typecheck + test + lint 全绿」是天然的确定性退出条件。
  - **Time-based**：未使用。harness 层有 /loop、/schedule 可用，但无场景接入。
  - **Proactive**：无。多 agent 会话 / 后台 subagent 是执行面能力，不是 autonomous loop。

**判断**：

- **做（近期）**：给 upgrade-deps 试一条 **goal-loop**——/goal「升级依赖直到 typecheck + test + lint 全绿，stop after N tries」。它有确定性停止条件、失败面小（git 可回滚）、且与博客点名的典型场景「dependency upgrades」完全对口。mobi 特有约束要写进 goal 条件：marked / pdfjs-dist 受传递依赖 pin（见 memory），特定升级路径的失败是预期形态，不算未达成。
- **改造后做**：time-based 的第一个候选场景是「空闲时段全量测试 + 镜像选测的安全网对账」（补 4.1 低配 TIA 的兜底全量），用 /loop 的本机形态即可，**不建云端 routine**——mobi 开发机非常驻 CI 环境。
- **不做**：proactive autonomous loop（/schedule + dynamic workflows + auto mode 的组合拳，数百 agent 免审批编排）。与 mobi「远程控制、人掌舵」的产品定位和既有协作偏好（subagent 流程太重、push 需明确指示）相悖；真出现持续到来的良定义工作流（如外部 issue 流）再评估。

### 4.3 Code Review → 双 skill 的差距与补法

**mobi 现状（已核实）**：

- 两个 review 入口，均人工触发：
  - 内置 /code-review：对当前 diff / PR 做 correctness bug 审查，effort 档位控制广度，--comment / --fix 落地。
  - matt-code-review（~/.claude/skills/matt-code-review/SKILL.md）：双轴协议——Standards（对 repo 文档化约定 + 内置 Fowler smell baseline，repo 约定可覆盖 baseline）与 Spec（对来源 issue/spec，查缺失/超范围/实现可疑），两轴**并行 subagent 隔离上下文**、各 400 字内、并排汇报不合并排序。
- 触发纪律：implement 末尾跳过 cr 直接 commit，用户点名才跑（memory 既定）。

**与博客做法的差距**：

1. **verify/误报过滤段缺失**：博客流水线是 find → verify（过滤误报）→ rank（severity）三段；内置 /code-review 的 effort 档位近似「广度控制」，没有独立的第二段验证；matt 双轴解决的是「视角分离」而非「误报过滤」。
2. **量化反馈闭环缺失**：博客有「<1% findings 被标错」「16% → 54%」这类数字支撑调参；mobi 无任何接受率/误报率记录，无法判断 skill 该往哪调。
3. **触发自动化差距最小**：博客挂在 PR 打开事件上；mobi 没有互审他人的场景，人工触发本身合理。

**判断**：

- **改造后做（低成本）**：不求产品级 Code Review（agent 团队 + 15-25 美元/PR，与单人仓库不成比例）。值得抄的是**输出协议**：给两个 skill 的产出统一加「severity 排序 + 置信度标注」段，并让用户可随手标「误报 / 有效」——把 run-tests 已验证的记忆回写机制（skill memory）搬过来，几次之后就有 mobi 自己的误报率数字，再决定是否值得加深 verify 段。
- **不做**：引入 GitHub App 形态的 Code Review 或常驻 review agent。mobi 是本地私有仓库单人开发，不存在博客要解的「review 瓶颈」（16% → 54% 的前提是 PR 流量大）。

---

## 五、落地建议汇总（performance.md 对表）

| 条目 | 判断 | 一句话依据（复杂度预算 vs 毫秒/质量收益） |
|---|---|---|
| run-tests 加 tests 镜像 src 的包内选测规则 | 做（先验证漏测率再挂） | 几条路由规则的复杂度，换 web 反馈 31s → 个位数秒；选集有效性必须先实测 |
| 完整 TIA 服务（listener/selector/测试历史） | 不做（记 pending 观望） | 几十秒收益撑不起有状态服务；25x 规模前提不存在 |
| upgrade-deps goal-loop 化 | 做 | 确定性停止条件现成、可回滚、博客点名的对口场景 |
| 常驻/云端 routine（/schedule） | 不做 | 无持续到来的良定义工作流；开发机非常驻 |
| proactive autonomous loop | 不做 | 与产品定位及「subagent 流程太重」的既有判断相悖 |
| review skill 输出加 severity + 置信度 + 误报标记 | 改造后做 | 纯输出协议改动；先把「误报率」变成可测数字再谈深化 verify 段 |
| 产品级 Code Review / GitHub App | 不做 | 15-25 美元/PR 的深度换不来单人仓库的 review 瓶颈 |

跨三篇的工程文化条目（与 performance.md 互证）：

- 「先证明与体感相关，否则拆掉」——TIA 低配版的镜像选测必须先过漏测率验证，同 performance.md 第 1 条。
- 「instrument as Claude's eyes and ears」——博客一用 listener lag > 50k 触发 ping、博客三用接受率面板调参；mobi 对应物是 run-tests memory 回写与未来的 review 误报标记，方向一致。
- 「loops that write code need loops that check it」——mobi 的 run-tests + 双 review skill 已是这条的实例；差距只在反馈闭环（误报标记）不在骨架。

---

## 附：来源与回查

- 一级来源（三篇全文已精读，文中 claim 均标注章节）：
  1. Agentic coding is straining CI. Here's how we scaled test impact analysis at Anthropic — Sachin Malhotra，claude.com/blog，2026-09-14。章节：AI is evolving CI / The test impact analysis architecture / The bumpy road to redesign（Patch 1: A bigger machine、Patch 2: Sharding、Patch 3: Daily restarts、The redesign）/ What I would do differently。
  2. Loop engineering: Getting started with loops — Delba de Oliveira / Michael Segner，claude.com/blog，2026-06-30。章节：Turn-based loops / Goal-based loop (/goal) / Time-based loop (/loop and /schedule) / Proactive loops / Maintaining code quality / Managing token usage / Getting started。
  3. Bringing Code Review to Claude Code，claude.com/blog，2026-03-09。章节：Managing the review bottleneck / How it works / Code Review in action / Cost and control / Getting started。
- mobi 侧核实文件（实地）：
  - .claude/skills/run-tests/SKILL.md（包级路由决策表、40s/400s 数字、路由输出要求）
  - packages/web/vitest.config.ts（tests/** include、jsdom、15s timeout 及压载注释）
  - packages/web/tests/ 目录清单（17 子目录镜像 src 结构）
  - .dependency-cruiser.js（包边界 + 循环依赖规则；无持久化依赖图产物）
  - packages/hub/src/sync/backgroundTasks.ts（后台任务 = SDK run_in_background 提取；无定时设施）
  - ~/.claude/skills/matt-code-review/SKILL.md（双轴 Standards/Spec review 协议、并行 subagent、smell baseline）
- 姊妹篇：docs/research-claude-ai-perf.md（方法论上游，performance.md 出处）、docs/research-zcode-interactions.md。
- 关联 memory：project_web-test-performance（40s 基线）、project_deps-pinned-by-transitive（升级 pin 约束）、feedback_matt-skills-cr-conflict（review 触发纪律）、feedback_subagent-flow-too-heavy（loop 规模判断）。