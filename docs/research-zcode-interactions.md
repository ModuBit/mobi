# ZCode 交互调研（2026-09-23）

> 调研对象：智谱 ZCode 开源源码，本地路径 `~/workspace/github/study/ZCode/`（v3.14.3，2026-09-23 更新）。
> 调研方式：四路并行源码探索（聊天渲染 / 输入区 / 任务与工作流 / 面板生态）+ 协议层抽读，文中路径均相对 ZCode 仓库根。
> 定位：ZCode 与 mobi 定位高度重叠（AI 编程工作台：桌面 + Web + 终端 Agent），本文记录其交互设计中值得 mobi 借鉴的做法，按「与 mobi 痛点对口程度」排序。

## 总评

ZCode 最突出的不是单点特效，而是两点：

1. **把「输入框、工具卡、审批」都当成带状态机的系统做**——IME、虚拟列表重挂、原子 token、动画时序等边界情况逐一修补，且修补留痕。
2. **几乎每个反直觉决策都有「为什么」注释**：动画语义（如"行进光不动，只表达过去"）、性能取舍（"运行态不用 spinner，因为旋转 loading 长期占渲染资源"）、演化史（"之前是滚动虚线，读起来像还在赶路，所以改掉"）直接写在代码里，多处附 CDP profile 证据。这套注释文化本身值得 mobi 学习。

---

## 一、与 mobi 痛点直接对口的（优先级最高）

### 1.1 流式工具入参预览

`packages/shared/src/streaming-tool-input-preview.ts`

- 半截 JSON 解析 + 按 `PARTIAL_JSON_STRING_FIELD_KEYS`（`file_path`/`command`/`plan`/`script`…）抓取可读预览，工具卡从流式第一个 chunk 就有内容，而不是等 `input_end`。
- 节流三常量：`EAGER_DELTA_COUNT = 1`（首 delta 立即出）、`MIN_INTERVAL_MS = 750`、`MIN_RAW_GROWTH = 8KB`；文件类单独 1s。

**mobi 对应**：ToolCallBlock 曾有 pending 审批通过后不翻 running、持续不渲染的问题（见 memory `project-tool-use-pending-permission-blocks-render`）。流式期工具卡"有内容"是体验分水岭。

### 1.2 协议内有界 bash 输出

`packages/shared/src/bash-output-display.ts`

```ts
// Bash 原始文件不会进入协议；仅传递有界头部与真实截断/文件保留事实。
output: z.string().max(150_000),
truncated: z.boolean(),
outputPath: z.string().optional(),
```

**mobi 对应**：印证出口剥离的方向（spec 在 `.scratch/tool-result-egress-strip/`）——瘦身放源头（CLI），截断事实（truncated + outputPath）作为一等字段进协议，UI 可展示"已截断，完整输出在 X"。

### 1.3 v4 wire 协议：snapshot + delta + coalesce + 重装配

`packages/shared/src/zcode-protocol-v4/`（wire-codec / wire-reassembly / coalesce / delta / snapshot 等 30+ 文件）

断线重连、乱序合并、增量快照是一等公民，独立成层。

**mobi 对应**：首拉竞态模式（SSE 早到信号被 setQueryData 丢弃、CLI 未就绪首拉失败无补拉，memory `project_first-fetch-race-pattern`）的系统性解法参考。

### 1.4 统一消息投影层

`packages/shared/src/conversation-message-projection-policy.ts`

单点裁决每条消息的可见性：`realUserInput / visibleAssistant / providerContextOnly / timelineOnly / hiddenSynthetic`，语义来源（goal-continuation、task-notification、rewind、fork…）集中在一个 Set 里管理。

**mobi 对应**：跨会话可见性、compact 生命周期、synthetic 消息的"该不该上时间线"裁决我们散在多处，值得收敛成单点投影策略。

### 1.5 Streamdown 双模式用法（对回滚决策的再校准）

`packages/ui/src/components/ai-elements/message.tsx`

ZCode 成功在用 Streamdown v2.5.0（+ `@streamdown/cjk`/`code`/`math`/`mermaid`），关键配套：

- **完成态/历史消息固定走 `static` 模式，只有真实流式走 `streaming`**（`resolveMessageStreamdownMode`），避免 React #185 崩溃；
- FNV hash + 多维 renderKey 控制重挂载，且 streaming/static 不参与 key 以免抖动卸载；
- 每条 markdown 包 ErrorBoundary，单块渲染失败只降级该块为纯文本，聊天区永不整页白屏；
- `$...$` 单美元公式启发式状态机（区分 `$5-$10` 价格、`$HOME` 变量与真公式），跳过代码围栏/inline code。

**mobi 对应**：我们 2026-09-21 回滚过 Streamdown（频闪 + 性能无提升，memory `project_streamdown-migration-research`）。它的用法可能正是当时缺的配套——重启这条线前先读 `message.tsx` 全文再决策。

---

## 二、聊天流渲染（可直接抄的细节）

`packages/ui/src/ToolCallBlocks.tsx`、`ToolCallBlocks/`

### 状态呈现

- **运行态不用 spinner**（`ToolLayout.tsx:139-147` 注释）：流式期间工具卡数量多且持续更新，旋转 loading 长期占用渲染资源——改用静态图标 + kindLabel **文字扫光**（渐变 keyframes）+ 状态文字。
- **失败态不撑开卡片**：错误详情挂状态词的 hover tooltip（虚线下划线），tooltip 内带**一键复制错误**按钮——错误暴露与展开逻辑解耦。
- 状态映射桥 `lib/mapToolStatus.ts`：pending→input-streaming、in_progress→input-available、completed→output-available、failed/stopped→output-error、denied→output-denied。

### 折叠/展开状态机

- 全局开合状态持久化在模块级 `Map<toolId, boolean>`，切任务/重挂不丢。
- 三种模式：`forceOpen`（锁死）/ `canToggle`（用户控制）/ `autoOpen`（**一次性**自动展开后仍可手动收，edit/read 完成后默认展开用）。
- `autoCollapseOnComplete` 在 running→completed **边沿**自动收起一次（agent 子卡用，避免完成后长明细摊满聊天流）。
- **收起后延迟卸载 300ms**（`ToolLayout.tsx:181-210`）：等 Radix 高度动画读完 `--radix-collapsible-content-height`，防详情区闪现超高空白；连 padding 挂内层还是高度动画节点都写明了原因。

### 入场动画只播一次

`ToolCallBlocks.tsx:26-67`：模块级 Map 按 toolId 记录"已播过入场动画"，LRU 800 条上限 + 定时清理，解决"虚拟列表重挂重复播放"这一流式 UI 顽疾；动画标记延迟一帧记录避免 React 开发态重挂误吞。

**mobi 对应**：消息窗口化（`project_message-window-store`）落地后，滑动窗口重挂必然遇到同样问题。

### 分组与嵌套

- 多个 edit 聚一张 changes-group 卡，文件 chip **测宽裁剪**（测量可用宽度决定显示几个 + `+N`）。
- 子工具卡递归渲染，仅左边线缩进。
- **联接投影而非透传**（`ToolCallBlocks.tsx:129-136` 注释）：workflowRun/workflowDraft 按 toolCallId 由宿主"join"出来，刻意不向子工具卡透传——"把父卡的 run 摘要传给不同 toolCallId 的子卡，画出来的就是别人的运行态"。

### 代码评论卡

`AssistantCodeCommentCards.tsx`：模型产出的代码评审聚合成可折叠卡片组，优先级徽标 + `path:12–34` 位置，点击打开 CodeViewer 并滚动高亮。细节：**点击前检测卡内是否有文本选区**，有则不触发打开（防划选误触）；标题剥掉模型自己写的 `[P1]` 前缀避免重复。

---

## 三、Composer（Lexical，工程最重的一块）

`packages/ui/src/LexicalChatInput.tsx`、`prompt-editor/`、`mentions/`

### 原子 token

- @文件/命令是继承 `TextNode` 且 `setMode("token")` 的 Lexical 节点（`PromptMentionNode.ts:49-192`），`canInsertTextBefore/After: false` 保证 token 不可被光标劈开。
- 显示文本（basename）与 canonical markdown（完整路径链接）分离："编辑器 offset 必须使用展示文字；canonical 仅供发送"。

### 中文一等公民（mobi 现有架构下即可做的三条）

1. **行首顿号归一为 `/`**（`LeadingChineseSlashAliasPlugin`）：中文输入法下想打 `/` 唤起命令常实际输出 `、`，只拦截「全文开头、真实手输」的顿号归一，不扩散成第二套语法。
2. **`¥/￥ → $`** 触发 skill 面板但不改写输入字符（`promptInputTriggers.ts:42-50`）。
3. **中文 query 模糊匹配特判**（`mentionSearch.ts:45-88`）：中文只走前缀/连续子串两级，不做子序列——"浏器"不应命中"浏览器操作"。

### IME 适配

- 组合输入（拼音未上屏）期间冻结面板重算，防中间态逐字过滤闪烁；Android 例外（Gboard 对拉丁词也走 composition）。
- 输入卡顿当遥测指标：每次 update 计时上报 `recordInputLag`，且用 compositionstart/end 标记排除中文组合输入误报。

### 键盘细节

- mention 补位空格的**一次性 Backspace**：光标恰在补位空格后时一次删除空格+token（体感不用按两次）。
- Option+ArrowRight 不落入 token 内部（防下次输入把 token 当被替换内容删掉）。
- Esc 关面板防弹回：保存「trigger+query 组合签名」，token 真正变化后才允许重开。
- 默认选中项 ≠ 分组展示顺序：按全局模糊分挑最佳项作初始选中。
- 「Ctrl+Enter 党」可改绑发送键，改绑后裸 Enter 自动回退为换行；请求进行中 Enter 退回给编辑器换行让用户继续打草稿。

### 性能

- 37 万文件搜索 **Worker 化 + 列式打包字符串传输**：471ms 主线程阻塞 → 31ms，带 seq 过期 + 失败降级同步路径（`workspace-file-search/workspaceFileSearchFilterBackend.ts`）。
- 工具栏溢出折叠在**不可见克隆副本**上试算档位，真实按钮不动、不丢 hover（`useComposerToolbarFit.ts`）。
- token 快照增量复用：光标在 token 内且文本未变时直接复用旧过滤结果，方向键移动光标不重算。

### 附件

- 粘贴管线：电子表格特判（Excel 复制带 file/text/html 三表示，判定后走文本分支防变图片）；纯文本 ≥15KB 自动转临时文本文件附件（"剪贴板文本 N 行" chip）。
- 拖拽双通道：文件树拖入 → mention 插入；系统外部文件 → 附件上传；嵌套 drop target 消费后 `stopPropagation` 防重复接收。

**取舍判断**：mobi 的 composer 是普通输入框，整套 Lexical 成本高；但上面"中文一等公民"三条 + Esc 防弹回 + 一次性 Backspace 在现有架构下就能做。

---

## 四、任务 / 审批

`packages/ui/src/TaskList*.tsx`、`TaskInteractionBadge.tsx`、`PermissionDialog.tsx`、`ElicitationDialog.tsx`

### 「等待确认」统一绿色胶囊（反直觉设计）

- permission / AskUserQuestion / ExitPlanMode 三种阻塞共用**一种绿色**「等待确认」徽章（DESIGN.md「Blocking interaction colors」节 + `TaskInteractionBadge.tsx:162-166`）——理由："权限确认和用户问答使用相同的'等待确认'文案，颜色分叉会让同一状态看似不一致"。大多数产品反着做。
- 徽章内嵌 **autoResolution 倒计时**：CSS 变量驱动进度填充，hover 时「等待确认」原位翻转为「停止倒计时」（双 span 叠放），点击 snooze 有幂等 ref 防重复提交；时钟只在窗口 focus/visibilitychange 时校准。

### 审批是聊天流内停靠卡片而非弹窗

`PermissionDialog.tsx`：主体停靠在聊天流中，内容按 `resolvePermissionBlockKind` 分流到 edit/execute/mcp/search/skill 等专用渲染器，**复用聊天区的 tool identity**——注释强调"避免审批弹窗和聊天区分流漂移"。

- 数字键 1/2/3 直接应答，方向键/Tab 循环，Enter 确认；反馈输入行是 listbox 最后一项。
- 统一 Refine 反馈行：普通确认窗是"Deny+理由"，workflow 窗是"拒绝并升级为 refine 反馈消息"，同一行输入只换应答目标。
- IME 组合键防护、按 requestId 清空反馈草稿防跨窗泄漏。

### 任务列表细节

- **归档两击确认**（`TaskList.tsx:138-148`）：首点只进入待确认态（按钮变确认图标），二点才执行——"用户很容易把'临时收起'误触成'怎么整条任务没了'"。
- **草稿任务**：点新建不落库，首条消息发出才建 task，列表不出现空记录。
- **单例上下文菜单**：以前每个 task row 常驻一个 Radix ContextMenu，改为 row 只上报目标、菜单树由列表级单例挂载。
- **瞬时 UI 状态随数据自动失效**：pending 归档/重命名/右键菜单三个状态由列表 effect 统一清理，任务消失不留悬挂确认态。
- **标题溢出走马灯**（`TaskTitleOverflowText.tsx`）：右缘渐隐 + hover 1s 后 40px/s 滚动，不用省略号；组件边界吞掉原生 `title` 防 tooltip 遮挡。
- **elapsed 标签基线时钟**（`BackgroundTaskElapsedLabel.tsx`）：「挂载时 elapsed + 本地流逝」与「job 上报 elapsed」取 max，网络抖动或挂起恢复计时都不回退。
- **触屏三态适配**：hover:none 时常驻 action 但不接管元信息槽——"时间、状态点仍应保留，仅真实 hover/focus 时让位"。
- 行级 handler 按 itemKey 缓存的 Map（ref 读最新数据），兼顾 memo 稳定性和实时性。

### 工作流时间线的动画语义（最值得学的设计文档实践）

- **marching 边不动**（`WorkflowMarchLight.tsx:1-10`）：行进光用静态渐变表达"过去"（控制流走过这条边），动态（心跳）只属于正在运行的站灯——"页面上唯一在走时钟的东西"。注释记载演化史："之前是一条沿路径滚动的警示色虚线，读起来像'还在赶路'，所以改掉"。
- **檐（ledge）**：横向溢出折叠的站画成一排可点小灯，点一下把站带回来。
- 统一运动词汇：四时长一条曲线（`--wf-t-fast/base/enter/ink`），只动 opacity/transform/颜色，reduced-motion 全归零。
- 草稿"笔"：流式脚本跳变还原成逐字书写（24ms/字），光标写字时稳住、追上流时闪烁。

---

## 五、面板生态

### 会话级 Git（与 Agent 会话共生，不是通用 git UI）

- **commit 预览可按"本轮 AI 改的文件"过滤**（`git-action-menu/currentSessionFileScope.ts`）：三套路径口径归一进 scope。
- **AI 生成 commit message** 附带 locale、会话变更文件路径和对话上下文；提交时消息为空自动先生成一次。
- **切分支受阻 → switch-assist 向导**：并行算受影响文件 + staged 路径，引导"先 commit 再切"，不是报错。
- git graph **hover 关系高亮**：hover 一个提交，相关泳道满透明度、其余压暗（`relatedHashes` 预计算零成本联动）。
- 搜索能命中**折叠文件**里的 diff 内容：先批量补齐再全局匹配，命中后自动展开+滚动定位。

### 产物卡「乐观 UI 的悲观验证」

`AssistantPreviewCards.tsx`：AI 回复中提取的文件/网站卡，先本地解析否则批量 RPC `checkFilesExist`，**全部通过后一次性发布**——杜绝"先闪一批再被替换"；用语义签名防 timeline 重建重复发 RPC；校验通过的 PPTX 卡可自动打开（一次性消费 key 防晚到候选误触发）。

### 终端保活范式

- PTY/xterm 所有权**上移出 React 生命周期**（`sidePaneTerminalSessionRegistry.ts` 模块级单例）：组件卸载只 `detachDom`（hostEl 在 stash div 与容器间物理搬移），重挂按 persistentKey 复用，scrollback 跨面板保活。所有 tab `forceMount` + hidden，关闭面板只收 UI 不 dispose。
- 是"保活类需求"的通用范式，mobi 的会话保活/恢复可参考。

### 其他亮点

- **白板 → 聊天**：手绘草图一键导出 PNG 注入聊天作多模态输入（`dispatchWhiteboardAddToChat` 自定义事件）。
- **会话文件活动矩形树图**（`TreemappingPane.tsx`）：从最后一条 assistant 消息提取读/写/改/删事件，`sqrt(weight)` 编码面积（防大改动挤成长条）、状态编码颜色、近 2s 触达高亮——会话"干了什么"一眼可见。
- **命令中心**（`command-center/CommandCenterDialog.tsx`）：单输入 `>`命令/`#`会话/`@`文件前缀 scope 与 pill tabs 双向同步；会话命中后打开任务自动滚动并高亮 snippet；关闭态把输入降级为空数组避免隐藏弹窗每 token 重算。
- **快捷键体系**（`shortcuts/bindings.ts`）：`event.code` 反查物理键（Shift+7 任何布局都录出"7"）、IME 组合与长按 repeat 不录不匹配、"纯 Shift+可打印字符"在可编辑元素内自动放行、显式空数组=用户清除（tooltip 与实际生效严格一致）——把中文输入法当一等公民的键盘系统。
- **PPTX 元素级引用**：对演示文稿单个 shape 画评论，注入聊天带 JSON 围栏 + directive 明确"评论只作用于引用元素"——比整页截图反馈精细一个量级。
- **PreviewPane**：类型双阶段路由（file 按扩展名提升为专用 source）；PDF 分段加载（<2MB 全量 / 大文件 256KB chunk）；resize/sliver 阶段用静态"代码行纹理"占位防闪烁；markdown/svg 有 preview/code 双视图切换。
- **弃 Radix Collapsible 的性能决策**（`GitPaneChangeCard.tsx:97-99`）："几十个 Collapsible 会让 click 出现 600ms+ long task"——每行就是普通按钮 + 仅展开行渲染内容，注释附 profile 证据。

---

## 六、协议与数据层补充（抽读）

- **RPC 框架**（`packages/rpc/`）：channel client/server、持久化协议、序列化、logging/网络遥测中间件——桌面多进程与远程连接共用一套 RPC。
- **协议即文档**：shared 里每个交互概念都有独立 schema 文件（`tool-call-summary`、`tool-identity`、`subagent-markdown-selection`、`session-visible-content`…），协议字段名即交互词汇表。
- **注释文化样本**：bash-output-display 的"原始文件不会进入协议；仅传递有界头部与真实截断/文件保留事实"一句话说清整个设计决策。

---

## 七、落地建议

### 短期可落地（不动架构）

1. 流式工具入参预览（半截 JSON + 字段抓取 + 750ms 节流）
2. 「等待确认」统一徽章（含倒计时进度，可选）
3. 失败态 tooltip 一键复制错误
4. 工具卡折叠状态按 toolId 持久化
5. 归档/删除两击确认
6. composer 中文适配三条（行首顿号→`/`、IME 冻结面板、中文匹配特判）

### 中期方向性（与进行中特性合并考虑）

1. 消息可见性投影层单点化（对应跨会话可见性 + compact 的裁决收敛）
2. 协议内 bash 输出截断字段（与出口剥离二期合并做）
3. Streamdown 重启评估：先精读 ZCode 的 `message.tsx`（static/streaming 双模式 + 分块 ErrorBoundary + hash key），再决定是否推翻 9 月的回滚决策
4. 消息窗口化落地后：入场动画 LRU、折叠状态持久化

### 工程文化

- 「为什么」注释 + 动画语义注释 + 性能决策附 profile 证据——建议在 `docs/conventions/` 中明确提倡（示例：`WorkflowMarchLight.tsx` 的演化史注释、`GitPaneChangeCard.tsx` 的 long task 证据）。

---

## 附：调研方法与回查

- 四份子报告全文在调研会话记录中（含全部文件路径+行号）。
- 源码：`~/workspace/github/study/ZCode/`（只读调研，未改动）。
- 关键入口文件：`packages/ui/src/ToolCallBlocks.tsx`（工具卡）、`packages/ui/src/LexicalChatInput.tsx`（输入区）、`packages/ui/src/PermissionDialog.tsx`（审批）、`packages/shared/src/zcode-protocol-v4/`（协议）、`DESIGN.md`（设计系统全文，含色板/字体/动画规范）。
