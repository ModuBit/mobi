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

---

## 48. CLI 二进制瘦身——claude 二进制去内嵌（统一回退链 + 双打包形态）

**背景**（2026-08-16）：CLI 二进制从 ~300M 涨到 372M，根因**不是业务代码**——是内嵌的 Claude Code 二进制（`packages/cli/tools/archives/claude-*.bin`，当前 272M）在膨胀。SDK 版本号是 `^` 浮动的，每次 `bun install` 悄悄升级 → 构建时 `downloadClaudeBinary` 拉对应版本 claude → 官方二进制本身逐版变胖（npm registry 实数据：darwin-arm64 从 2.1.218 的 243MiB 涨到 2.1.233 的 292MiB，15 版 +50MB）。体积构成：claude 272M + bun runtime ~90M + difftastic/ripgrep ~15M + JS/web assets 几 M。

**方案（已讨论定方向）**：`getClaudeExecutablePath()` 改为统一回退链，两种打包形态跑**同一份代码**：

```
1. MOBI_CLAUDE_PATH env（不变，escape hatch）
2. bunfs 内嵌命中？   extractFromBunfs → 真实路径（SDK 内容寻址缓存管复用）
3. 磁盘缓存命中？     ~/.mobi/cache/claude/<platform>-<version>.bin
                     existsSync + verifySha256(manifest checksum)
4. 下载               tmp+rename 原子落地 + sha256 校验
5. 失败 → undefined   （PATH 兜底，不变）
```

- **预带版**：链 2 命中，离线可用（现状行为）
- **Lite 版**：链 2 miss，走 3/4；下载一次后 3 永远命中，体验与预带版一致

**关键改动点**：

- `embeddedClaudeBinary.bun.ts`：`loadEmbeddedClaudeBinary` 未命中 feature 时**返回 undefined**（现抛错）；嵌入与否用编译期 feature `MOBI_EMBED_CLAUDE` 门控——lite 构建不传该 flag → `import ... with {type:'file'}` 分支被常量折叠消除 → **不要求 .bin 存在**（文件缺失时 bun build 直接报错，必须靠 feature 消分支）
- `build-executable.ts`：加 lite 开关（跳过 `downloadClaudeBinary`、feature flags 不含 `MOBI_EMBED_CLAUDE`），平台 feature 两种形态都传（选 difftastic/ripgrep target 用）；根 package.json 加 `build:exe:lite` 入口
- **版本 + checksum 编译期烧入**（最易踩坑）：下载分支需要 `manifest.json` 的版本与 checksum，lite 包运行机器上没有 node_modules，`readSdkVersion`/`readSdkManifest` 必须在构建期 define 烧死，不能运行时 read
- 下载逻辑搬到运行时模块：`scripts/downloadClaudeBinary.ts` 核心（URL 构建/stall 重试/sha256/tmp+rename）抽到共用模块，构建脚本与运行时 resolver 共用；其依赖 `claudeBinarySource.ts` 全是纯函数

**防重复下载机制**（三层，均有现成参照）：版本寻址路径 + sha256 校验（`downloadClaudeBinary` 现有缓存分支直接复用）；tmp+rename 原子写防并发半成品（进程内再加 promise 去重）；SDK `extractFromBunfs` 本身即内容寻址 + existsSync 短路的同款模式（且对非 `$bunfs` 路径原样返回，下载分支不会二次拷贝）。

**收益**：dist-exe 从 372M → ~100M；mobi 升级但 SDK 版本未变 → checksum 相同 → 不重新下载；离线/下载失败回退链不变。

**下载时机**：懒加载（首个 claude 会话前）为底线；体验更优是 `service start` 时后台预取 + 懒加载兜底（共享同一 promise）。

**相关文件**：

- `packages/cli/src/claude/sdk/claudeExecutable.ts` — 回退链主体
- `packages/cli/src/runtime/embeddedClaudeBinary.bun.ts` — undefined 语义 + feature 门控
- `packages/cli/scripts/downloadClaudeBinary.ts` / `packages/cli/src/runtime/claudeBinarySource.ts` — 下载与校验逻辑复用源

**优先级**：待用户决策启动。

---

## 49. 插件化架构观察项——DeepSeek Harness / cordis 借鉴评估（2026-08-16）

**背景**：DeepSeek 开源 [dsh](https://github.com/deepseek-ai/deepseek-harness)（一切即插件，底层 [cordis](https://github.com/cordiverse/cordis)）。已读其架构文档与 cordis-primer，评估对 mobi 后续扩展特性（skill/MCP 管理、插件管理等）的借鉴价值。

**核心结论**：**思想可抄，框架不引入**。dsh 的插件化解决的是「自己就是 harness」的问题——模型适配器、工具注册表、agent loop 都自研所以都得可替换。mobi 的 agent loop / 工具协议 / skill / MCP 执行层都在 Claude Agent SDK 里，mobi 是 SDK 之上的控制面 + 远程 UI，没有自己的 agent loop 可插件化。且 cordis 与 dsh 均 developer preview、有 breaking changes，为一个不存在的扩展面引入重依赖是架构错配。

**值得借鉴的四个设计思想**：

1. **Seam 三分法**：可替换能力 = Service Definition（声明接口）+ Provider（实现）+ Consumer（使用方），三者一并设计才算 seam。mobi 已有事实 seam：gateway（CCR backend，当时的「核心接口 + 兜底换 backend + capability 声明」正是此思路）。做扩展特性前先问：是给 claude 配置做管理面（CRUD + 配置生成，无 seam），还是 mobi 自己插拔能力（自定义面板、通知渠道等，才需要 seam）
2. **注册皆可逆副作用**：每个注册（路由/监听器/定时器）必须有对应 disposer，teardown 自动撤销。hub 的 socket handler / SSE / DB watcher 可以此为编码规范（一个简单 effect 风格辅助函数即可，不需要 cordis）
3. **类型化事件 + 分发模式**：emit / waterfall（环绕中间件、可短路）/ parallel / serial。mobi 事件跨进程（CLI→hub→web），机制不能照搬，但事件域三分法可参考：session 事件 = 持久事实、agent 事件 = 实时协调、能力事件 = 策略挂载
4. **配置分层叠加**：profile → bundle → patch 逐层叠加、上层可整体替换下层条目。做 skill/MCP 管理时「默认 → 用户级 → 项目级 → 会话级」分层配置模型直接可抄（Claude Code 自家 settings 同构）

**决策标准**（等第一个「真插件」场景出现再定）：

- 管理面需求（浏览/启停/配置已装 skill 与 MCP server）→ 纯 CRUD + 配置生成，不需要插件框架
- 宿主面需求（第三方给 hub 加 API 路由 / web 加面板 / 加通知渠道）→ 先手写 ~100 行内部插件注册表（install/register/dispose + 类型化 key），跑通 2-3 个真实插件后再评估 cordis

**实施前回头读**：dsh 的 [capability-seams](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/capability-seams.zh.md) 与 [extension-cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md)。

**优先级**：低，触发式。skill/MCP 管理特性启动时激活本条。

---

## 50. settings.json 职责拆分（2026-08-16）

**背景**：`~/.mobi/settings.json` 目前承载了过多职责（machine 身份、token、hub server 配置、claudeEnv、超时、bash 注入开关，后续还要加 webTools 配置），读写方横跨 hub / runner / CLI 多进程，靠文件锁 + 原子写维持一致性。

**方向**：按使用方拆分成职责分明的配置文件，共用的放共享文件，hub 用的、runner/cli 用的、插件用的各自独立，避免单一文件成为所有进程的写入热点与耦合点。

**注意**：拆分时需兼容现有字段的迁移读取；`updateSettings` 的文件锁与 tmp+rename 原子写模式应保留到各拆分文件。

**优先级**：中。web 工具配置（webTools 段）落地后启动评估——它会让 settings.json 再多一个高频读写的配置段，正好是拆分的触发点。

---

## 51. Web 工具配置页打磨项（2026-08-16；2026-08-17 review 修复后更新）

**背景**：自定义 Web 工具特性（toolAliases 替换内置 WebSearch/WebFetch）已落地，配置页 V1 固定取第一台在线机器。E2E 与最终审查遗留以下打磨点：

1. **多机选择器**：Web 工具卡片固定取第一台在线机器，多机环境下其余机器的配置在 UI 上不可达（hub 侧按 machine 路由的能力已就绪，纯前端工作）
2. **凭据清除通道**：协议已支持（null=清除），但 UI 仍未提供"清除凭据"入口——彻底删除已存凭据仍需手改 settings.json
3. ~~**禁用已选 provider 的预校验**~~：已实现（前端拦截 + 引导先清路由；allowClear 后 teardown 流程畅通）
4. **海外用户回退**：toolAliases 常驻注入意味着内置 WebSearch/WebFetch 在任何网络环境都被替换（未配 provider 即报错）。当前按"国内环境内置不可用"接受；若有海外使用诉求，需加"切回内置"选项

**优先级**：低。按需逐项处理。

---

## 52. Web 工具提交协议：在场性扩展到路由字段与 providers 条目（2026-08-17）

**背景**：凭据键已实现"在场性"语义（不在场=保持、null=清除、非空=覆盖），但 `searchProviderId`/`fetchProviderId` 与 `providers` 数组仍是**整体替换**语义——每个 UI 调用方必须全量重建配置（web 侧 `providersWith()` 回填所有 id + 路由字段），任何未来调用方（CLI 直连操作、第二个设置入口、快捷开关）漏掉回填就会静默清空机器上的配置。2026-08-17 code review 的 altitude 角度指出这是「客户端全量重建补偿写协议」的结构性问题。

**方向**：把在场性协议扩展到整个 submission——providers 条目不在场=保持该条目、路由字段不在场=保持现值、显式 null/空 providers=清除。runner 侧 `mergeProviderCredentials` 升级为完整配置 merge，web 侧删掉 `providersWith()` 回填逻辑、改为只提交变更的字段。

**前置**：协议变更是 breaking change（旧语义下「缺字段=清除」被部分调用方依赖，如 allowClear 路由清除靠缺字段实现），需要版本协商或兼容窗口；与 pending #50（settings.json 拆分）的迁移时机一并考虑。

**优先级**：低。当前 web 是唯一写入方、`providersWith()` 已封装集中，风险可控；第二个写入方出现时升级为高。

---

## 53. 撤回刚发消息（发送后未响应时 Esc 回填输入框）

**状态**：✅ 2026-08-31 已实施（方案 A，随批次 A 停止×队列语义闭环，spec：`docs/superpowers/specs/2026-08-31-stop-queue-semantics-design.md`）。撤回走 `messages-facts` 的 `withdrawn` fact → hub 软删除 + SSE `message-withdrawn` → web 清窗 + 回填 composer，并带两段式复验（interrupt 返回后复验「无输出」，等待期出输出降级普通停止）。方案 B 保留为后续优化项，已知边界（resume 复活）不解决。以下为原始设计记录。

**背景**（2026-08-18 讨论）：对齐 CC CLI 的 Esc 行为——发出消息后、还没响应时停止，这条消息回到输入框，可改错字重发。用户诉求很具体：「发出去发现发错/错别字，紧急终止后想改重发」。

**最终语义**（三分支，统一进 Stop/interrupt，2026-08-18 定）：

```
interrupt（用户停止）
 ├─ queue 里有消息 → 正常 interrupt，队列下一条照跑        【现有 Stop 语义，零改动】
 └─ queue 里没消息：
      ├─ 最后一条 user 后已有输出 → 正常停止（生成到一半）
      └─ 最后一条 user 后无任何输出 → 撤回：软删除这条 + 回填 sender   【新增】
```

**为何不能硬套 rewind**：rewind 要重启 query（成本高）；且「未响应」场景里消息大概率已 push 但 CC 可能未落 .jsonl，走 rewind 是假锚点。故撤回是比 rewind 更前置、更轻的「软删除 + 回填」，不重启 query。

**实现方案（简单版 A，复用现有件）**：

- interrupt 复用现有 abort 链路（web `sessions.abort` → CLI `handleAbortRequest → queryRef.interrupt()`）
- 三分支判定在 **CLI** 做（queue 状态 + transcript 是否已输出，CLI 都是第一手真相）
- 「queue 空 + 无输出」→ CLI 上报 Hub 软删除最后一条 user（复用 `softDeleteMessagesFrom(seq)`）
- Hub 软删除 + 转 SSE → web 清窗 + 回填 sender（复用 rewind 的 draftRequest 机制）
- 判定细节：「queue 空」对应消息已 `collectBatch` 取出（in-flight 已 push）；「无输出」= 本轮尚未收到任何 assistant 消息（text/tool/stream_event）

**已知边界（resume 复活）**：软删除只清 Hub/Web，CLI `.jsonl` 里那条 user 还在 → 下次 resume 复活为「最后一条无回复消息」。CC CLI 无痕是因为「提交前拦截」（消息没进 transcript），mobi 隔着 SDK 是「提交后软删除」，无法零成本对齐。

**优化点（待做，方案 B）**：撤回时记录 pending 截断锚点，下次 resume 用现成 `resumeSessionAt` 顺带裁掉 `.jsonl` 残留行，做到 resume 无痕。当前不重启 query，下次自然 resume 时生效。

**相关文件**：

- `packages/cli/src/claude/claudeRemoteLauncher.ts` — `handleAbortRequest`（三分支判定注入点）
- `packages/cli/src/claude/claudeRemote.ts` — `sdkOutputLoop`（「无输出」判定）
- `packages/hub/src/store/messages.ts` — `softDeleteMessagesFrom`（软删除复用）
- rewind 回填链路：`rewindStore.ts` / `draftRequest` / `collectRewindBatchText`

**优先级**：简单版 A 已实施（2026-08-31）；优化点 B 后续。

---

## 54. CLI→Hub 消息元数据事件散乱，需收敛（2026-08-18）

**背景**：2026-08-18 讨论 isReplay（CC 接收确认）时，梳理 CLI→Hub 的 socket 事件发现，消息的「native 事实」被拆成多个独立事件、各写一个字段，随新字段的加入持续膨胀：

- `messages-submitted` —— 写 `queue_state`/`submitted_at`（排队轨道）
- `messages-bound` —— 写 `nativeId`（push 预设 uuid）
- `messages-native-attached` —— 补写 `nativeSessionId`（CC 会话建立后）
- `messages-acked`（规划中）—— 写 `nativeAckAt`（CC 回显确认）

概念上都是「同一条消息的元数据」，却散成 4 个事件、4 次往返、4 种载荷结构，Hub 侧也各写各的字段。加上命名风格不统一（`message` 无前缀 / `messages-*` 复数 / `rewound-truncated` vs `rewind-completed` 同族不同词 / `terminal:*` 冒号分隔），进一步放大散乱感。

**方向**（待定，先记录不实施）：

- 收敛为统一「消息 native 事实」事件（合并 bound/attached/acked 或统一载荷结构），一次往返写齐 nativeId + nativeSessionId + ackAt
- 或至少统一命名规范（native 事实族统一 `messages-native:*` 之类的前缀）

**注意**：收敛是 breaking change（旧事件名有 CLI/Hub 双侧消费方），需版本协商/兼容窗口；与 isReplay（ack 事件）落地时机一并考虑——若 ack 先落地，散乱会再加一个事件，收敛成本更高。

**优先级**：低。先按现状加 `messages-acked` 完成 isReplay，收敛独立立项。

---

## 55. StatusBar 本轮计时的起点应落 runtime_state（✅ 2026-08-22 已实施，方案 1）

**状态**：已按方案 1 落地——CLI `SessionBase.onRunningChange` 在 running 翻转 false→true 时经 `run-started` socket 事件上报轮次起点；hub `sessionCache.handleRunStarted` 落库 `runtimeState.runStartedAt`（时间倒退保护：重报旧值静默忽略）+ SSE 推 runtimeState patch；web `ChatContainer.resolveRunStartedAt` 取 runtimeState 权威值与窗口内 `lastUserMessageAt` 的最大值（单调不回跳），StatusBar 计时不再随消息窗口化失守。以下为原始调研记录。

**背景**：composer 状态栏计时（AgentLoadingBubble）刷新页面后曾归零，已用「最后一条 user 消息时间戳」（`lastUserMessageAt`，2026-08-21 commit 19dd8db1）作过渡方案。但消息列表窗口化后，长运行会话的窗口内可能不含本轮 user 消息——计时起点失真（回退 mount 时间或窗口内错误的旧轮消息）。

**现状链路事实**（2026-08-21 调研）：
- `running` 既不在 runtime_state 也不入库——hub 内存 sessionCache 实时态，CLI 经 `session-alive` 心跳（volatile）周期上报；hub 重启即丢，心跳恢复
- `runningAt` 不能复用：`sessionCache.ts` 每次心跳都无条件覆盖 `runningAt = t`（语义 = 最近心跳时刻，非 running 翻转时刻）
- `RuntimeStateSchema`（shared）现无任何时间字段

**方向**（讨论中，待定）：
1. CLI 轮次开始（收到用户消息 / query 启动）上报精确时间 → hub 写 `runtime_state.runStartedAt`（落库 + SSE，与 context-usage / goal-status 通道同构）→ web StatusBar 优先用它，回退 lastUserMessageAt
2. 或改 `runningAt` 语义：仅在 running 翻转时更新（心跳不覆盖）——改动最小，但 hub 重启后丢失，精度受心跳周期限制

**相关文件**：`packages/shared/src/schemas.ts`（RuntimeStateSchema）、`packages/hub/src/sync/sessionCache.ts`（handleSessionAlive / handleRunStarted）、`packages/hub/src/socket/handlers/cli/sessionHandlers.ts`（run-started handler，参照 context-usage）、`packages/cli/src/api/apiSession.ts`（reportRunStarted）、`packages/cli/src/agent/sessionBase.ts`（onRunningChange 翻转上报）、web 透传链 `ChatContainer → ChatComposer → StatusBar → AgentLoadingBubble`

**优先级**：已完成（方案 1）。

---

## 56. 消息信封「投影税」——native schema 包裹层的消费成本（2026-08-25）

**背景**（2026-08-25 assembler 深挖时梳理）：CLI 把 Claude Code 原生消息（RawJSONLines）整体塞进 mobi 信封 `{ role: 'agent', content: { type: 'output', data: <原样 body> }, meta }` 后存 Hub DB。信封是**加包装不是改内容**——`data` 不透明透传，Hub 不做 Zod 校验不剥字段（无 metadata SWR 死循环那类 strip 风险），native schema 演进无损保存。当前无正确性问题（DB 是只读投影、无回喂 SDK 路径、web 有 `safeStringify` 兜底）。

**代价（投影税，三处）**：

1. **层层下钻**：web 取 native 字段要 `content.content.data.message.xxx` 多级取值（`normalize.ts` 的 `extractAnthropicMessageId` 四级链、`getField` 的 snake/camel 双格式兼容都是为这层包装交的税）
2. **双层 schema 演进**：信封（shared 定义）与 native（Anthropic 定义）各自变化，normalize 层要跟（好在 native 层对 mobi 只读，只需"能读出要用的"）
3. **对账/导出映射**：拿 DB 行与 `.jsonl` transcript 对照（如 abort 场景的合并键验证）需先剥信封

**待讨论方向**（仅记录，未定）：

- normalize 层是否有机会一次性解包出 native 视图（typed），减少散落各处的下钻与 getField
- 信封结构是否收敛/扁平化（`data` 提升为消息本体一等字段），或维持现状接受税
- 与 assembler 去留讨论（见 memory `project_sdk-partial-assembler`，web 消费层若改为能吃 block 级行则 assembler 可删）相关——两者都动"web 怎么消费消息"这层，宜一并讨论

**相关文件**：`packages/cli/src/api/apiSession.ts`（sendClaudeSessionMessage 信封构造）、`packages/shared/src/messages.ts`（unwrapRoleWrappedRecordEnvelope）、`packages/web/src/domain/chat/normalize.ts`（解包 + extractAnthropicMessageId）、`packages/web/src/domain/chat/normalizeAgent.ts`

**优先级**：低。当前无正确性问题，纯结构优化；与 assembler 去留讨论捆绑启动。

---

## 57. 水位窗口大小的猜测预填是过渡方案，需要更好的来源（2026-08-26）

**背景**：上下文水位的分母 `maxTokens`（窗口大小）权威来源只有 `result.modelUsage[model].contextWindow`——turn 结束才到达。导致新会话首个 turn / resume 后（新进程内存清零）实时上报全程被 `lastMaxTokens === 0` 拦截，圆环整个首 turn 缺席（复杂首 turn 也一样）。

**已落地的过渡方案**（2026-08-26）：`guessContextWindow(model)` 按模型名猜测预填（名字含 `[1m]` 忽略大小写 → 1M；其余一律 200k），主线 assistant 到达时若窗口未记忆则填充，实时上报立即生效；result 到达时用真实 `contextWindow` 覆盖。**局限**：窗口知识硬编码在 CLI 内，猜测可能过时/错——新窗口档位（如 `[2m]`）出现要手动追加分支；网关渠道自定义模型名不带 `[1m]` 时按 200k 猜可能偏小（偏小比缺席好，但仍是错的）；首 turn 内百分比可能短暂不准。**补充边界**（2026-08-26 code-review）：「result 权威修正」有前提——部分第三方网关的 result.modelUsage 不携带 contextWindow，`calcContextUsageFromResult` 的 `main?.contextWindow || lastMaxTokens` 会回退到猜测值本身，错误读数整个会话生效、无法自愈（如实际 128k/1M 的非 Claude 模型按 200k 记忆显示失真百分比）。这是用户拍板的「宁显示不错缺席」取舍；方向 3（hub 集中配置表）是唯一能同时覆盖此场景的方案。

**更好的方案方向**（待讨论）：

1. **resume 场景持久化恢复**：hub 的 `runtimeState.contextUsage.maxTokens` 本就持久化了上次会话的窗口大小——CLI 会话启动/resume 时从 hub 拉取该值初始化记忆，替代猜测（比猜准、零新知识源）。可与猜测叠加：持久值优先、无持久值才猜
2. **SDK 透出**：Claude Agent SDK 未来若在 metadata/modelInfo 中暴露各模型 contextWindow，直接接入替换猜测
3. **hub 集中维护模型配置表**：服务端权威的「模型 → 窗口」映射（可随版本更新），CLI 拉取使用——把窗口知识从 CLI 硬编码升级为可运营数据，顺带覆盖网关自定义模型名场景

**相关文件**：

- `packages/cli/src/claude/utils/modelContextWindow.ts` — 当前猜测实现（规则演进点）
- `packages/cli/src/claude/claudeRemoteLauncher.ts` — `reportAssistantUsage` 预填接线、`lastMaxTokens` 记忆
- `packages/hub/src/sync/sessionCache.ts` — 方向 1 的数据源（runtimeState.contextUsage 落库）

**优先级**：低。过渡方案已消除「首 turn 全程缺席」的主要体验缺口，残余为短暂精度问题；方向 1 成本最低，建议与下次水位相关迭代一并做。

---

## 58. Supervisor 控制socket 存在性看门狗（unlink 幽灵防御）（2026-08-26）

**背景**：E2E 每轮清理（`e2e-cleanup.sh` 绕过 supervisor 强杀子进程 + `rm -rf ~/.mobi-e2e`）曾累积 10 个「幽灵 supervisor」——控制 socket 文件随数据目录被删后，supervisor 探活 connect 得到 ENOENT、指令送不到，事件循环靠控制 server listen 撑着永不退出，且对 `ensureSupervisorRunning`/`doctor clean` 完全不可见。已通过 **e2e 切换 start-sync 直跑形态**（不再经过 supervisor）+ **doctor clean 识别 supervisor 类型** 消除该场景；但生产 A/B 路径（`mobi service start` / launchd）仍存在理论性 unlink 幽灵风险（窗口小：需旧实例 >1s 无应答 + 新实例并发 bind 或外部删除 socket 文件）。

**方案方向**：runSupervisor 内启动低频看门狗（如每 5s `existsSync(configuration.supervisorSocketFile)`），文件消失 = 失去可发现性/可治理性 = 有序退出（走 finish(0) 收掉托管集）。语义：「socket 文件路径指向我」是 supervisor 存在意义的不变量。实现为依赖注入小模块放 `src/supervisor/`（参照 ppidWatchdog 形态），TDD 覆盖。

**相关文件**：

- `packages/cli/src/supervisor/index.ts` — runSupervisor 集成点
- `packages/cli/src/supervisor/control.ts` — socket 路径来源（configuration.supervisorSocketFile）
- `packages/cli/src/supervisor/ppidWatchdog.ts` — 同类看门狗的形态参照

**优先级**：低。触发条件苛刻且已有 doctor clean 兜底识别；若未来出现生产幽灵再实施。

## 59. 单段流式渲染的全量 re-parse 成本无上界（2026-08-26 code-review）

**背景**：流式渲染回退单段 XMarkdown（commit 5bd93406，替代双段拆分）后，每次揭示都是对**全文**的全量 parse + sanitize + 建树——XMarkdown 的流式优化只覆盖输入稳定层（useStreaming hook 的增量 token cache），不减少 parse 成本。`revealIntervalFor` 长度档位（≤4k 每帧 / ≤8k 32ms / ≤16k 48ms / ∞ 64ms）**只封顶揭示频率，不封顶单次成本**：单次 parse 随内容长度线性增长。

**影响**：>16k 字符的消息流式期间每 64ms 全量 re-parse 一次（~15 次/秒）；100k 字符的长回复流式期间主线程持续执行全量 parse+sanitize+建树，低端/移动设备可感卡顿。被删的双段方案把每帧成本压在 O(尾部稳定段外的增量)，此问题上界有限——回退单段是对该性能保护的回退（换取 append-only 结构稳定与其他渲染诉求的可扩展性，用户拍板）。

**方向**（待讨论）：

1. **库层增量 parse**：上游 @ant-design/x-markdown 支持稳定前缀缓存（按块级节点缓存已 parse 结果，只 parse 尾部未闭合块）——根治但依赖库演进
2. **Web Worker off-thread parse**：主线程只渲染，parse 移 worker——改动大，streaming 场景的 worker 通信节奏需设计
3. **条件性双段回归**：仅超长消息（如 >32k）启用稳定前缀拆段，正常长度保持单段——双段的复杂度只付给真正需要的场景
4. **加大超长档间隔**：>32k 再加档（如 120ms）——治标，压频率不压单次成本

**相关文件**：`packages/web/src/components/ui/Markdown.tsx`（单段渲染）、`packages/web/src/components/ui/useStreamingContent.ts`（档位）

**相关 memory**：`xmarkdown-append-only-assumption`（库的流式管线假设）、`streaming-ux-smoothness`（单段决策过程）

**优先级**：中。日常长度（<16k）无感；长回复（>30k 字符的代码生成场景）真实可感。

---

## 60. terminal_reason 全链路（已闭环，2026-08-31 终审修复）

**真实链路**（原条目「web footer 由 CC 侧 metadata 读 terminal_reason」的表述与事实不符，已更正）：

```
CLI commandLifecycleToFact（claudeRemote.ts）—— command_lifecycle 帧的 terminal_reason 透传进 lifecycle fact
  → hub processLifecycleFact（sessionHandlers.ts）—— fact.terminalReason 写进命中行的 metadata.terminalReason
    （store markTerminalReason，与 nativeAckAt 双写同构，first-write-wins）并随行广播
      → web ChatContainer footer —— metaById.get(block.id)?.terminalReason 读消息 metadata
        （terminalReasonLabelKey 只解释已知 key：api_error / budget_exhausted）
```

**状态**：已实现（批次 A 终审修复）。hub DB 侧可直接审计「为什么这条消息死了」；web 实时展示走同一条广播链路，无需额外改动。

---

## 61. SSE 通道拆分评估：全局事件与会话消息分通道，或升级 WebSocket（2026-08-31）

**现状**：所有会话消息与全局事件共用一条 SSE 连接。单通道意味着：会话消息流量（尤其子代理批量输出、大 thinking 块）与全局事件互相挤占，任何一端的慢消费都会拖住另一端；多会话打开时全部消息涌进同一连接，移动端弱网下感知最明显。

**想讨论的方向**：

1. **按会话拆分 SSE**：全局事件（会话列表、通知等）留主通道，每个打开的会话单独一条 SSE——会话间流量隔离，切换/关闭会话即断开对应通道
2. **升级 WebSocket**：单连接多路复用（channel/room 语义）、双向能力（心跳/背压/即时断开通知）、浏览器连接数限制（HTTP/1.1 每 host 6 条）不再是约束——但引入重连/状态机复杂度
3. **维持现状 + 优化**：消息帧瘦身、按优先级分帧（灰行/状态先行，大 payload 滞后）

**触发时机**：子代理可观测性落地后流量上升，或出现多会话并用的实际卡顿时启动讨论。

**相关**：`packages/hub/src/sse/sseManager.ts`、`packages/web/src/core/providers/SSEProvider.tsx`

---

## 62. 后台任务状态链路两缺陷：runtime_state 双写竞态丢字段 + sidechain 消息不实时（2026-08-31 批次 B E2E 复现）

**缺陷一：hub `runtime_state` 双写路径竞态丢字段（U-4「重连后台任务快照」的真实根因）**

`packages/hub/src/socket/handlers/cli/sessionHandlers.ts:212`（消息事件路径，写 todos/tasks/backgroundTasks/teamState）与 `packages/hub/src/sync/sessionCache.ts:356` `updateRuntimeStateField`（contextUsage/model/effort 等路径）都是「读快照 → 全量 `setRuntimeState` 覆盖写」，两路径并发时后写覆盖先写，字段丢失。E2E 实测：后台任务 running 中 `runtimeState.backgroundTasks` 在 DB 为 null（SSE 内存链有值故面板当时正常），web 断开重连后首拉 DB → 面板空白。

**方向**：runtime_state 写入收敛为单点（store 层按字段 merge 或加写锁/队列），禁止调用方各自读-改-写全量覆盖。修复后重验 U-4（重连后面板恢复）。

**缺陷二：后台 Agent drawer 内容不随 SSE 实时增长**

子代理消息（`parent_tool_use_id` 非空）经 hub 落库并广播，但 web 主消息窗口（messageWindowStore）的增量路径不纳入 sidechain 消息 → reducer 重组看不到新 sidechain → Agent tool block 的 `children` 冻结在初始拉取快照。E2E 实测：drawer 打开 36s 内子代理消息持续落库（seq 106→117），drawer 内容恒 6 条。该缺陷先于批次 B 存在（forwardSubagentText 之前 children 只有 tool_use 心跳，同样冻结，只是无感）。

**方向**：SSE 增量将 sidechain 消息并入窗口（或独立 sidechain 缓存按 toolUseId 归组），触发对应 block children 更新；注意与消息窗口化（#40）的窗口边界语义协调。

**相关**：批次 B spec `docs/superpowers/specs/2026-08-31-task-subagent-observability-design.md` D6/D7；台账 U-4/U-23。

**优先级**：中高。后台 agent 是远程场景核心工作流，状态丢失与不可观测直接影响信任。

---

## 63. 配置资产管理面：MCP 管理 + skill/plugin 管理（2026-09-01）

**范围**：用户级「配置资产」的统一管理面——MCP 服务器、skill、plugin 三类资产的管理 UI 与生命周期控制。分散在三个上游能力上：

1. **MCP 运行时热管理**（台账 U-25 收敛后）：`mcpServerStatus()` 状态查询 + `reconnectMcpServer()` 重连对用户配置层 MCP 有效（连接层操作），价值真实——用户配的 MCP 连接失败（外部服务挂了/token 过期）目前 web 端完全不可见。`toggleMcpServer` 会话级启停不持久化、易困惑，暂缓；`setMcpServers` 只覆盖 dynamic 层（mobi dynamic 层只有 `mobi`/`mobi-web` 基础设施），**无消费场景，明确不做**。
2. **MCP elicitation url 授权模式**（台账 U-26 拆出的另一半）：涉及 web→hub→cli 三端「打开授权页 + elicitationId 完成通知关联」链路，且有远程场景浏览器归属问题（用户在自己设备完成 OAuth，完成通知怎么回流 cli）。
3. **skill 管理 / plugin 管理**：reloadSkills 等场景（互链 #49 插件化架构观察）。

**为什么一批**：三类资产共享同一组设施——资产列表 UI、状态展示、启停/重连动作、cli Query 控制链路（hub socket RPC 转发）、配置读写与脱敏。割裂做会重复建设。

**前置核实**：实施前对照当前 sdk.d.ts 复核四件套契约（本批 U-14a/U-17 已发现台账字段被上游撤除的先例）。

**相关**：批次 C spec `docs/superpowers/specs/2026-09-01-permission-tool-mcp-fidelity-design.md` D2；台账 U-25/U-26；#49。

---

## 64. SDK `Query.reinitialize()` 场景观察（2026-09-01）

**结论**：台账 U-15（断线重放挂起审批）对 mobi **不适用**——mobi 审批经 `agentState.requests` 持久化（cli addPendingRequest → hub update-state RPC 落档 → web 首拉自恢复），web 刷新/重连不丢审批卡片；SDK 0.3.217 的迟连补收面向 Remote Control 路径，mobi 是 stdio host 单客户端，不走那条通道；`reinitialize()` 面向「SDK 传输中断恢复」，mobi cli↔SDK 进程内 stdio 无此场景（进程死 = Query 消亡 = 审批取消）。

**留观察**：后续若出现以下场景可重启评估——① cli↔SDK 引入跨进程/远程传输形态（如远程 runner 演进）；② 出现「SDK 侧传输重置但进程存活」的新链路。届时 reinitialize 是现成能力。

**相关**：批次 C spec D7 前置分析；台账 U-15。

---

## 65. `user_message_uuid` 错误归因回链（2026-09-01）

**能力**：SDK 错误 result 与 turn 首帧携带 `user_message_uuid`（sdk.d.ts:3211 确认在），把回复/失败绑定到触发它的用户消息；`refused_user_message_uuid` 同族（rewind 目标 + edit-and-retry composer 预填）。

**价值**：排队/并发场景下 web 错误提示标注「这条失败对应你发的哪条消息」。当前不做的原因：需要 user 消息 native uuid 与 mobi localId/nativeId 双轨全链路对齐，连通成本可能大于收益；错误归因暂无强烈实际痛点。

**重启时机**：出现「多排队消息下失败归因不清」的真实反馈，或做 edit-and-retry（refused_user_message_uuid 的 composer 预填是现成配套）时一并设计。

**相关**：台账 U-7。
