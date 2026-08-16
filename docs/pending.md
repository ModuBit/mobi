# 待确认逻辑

记录暂时跳过、稍后需要深入梳理的逻辑。

> 已完成/已失效条目定期清理，历史内容见 git log。**条目编号保留不复用**（代码注释、memory 中有 `#40` 式引用）。

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

## 15. 项目列表分页/限制展示数量

**现状**：

- `SidebarProjects`（PC）和 `MobileMenuDrawer` 内嵌项目列表（Mobile）均全量展示所有项目折叠组
- 项目组本身是折叠的（只显示一行标题），占用空间小
- 项目数量从会话 path 聚合而来，当前场景下一般 3\~8 个，不会无限增长

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

## 40. 消息列表：Bubble.List 全量渲染已恢复，数据层窗口化（第二步）待做

**状态**（2026-08-03）：方向已定 —— **抛弃 react-virtuoso 虚拟化，切回 antdx Bubble.List 全量渲染**。第一步（恢复 Bubble.List 完整态）已完成并 E2E 验证；第二步（数据层窗口化钳制 DOM）待做。

### 决策过程

react-virtuoso 虚拟化（#10）落地后，**prepend 后持续上滚跳动**严重（估高→RO 实测异步修正，14 次跳动/收缩 3509px）。修复路径逐条排除：

- **内容估高启发式**（`heightEstimates`）不可行：`content` 是 ReactNode（markdown/代码块/工具卡），高度与字符数无关；`maxHeight` 组件（折叠态受 CSS 限高）、group 计算（折叠 vs 展开高度差极大）使估高对离群 item 必错。
- **离屏预实测**（A）准但复杂（离屏渲染须与真实渲染同 CSS/markdown）。
- **加大 `increaseViewportBy`**（B）依赖 virtuoso RO 异步测量，未验证。
- **数据层窗口化**（C，参考 hapi）彻底消除跳动（全量真实高度，无估高无修正），代价是 DOM 随总量增长 → 需 window 钳制。

最终选 C：抛弃虚拟化，Bubble.List 全量渲染。理由：虚拟化的所有坑（估高跳动、firstItemIndex、key 碰撞、遮罩、followOutput trap、scroll-fight）都是虚拟化副产物，全量渲染全部消失；唯一代价（DOM 增长）由第二步 window 解决。

**为何不照搬 hapi**：hapi `message-window-store` 自管 cache（不靠 react-query），因为 react-query infinite query 保留所有 pages 的模型与"trim 旧页省内存"冲突。mobi 用 react-query 管 messages，故 window 走 **bubbleItems 层 trim**（B）——不动数据层、零 trace 断裂风险（mobi `reduceChatBlocks` 的 sidechain parentUUID 链 / tool\_use-result 配对在 messages 层 trim 会断），契合 react-query。详见 brainstorming 决策记录。

### 第一步：恢复 Bubble.List 完整态（✅ 已完成）

**改动**：

- 新建 `packages/web/src/components/chat/BubbleListChat.tsx`：antdx `Bubble.List`（`autoScroll={false}`）+ `useStickToBottom`（适配 `.ant-bubble-list-scroll-content`）+ 恢复 prepend 维持 scrollTop（`pendingRestoreRef` + useLayoutEffect delta pin）/ fill 级联 / 顶部 skeleton / prefetch。
- `ChatContainer.tsx`：`VirtuosoChatList` → `BubbleListChat`，CSS 回到 `.ant-bubble-list-scroll-box/content` 式。
- `useStickToBottom.ts`：内容层 selector `[data-testid='virtuoso-item-list']` → `.ant-bubble-list-scroll-content`，逻辑（手势 stop / 几何 re-follow 延时 / smooth 门闩 / pointerDown 守卫）全保留。
- 删 `VirtuosoChatList.tsx` + `VirtuosoChatList.test.tsx`（虚拟化代码留存于 tag `chat-list-virtualized`，已 push）。

**E2E 修复的一个 bug**：`BubbleListRef.scrollBoxNativeElement` 在 `useLayoutEffect` 时为 null（antdx 内部 effect 时序晚于父组件 useLayoutEffect），导致 scrollBoxRef 不设、RO 拿不到 scroller。改用 `querySelector('.ant-bubble-list-scroll-box')`（旧代码方式，不依赖 ref 时序）。

**E2E 验证**（cp dev DB 副本 213 条会话）：


| 项                   | 结果                                     |
| ------------------- | -------------------------------------- |
| 渲染（Bubble.List 结构）  | ✅ scrollBox/content DOM                |
| 初始贴底                | ✅ dist=-1，RO fire                      |
| 流式期贴底               | ✅ 全程 maxDist=0 / over80=0 帧            |
| 流式期 DOM 稳定          | ✅ 10 bubble 0 重建                       |
| prepend 历史加载        | ✅ 33→65 bubble                         |
| prepend 维持视口        | ✅ scrollTop=0+delta，原首项仍在视口            |
| prepend DOM 稳定      | ✅ 原 33 bubble 0 重建                     |
| useStickToBottom 协调 | ✅ wheel following=false，RO 不破坏 restore |


**保留**（期间优化全部保留）：`reconcileChatBlocks`/`reconcileBubbleItems` 结构化共享、`buildChatBubbleItems`、`CollapsibleUserMessage` RO measure、`FilePathText` CSS ellipsis、streaming 修复、通知系统、所有 `domain/chat` 逻辑。

### 第二步：数据层窗口化（C-2 已完成，C-1 待做）

**C-2（store 去.pages + 渲染层 window）已完成（2026-08-04）**：新建 `messageWindowStore`（自管 external store，扁平 `DecryptedMessage[]` + 独立游标 + generation 防竞态）替代 `useMessages` 的 `useInfiniteQuery`（消除 react-query pages + SSE append page\[0\] 三重不匹配）。store 全量不 trim（C-2 钳 DOM 不钳内存）。trim 推到 BubbleListChat 渲染层（reduce 之后，sidechain 天然完整）。window 动态 N \[400, 800\]（对齐 hapi 双阈值）+ 贴末尾⇄滑动状态机 + N=800 offsetTop restore。SSE/optimistic/submitted/cancel 全改调 store action。单测 1411 + typecheck + lint 全绿。spec: `docs/superpowers/specs/2026-08-03-message-window-store-design.md`，plan: `docs/superpowers/plans/2026-08-03-message-window-store.md`。

**C-1（store 层 turn 边界 trim 钳内存）待做（2026-08-15 前提已验证，暂不实施）**：在 store 加按 turn 边界 trim（user message + compact-summary + context-cleared 为 turn 起点，保整 turn 保 sidechain）。**前提已实证**（2026-08-15，dev DB 5 会话 227 条 sidechain 消息）：交错模式全部 `U S+`（sidechain 落在 user turn 内），跨 turn 违反 0——「SDK Task 同步阻塞、subagent 不跨 user turn」成立，按 turn 切不会断 sidechain。实施要点（评估过）：turn 起点在原始 DecryptedMessage 层判定（顶层 role=user + compact 边界 + context-cleared，不依赖 normalize）；阈值建议 1500（> 渲染层 EXPAND_WINDOW=800 不影响上滚体验区）；fetchOlder prepend 天然把裁掉的历史加回（内存按需回升，新消息再触发收敛）；appendMessage 高频只做 O(1) 长度判断，跨阈值才 O(n) 扫边界。

**E2E 验证**：C-2 window 滑动/N=800/offsetTop 单测覆盖不到（jsdom offsetTop=0），E2E 受 dev session 恢复环境限制（runner 不恢复 demo session），留实机测（deploy 含 C-2 二进制后真机验证 window 滑动 + N=800 裁顶 + offsetTop restore + 重连补拉 merge + 流式 snapshot update）。

**相关文件**：

- `packages/web/src/components/chat/BubbleListChat.tsx` — Bubble.List + useStickToBottom + restore/fill/prefetch
- `packages/web/src/components/chat/useStickToBottom.ts` — 贴底跟随（适配 Bubble.List）
- `packages/web/src/components/chat/ChatContainer.tsx` — 数据流（reconcile/streaming/通知）

**相关 memory**：\[\[project\_bubble-list-virtualization\]\]（虚拟化已废弃，tag `chat-list-virtualized` 留存）、\[\[project\_virtuoso-mount-flicker\]\]/\[\[project\_scroll-fight-pointer-drag\]\]/\[\[project\_virtuoso-prepend-firstitemindex\]\]/\[\[project\_virtuoso-followoutput-trap\]\]/\[\[project\_virtuoso-key-collision\]\]（virtuoso 踩坑记录，方向已废弃但留作参考）。

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

- ~~`supervisor.stop/shutdown` 仅发 SIGTERM，子进程挂起信号时 finish 永不完成~~（✅ 2026-08-16 已修）：`terminateProcess` 统一三处停止路径（stop/restart/shutdown）——SIGTERM + 5s 宽限期升级 SIGKILL；升级回调以 child 引用比对防误杀重拉的新进程，`handleExit` 清理定时器双保险。兼容性：正常优雅退出（远快于 5s）不受影响；e2e 脚本与 dev 直跑形态（`launch.json` 的 Hub/Runner Start-Sync 不走 supervisor）无涉；Supervisor 调试形态下断点暂停 = 挂起，SIGKILL 升级恰是预期行为。单测 +5 用例
- `cleanupOrphans` 按持久化 pid 探活击杀，存在 pid 复用误杀理论风险（有探活，窗口极小，维持记录）
- ~~`runSupervisor` 编排层零单测覆盖~~（✅ 已过时）：`tests/supervisor/` 5 个测试文件，`supervisor.test.ts` 注入式 fake 进程 20 用例覆盖状态机主体（stop/onEmpty/restart/shutdown 有序/backoff 竞态/SIGKILL 升级）；`index.ts` 编排层仍薄，维持
- B 路径 launchd/systemd 真机验证未做（需真机操作，维持）
- `hub start-sync` 直接调用时无端口范围校验（仅 service start/restart 经 parseHostPortArgs 校验）；start-sync 基本是内部路径（supervisor spawn / autoStartServer），低优维持
- ~~`hub start` 不读 profile 的端口配置~~（✅ 2026-08-15 已修）：desired state 兜底端口改为感知 profile env（`profilePortOrDefault`，supervisor 继承 CLI 的 `MOBI_LISTEN_PORT`），`mobi hub start --profile e2e` 不带 `--port` 也落在 2224。e2e bootstrap 脚本仍显式传 `--port` 作双保险

---

## 47. 桌面端应用（macOS）— 可行性结论与技术选型（2026-08-15 探索）

**背景**：探索 mobi 桌面化。需求已澄清：核心动机 = 本地一体化零部署 + 原生体验（Dock/通知/菜单栏）+ 降低分发门槛；CLI 留在系统终端（桌面 app 只承载 Web UI）；先只做 macOS；本地 hub 保留局域网多端访问（手机 PWA 不受影响）。

**核心结论**：**可行性高，mobi 核心改造量接近零**。mobi 二进制已是「hub + runner + Web 资产」自包含单体（bun `--compile`，\~93MB），supervisor 已解决「托管 hub+runner、崩溃退避重启」。桌面化的本质是给它套一个原生壳。

**架构（sidecar 模式）**：

```
mobi.app（dmg 分发）
├── 原生壳（Tauri 或 Electron）    ← 窗口、Dock、通知、菜单栏、自动更新
├── mobi 二进制（sidecar，现有产物） ← 启动时等价 mobi service start（复用 supervisor 探活/复用）
└── WebView                        ← 加载 http://127.0.0.1:<port>（现有 Web UI 零改动）
```

行为模型：打开 app = 自动 `mobi service start`（已运行则复用，supervisor IPC 探活可判断）；`mobi claude` / 浏览器 / 手机 PWA 全不受影响——同一个 hub 实例。关窗口可收进菜单栏，hub 继续跑。

**壳技术栈对比**（2026-08-15，Tauri 2 文档已核实 sidecar/updater 为一等公民）：


| 维度         | Tauri 2                                                   | Electron                      |
| ---------- | --------------------------------------------------------- | ----------------------------- |
| 安装体积       | \~110MB（壳只占 \~15MB）                                       | \~250MB+（Chromium \~160MB 叠加） |
| 运行内存       | WKWebView 共享系统 WebKit，\~150-250MB                         | 独立 Chromium，\~300-500MB       |
| 拉起 mobi    | Rust shell plugin spawn（几十行 Rust）                         | Node child\_process（TS 最顺手）   |
| 壳自动更新      | updater plugin（签名更新）                                      | electron-updater（最成熟）         |
| 签名公证       | 均需 Apple Developer $99/年，工作量相当                            | 同左                            |
| Web UI 兼容性 | ⚠️ WKWebView 的 SSE/Web Push 行为需实测（WKWebView 不支持 Web Push） | ✅ Chromium 与浏览器一致，零风险         |


**推荐**：Tauri（常驻菜单栏型应用对体积/内存敏感，Rust 代价集中在壳层一次性投入，估 &lt;1000 行）。**建议先做半天级 PoC**（壳 + 手动 `mobi service start` + WebView 加载现有 Web UI，验证 SSE/Socket.IO/cookie 登录在 WKWebView 的实际行为），通过则定 Tauri，不通过退 Electron。

**两个与壳选型无关的共同改造点**（真正要动 mobi 的地方）：

1. **通知桥**：Web 通知走 Web Push（PushService/NotificationHub），WKWebView/Electron 渲染进程都收不到——桌面端通知需 Web UI → 壳层事件桥（Tauri emit / Electron IPC → 原生通知）
2. **登录态注入**：app 自己拉起的 hub 应自动注入信任凭证跳过 JWT 登录界面（hub 侧能力，「零部署」体验的关键）

**mobi 二进制更新**：与壳无关——复用现有 `mobi upgrade`，或随壳捆绑新版。

**状态**：探索结论已记录，待决策是否启动（先 PoC 验证 WKWebView 兼容性）。

**优先级**：待用户决策。
