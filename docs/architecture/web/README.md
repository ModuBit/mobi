# Web 模块

Web 是 Mobi 的浏览器前端，提供 Claude Code 会话的远程交互界面。

## 新人指引

### 前置知识

阅读本文档前，建议了解以下概念：

- **React 19**：UI 框架，Web 端基于函数组件 + Hooks 构建
- **TanStack Router**：类型安全的文件路由，URL 驱动的页面状态
- **TanStack Query**：服务端状态管理，负责数据获取、缓存和自动刷新
- **Zustand**：轻量客户端状态管理，仅用于非服务端状态（认证、UI 偏好）
- **Ant Design 5.x**：UI 组件库，提供 Button、Select、Modal 等基础组件
- **Ant Design X**：AI 对话组件库，提供 Bubble（消息气泡）组件
- **SSE (Server-Sent Events)**：服务器单向推送，Web 端通过 SSE 接收实时事件

### 建议阅读顺序

1. **本文件** — 建立整体架构认知
2. `src/router.tsx` — 路由结构，理解页面组织
3. `src/core/data/api/` — API 层，理解与 daemon 的 HTTP 通信
4. `src/core/providers/SSEProvider.tsx` — SSE 实时事件处理
5. `src/core/notifications/` — toast 通知三分支决策（收到 toast 后前端本地判定展示方式）
6. `src/domain/chat/` — 消息解析管线，理解 reducer → normalize → 分组流程
7. `src/features/chat/` — 聊天视图，理解消息渲染管线
8. `src/features/chat/tool-card/` — 工具卡片，理解工具结果展示
9. `src/core/data/hooks/` — 数据查询层，理解缓存策略

### 术语表

| 术语 | 含义 |
|------|------|
| **SSEProvider** | 全局 SSE 连接管理器（单例），接收实时事件并更新 React Query 缓存 |
| **SSEClient** | SSE 传输层，封装 `@microsoft/fetch-event-source`，负责连接/重连/认证 |
| **ChatContainer** | 聊天容器组件，消费 `useMessages` 数据并渲染消息列表；cancelled/discarded 的用户气泡 footer 加灰色终态小标注 |
| **ToolCard** | 工具调用展示组件，根据工具名称选择对应的视图（Edit、Diff、Write 等） |
| **ChatComposer** | 消息输入组件，支持文本输入、斜杠命令自动补全、文件附件。运行中允许发送（消息进入排队悬浮条）。发送时按分段状态（text/files/images/quotes）序列化为 `UserContentBlock[]` 数组直传。切换 session 时待发送的分段通过 `composerDrafts`（sessionStorage，含 images/quotes 桶）持久化；排队编辑/rewind 回填经 `applySegments` 还原完整分段 |
| **Chat Reducer** | 消息归约器（`domain/chat/reducer.ts`），将原始消息事件归约为 ChatBlock 列表 |
| **QueryKeys** | 集中定义的 React Query 缓存 key，确保缓存操作的一致性 |

## 整体架构

代码按 `app / pages / features / ui / domain / core` 六层组织，依赖只许向下（src 分层治理，2026-10-12）：

```
src/
├── app/           ← 组装层（App / main / router，唯一可引一切）
├── pages/         ← 路由页面壳 + 会话组装域（pages/session/）
├── features/      ← 业务域（chat / composer / files / layout / login / review /
│                     settings / sketchpad / terminal——域间零互引）
├── ui/            ← 通用组件（零业务知识；base/ 基础件 + shared/ 多域共享业务件 +
│                     openui/ pixel-avatar/ shadcn/ 体系目录）
├── domain/        ← 纯逻辑（零 React）
└── core/          ← 基础设施（数据、配置、工具函数、Provider）
```

```mermaid
graph TB
    subgraph 入口
        Main["app/main.tsx<br/>应用入口"]
        Theme["core/config/theme/<br/>主题配置"]
        Router["app/router.tsx<br/>路由定义"]
    end

    subgraph core/providers
        SSEP["SSEProvider<br/>SSE 连接管理"]
        TP["ThemeProvider<br/>主题切换"]
        QCP["QueryClientProvider<br/>数据缓存"]
    end

    subgraph core/data
        API["api/client.ts<br/>MobiApi"]
        Types["api/types.ts<br/>类型定义"]
        SSEC["realtime/sseClient.ts<br/>SSE 传输"]
        Stores["stores/<br/>Zustand（7 个）"]
        Hooks["hooks/queries/ + mutations/<br/>TanStack Query"]
    end

    subgraph domain
        Chat["chat/<br/>消息归约、分组、标准化"]
        Command["command/<br/>斜杠命令、@引用解析"]
        Session["session/<br/>类型、偏好"]
        Tool["tool/<br/>输入解析、类型"]
    end

    subgraph 呈现层
        Pages["pages/<br/>页面壳 + 会话组装"]
        Features["features/<br/>业务域"]
        UI["ui/<br/>通用组件"]
    end

    Main --> Theme
    Main --> Router
    Main --> TP --> QCP --> SSEP

    SSEP --> SSEC
    SSEP -->|"事件 → 缓存更新"| Hooks

    Hooks --> API
    API --> Types
    Features --> Hooks
    Features --> Domain["domain/"]
    Pages --> Features
    Features --> Stores
```

## 目录结构

```
packages/web/src/
├── main.tsx                    应用入口（~50 行），组装 Provider 链
├── App.tsx                     根组件，认证守卫 + SSEProvider 包裹
├── router.tsx                  TanStack Router 路由定义
├── dev.ts                      开发模式标记
├── index.css                   全局样式入口
│
├── core/                       基础设施
│   ├── data/                   数据层
│   │   ├── api/                HTTP API
│   │   │   ├── client.ts       createMobiApi() — 所有 REST 端点
│   │   │   └── types.ts        统一类型定义（Web 前端唯一类型源）
│   │   ├── stores/             Zustand 全局状态（8 个）
│   │   │   ├── authStore.ts    认证 token（localStorage 持久化）
│   │   │   ├── uiStore.ts      UI 状态（主题、语言、侧边栏、视图模式）
│   │   │   ├── chatBlocksByIdStore.ts   会话级 ChatBlock 缓存
│   │   │   ├── backgroundTasksStore.ts  后台任务状态
│   │   │   ├── runningAgentsStore.ts    运行中 Agent 状态
│   │   │   ├── teamAgentsStore.ts       Team Agent 状态
│   │   │   ├── notificationBadgeStore.ts 通知角标未读状态
│   │   │   └── workspaceStore.ts  Inspector 面板状态（tabs + tab 视图状态）
│   │   ├── realtime/           实时通信
│   │   │   └── sseClient.ts    SSE 传输层（fetch-event-source 封装）
│   │   ├── cache/              缓存操作工具
│   │   │   ├── messageCache.ts 消息缓存修补（patch/去重/排序；同 id 广播单调合并 lifecycle——终态实时生效）
│   │   │   └── sessionCache.ts 会话缓存修补
│   │   ├── sessionResume.ts     会话恢复 module（请求、权威 ID、查询缓存收敛）
│   │   └── hooks/              React Hooks
│   │       ├── queries/        TanStack Query 查询（20 个）
│   │       │   ├── useSessions.ts        会话列表
│   │       │   ├── useSession.ts         单个会话
│   │       │   ├── useMessages.ts        消息（无限滚动分页）
│   │       │   ├── useWorkspaces.ts        工作区列表
│   │       │   ├── useWorkspaceSessions.ts 工作区内会话（分页 + 前端 slice 揭示）
│   │       │   ├── useRecentSessions.ts  「最近」区会话（未归属工作区）
│   │       │   ├── usePagedSessionList.ts 会话分页列表通用逻辑（useSessions 补齐 + 可见 slice）
│   │       │   ├── useFileTree.ts        文件树
│   │       │   ├── useGitStatus.ts       Git 状态
│   │       │   ├── useGitDiff.ts         Git Diff
│   │       │   ├── useCommands.ts        斜杠命令列表
│   │       │   ├── useSidechainMessages.ts Agent 子对话消息
│   │       │   ├── useSDKMetadata.ts     SDK 元数据
│   │       │   └── useWebToolsStatus.ts Web 工具配置状态（三态推导：搜索/抓取是否就绪）
│   │       ├── mutations/      TanStack Query 变更（7 个）
│   │       │   ├── useSendMessage.ts     发送消息（运行中发送→排队）
│   │       │   ├── useCancelQueuedMessage.ts 取消排队消息（乐观删除 + 两阶段）
│   │       │   ├── useSessionActions.ts  会话操作（归档/中止/切换/恢复/重命名/归入工作区）
│   │       │   ├── useWorkspaceMutations.ts 工作区 CRUD（创建/改名/改 folders/删除）
│   │       │   └── useSpawnSession.ts    启动新会话（可带 workspaceId）
│   │       ├── useMediaQuery.ts          响应式断点
│   │       ├── useNotify.ts             通知 Hook
│   │       └── useNotificationSetup.ts   通知权限 + Web Push 订阅
│   ├── notifications/          通知决策（纯函数）
│   │   ├── toastDecision.ts    decideToastAction() — toast 三分支决策（忽略/页面 Toast+角标/系统通知）
│   │   └── parseActiveSessionId.ts 从 URL 解析当前活跃 sessionId
│   ├── config/                 应用配置
│   │   ├── i18n/               国际化
│   │   │   ├── index.ts        i18next 配置
│   │   │   └── locales/        en.json, zh.json
│   │   └── theme/              主题系统
│   │       ├── tokens.ts       浅色/深色主题 token（Shadcn 风格）
│   │       ├── components.ts   浅色/深色组件样式覆盖
│   │       └── ThemeProvider.tsx 主题切换 Provider
│   ├── providers/              React Context Providers
│   │   └── SSEProvider.tsx     SSE 全局连接管理（单例）
│   ├── lib/                    业务辅助逻辑
│   │   ├── queryKeys.ts       React Query key 集中定义
│   │   ├── messages.ts         消息合并/去重/排序（缓存操作工具，isQueuedInMobi/isDiscardedInMobi；mergeMessages 含 lifecycle 单调防护——rank 比较，陈旧 echo/旧响应不回退已推进状态）
│   │   ├── markMessagesSubmitted.ts 排队消息消费标记（lifecycle queued→pushed，first-write-wins）
│   │   ├── fileAttachments.ts  文件附件类型和辅助函数
│   │   ├── composerDrafts.ts  per-session 草稿持久化（sessionStorage + LRU，含附件子集）
│   │   ├── toolInputUtils.ts   工具输入解析
│   │   ├── recent-skills.ts    最近技能 localStorage 持久化
│   │   ├── ansiUtils.ts        ANSI 转义序列处理
│   │   ├── commandUsage.ts     命令使用统计
│   │   ├── metricsFormat.ts    性能指标格式化
│   │   └── styledUtils.ts      样式工具函数
│   ├── utils/                  纯工具函数
│   │   ├── sessionUtils.ts     会话显示名称格式化
│   │   ├── path.ts             路径显示处理（含 relativePath / encodePathSegments，供 HTML 预览拼 serve-file URL）
│   │   ├── timeFormat.ts       相对时间格式化
│   │   ├── applySuggestion.ts  自动补全建议应用
│   │   ├── findActiveWord.ts   光标位置单词查找
│   │   └── codeLanguageDetect.ts 代码语言检测
│   └── pwa/                    PWA 支持
│       ├── registerSW.ts       Service Worker 注册
│       ├── swReady.ts          SW ready 超时保护（awaitServiceWorkerReady）
│       └── sw.ts               自定义 Service Worker（处理 push / notificationclick）
│
├── domain/                     领域逻辑（纯数据，不依赖 React）
│   ├── chat/                   聊天领域
│   │   ├── index.ts            Barrel export
│   │   ├── types.ts            ChatBlock、AgentEvent 等核心类型
│   │   ├── reducer.ts          消息归约器（原始事件 → ChatBlock 列表）
│   │   ├── reducerTools.ts     工具调用隐藏/转换规则
│   │   ├── reducerEvents.ts    系统事件归约
│   │   ├── reducerCliOutput.ts CLI 输出归约
│   │   ├── reducerTimeline.ts  时间线归约
│   │   ├── normalize.ts        消息标准化入口
│   │   ├── normalizeAgent.ts   Agent 消息标准化
│   │   ├── normalizeUser.ts    用户消息标准化（委托 shared normalizeUserContent，四形态归一为 blocks）
│   │   ├── userContent.ts      用户 blocks 过渡辅助（getUserPlainText/collectUserText/groupUserBlocks）
│   │   ├── userContentSummary.ts 预览文本单源（排队条与 rewind 行内摘要，i18n 占位标签）
│   │   ├── composerSegments.ts composer 分段状态 ⇄ UserContentBlock[] 序列化/反序列化
│   │   ├── reconcile.ts        消息对账（去重/排序/合并）
│   │   ├── groupToolCalls.ts   工具调用折叠分组算法
│   │   ├── quoteDirectives.ts  回应批注 directive 解析（:mobi-quote 命中/去重/批注↔回复 turn 配对）
│   │   ├── quoteSelection.ts   选区判定器（引用资格纯函数：锚点属性契约 + 拒绝原因决策）
│   │   ├── presentation.ts     展示层格式化（时间戳、时长等）
│   │   ├── extractRunningAgents.ts 提取运行中 Agent
│   │   ├── cliParser.ts        CLI 输出文本解析
│   │   ├── modelConfig.ts      上下文预算配置
│   │   ├── eventFormatter.tsx  事件格式化（含 JSX）
│   │   └── tracer.ts           追踪/调试工具
│   ├── command/                命令领域
│   │   ├── mentionParser.ts    @ 引用解析
│   │   └── slashCommandHelper.ts 斜杠命令辅助
│   ├── session/                会话领域
│   │   ├── types.ts            会话类型定义
│   │   └── preferences.ts      用户偏好
│   └── tool/                   工具领域
│       ├── types.ts            工具类型定义
│       ├── askUserQuestion.ts  AskUserQuestion 输入解析
│       └── requestUserInput.ts RequestUserInput 输入解析
│
├── features/                   业务域（域间零互引；多域共享知识下沉 domain/ui）
│   ├── chat/                   对话（含 tool-card/ 子域与 blocks/ 渲染器）
│   │   ├── buildBubbleItems.tsx    Bubble 渲染项装配（渲染器注入式，票 03）
│   │   ├── ChatWelcome.tsx         空态欢迎页
│   │   ├── CompactProgressBubble.tsx 紧凑进度气泡
│   │   ├── CliOutputDetailDrawer.tsx CLI 输出详情抽屉
│   │   ├── blocks/             各类型渲染器
│   │   │   ├── index.tsx       renderChatBlock 调度器
│   │   │   ├── types.ts        ChatBlockContext 类型（票 03 抽离破环）
│   │   │   ├── renderContext.tsx BubbleRenderProvider 注入上下文（票 03）
│   │   │   ├── TextBlock.tsx / CliOutputBlock.tsx / ReasoningBlock.tsx
│   │   │   ├── AgentEventBlock.tsx / CompactSummaryBlock.tsx
│   │   │   └── ToolCallBlock.tsx / ToolCallGroupBlock.tsx
│   │   ├── userBlocks/         用户气泡 blocks 渲染
│   │   │   ├── UserBlocksView.tsx    block 分发视图（text/image/document/quote）
│   │   │   └── UserBubbleHeader.tsx  气泡 header 附件层
│   │   ├── artifact/           指令产物内联视图（Sandbox App 层）
│   │   └── tool-card/          工具结果展示（对话流呈现子域，票 03 并入 chat）
│   │       ├── index.tsx / knownTools.tsx
│   │       ├── PermissionFooter.tsx / AskUserQuestionFooter.tsx / RequestUserInputFooter.tsx
│   │       ├── ToolDetailDrawer.tsx / AgentDrawerContent.tsx / useAgentSidechain.ts
│   │       └── views/          工具专用视图
│   │           ├── _all.tsx / _results.tsx / types.ts（票 03 类型抽离）
│   │           ├── BashView / DiffView / EditView / MultiEditView / WriteView
│   │           └── ReadDetailView / GlobView / SendMessageView / TeamCreateView …
│   ├── composer/               消息输入（ChatComposer/ComposerInfoPanel 已上提 pages/session/）
│   │   ├── MentionDropdown.tsx / SlashCommandDropdown.tsx / AutoComplete.tsx
│   │   ├── AgentCard.tsx / TasksPanel.tsx / BackgroundTaskCard.tsx / TeamAgentCard.tsx
│   │   ├── TaskPanel.tsx / TodoPanel.tsx / ElicitationFormCard.tsx / QueuedMessagesBar.tsx
│   │   └── QuoteChipBar.tsx    引用胶囊（QuoteListCard 视觉词汇见 ui/）
│   ├── files/                  文件浏览与预览
│   │   ├── FileTreeView.tsx / FileContentView.tsx / fileKind.ts / useFileRenderState.ts
│   │   ├── HtmlPreviewView.tsx / ImageContentView.tsx / PdfContentView.tsx / MediaContentView.tsx
│   │   └── EditorRegistry.ts / SaveConflictDialog.tsx
│   ├── review/                 Git 审查（DiffViewer / GitReviewView / DiffTreePanel + pierre 渲染）
│   ├── layout/                 布局
│   │   ├── MainLayout.tsx / MobileMenu.tsx / PageHeader.tsx / navConfig.ts
│   │   ├── SidebarWorkspaces.tsx / MobileWorkspaceList.tsx / AssignWorkspaceModal.tsx
│   │   └── UpdatePrompt.tsx / NotificationPermissionGate.tsx
│   ├── login/                  登录页角色带
│   │   ├── CharacterBand.tsx / EyeBall.tsx
│   │   └── useCharacterAnimation.ts / useMouseLook.ts
│   ├── terminal/               终端视图
│   │   ├── TerminalView.tsx    终端视图（useCachedInstance 保活）
│   │   └── cachedTerminal.ts   终端实例工厂（xterm + socket 常驻缓存）
│   ├── sketchpad/              画板（SketchCanvas / SketchDrawerHandler / sketch marks）
│   └── settings/               设置组件
│       ├── NotificationSettings.tsx / blocks/（GuideSection / PwaCard / DebugSection）
│       ├── sections/           设置分区（registry.ts 单一真相 + 各 Section；路由布局见 pages/SettingsPage.tsx）
│       └── webtools/           Web 工具子页（RouteCard / ProviderCard / CredentialEditor）
│
├── ui/                         通用组件（零业务知识，2026-10-12 ui 治理定形）
│   ├── base/                   基础件（零业务语义，按性质分 8 组，组内平铺）
│   │   ├── interactive/        IconButton / AppTooltip / HoverSelect / TwoStepConfirmButton / EdgeSwipeBack
│   │   │                       滚动与手势：scrollableInPath（可滚性唯一判据，吃 composedPath 穿透 shadow）
│   │   │                       / bodyScrollLock（自建滚动锁，钉 body 不拦触摸）/ resolveDetentRelease（多档落档）
│   │   ├── layout/             ContentDrawer / SplitLayout / OverflowContainer / ErrorBoundary / mobileSheetClass
│   │   │                       AutoHeightHost（shadow 内容自适高）/ overlayLayer（移动浮层层号分配器）
│   │   ├── display/            FileChip / FileTypeBadge / FilePathText / AppImage / sourceIcon / toolIcons
│   │   ├── markdown/           Markdown / AutoDetectCodeBlock + 各插件（footnote/latex/mention/slashCommand/directive）
│   │   ├── motion/             ShinyText / ScrambleText / CrossfadeText / PixelLoader / presets
│   │   ├── brand/              Logo / MobiLogo / MobiWordmark / Favicon / brandPaths
│   │   ├── theme/              pierreTheme / useThemeLocaleToggle
│   │   └── sandbox/            SandboxHtmlFrame / sandboxAppHost
│   ├── shared/                 多域共享的业务呈现件（平铺）
│   │                           ContextRing / ContextBreakdown / StatusBar / GoalBadge / ToolRowItems /
│   │                           QuoteListCard / ArtifactDirectiveComponents + ArtifactInlineViews / CopyButton /
│   │                           CommentField / SketchEditBadge / present / WorkspaceFormModal / ActionLink …
│   └── openui/  pixel-avatar/  shadcn/   ← 组件体系目录（pixel-avatar 含 sprites/ hooks/）
│
├── pages/                      路由页面壳 + 会话组装域
│   ├── LoginPage.tsx / NewSessionPage.tsx / SessionDetailPage.tsx
│   ├── SessionsLayout.tsx / SettingsPage.tsx
│   └── session/                会话组装链（组装权归 pages 层，票 03 上提）
│       ├── SessionDetail.tsx / ChatPane.tsx / InspectorPane.tsx / WorkspaceSplitter.tsx
│       ├── ChatContainer.tsx / ChatComposer.tsx / ComposerInfoPanel.tsx
│       ├── SessionContextBar.tsx / LiveSystemNoticeBar.tsx / TerminalTabLabel.tsx
│       └── inspectorActions.tsx / InspectorEmptyState.tsx / SessionCreating.tsx
│
└── styles/                     全局样式
    ├── antd.css                Ant Design 覆盖
    ├── base.css                基础样式
    ├── fonts.css               字体
    ├── highlight.css           代码高亮
    ├── markdown.css            Markdown 渲染样式
    ├── modes.css               模式样式
    ├── scrollbar.css           滚动条样式
    └── variables.css           CSS 变量
```

## 路由结构

```mermaid
graph TD
    Root["rootRoute<br/>App（认证守卫 + SSEProvider）"]
    Login["/login<br/>LoginPage"]
    Main["mainLayout<br/>MainLayout（三栏布局）"]

    Root --> Login
    Root --> Main

    Main --> Index["/ → redirect /sessions"]
    Main --> SessionsLayout["/sessions<br/>SessionsLayout（侧边栏 + 内容）"]
    Main --> NewSession["/sessions/new<br/>NewSessionPage"]
    Main --> Settings["/settings<br/>SettingsPage（PC 左侧分区导航 / mobile 子页返回）"]

    SessionsLayout --> SessionList["/sessions/<br/>SessionsPage（会话列表）"]
    SessionsLayout --> SessionDetail["/sessions/$sessionId<br/>SessionDetailPage"]

    Settings --> SettingsIndex["/settings/<br/>SettingsIndex（入口列表，mobile 首屏）"]
    Settings --> Notifications["/settings/notifications<br/>NotificationsSection"]
    Settings --> WebTools["/settings/web-tools<br/>WebToolsSection"]
    Settings --> Debug["/settings/debug<br/>DebugSectionRoute"]
```

| 路径 | 页面 | 说明 |
|------|------|------|
| `/login` | LoginPage | 登录页（无 MainLayout） |
| `/sessions` | SessionsPage | 会话列表，左侧工作区分组 + 「最近」侧边栏，右侧列表 |
| `/sessions/$sessionId` | SessionDetailPage | 会话详情，支持聊天/文件/终端三个视图 |
| `/sessions/new` | NewSessionPage | 新建会话向导 |
| `/settings` | SettingsPage（SettingsPage.tsx） | 设置 layout 路由：PC ≥992px 左侧 200px 分区导航，mobile 入口列表 + 子页返回 |
| `/settings/` | SettingsIndex | 设置入口列表（mobile 首屏，含状态徽标） |
| `/settings/notifications` | NotificationsSection | 通知分区（包 NotificationSettings） |
| `/settings/web-tools` | WebToolsSection | Web 工具分区（路由卡 + provider 卡 + 凭据编辑器） |
| `/settings/debug` | DebugSectionRoute | 调试分区（未解锁渲染空分区） |

## 数据流

### 实时事件流（SSE）

```mermaid
sequenceDiagram
    participant daemon as daemon SSEManager
    participant SSEClient as SSEClient
    participant Provider as SSEProvider
    participant QC as React Query Cache
    participant UI as UI 组件

    daemon->>SSEClient: SSE 事件流
    SSEClient->>Provider: SyncEvent
    Provider->>Provider: handleSyncEvent()

    alt session-updated（心跳/状态变化）
        Provider->>QC: patchSessionCache()（setQueryData）
        QC->>UI: 自动 re-render
    else message-received（新消息）
        Provider->>QC: invalidateQueries(messages)
        QC->>UI: 触发 refetch → 渲染新消息
    else messages-submitted（排队消息已推送给 Claude Code）
        Provider->>Provider: markMessagesSubmitted()（lifecycle 翻为 pushed，缓存就地修补）
        QC->>UI: 自动 re-render
    else message-withdrawn（撤回刚发消息，批次 A）
        Provider->>Provider: messageWindowStore 乐观移除该 localId 及其后全部行<br/>+ composer 回填（deserializeSegments(blocks)，失败兜底 originalText）
        QC->>UI: 自动 re-render
    else session-added / session-removed
        Provider->>QC: invalidateQueries(sessions) / workspaceViews 批失效
        QC->>UI: 刷新列表
    else workspace-added / workspace-updated / workspace-removed
        Provider->>QC: invalidateQueries(workspaces) / workspaceViews 批失效
        QC->>UI: 刷新工作区与列表
    end
```

**关键设计决策**：

- `session-updated` 使用 `setQueryData` 直接修补缓存，避免心跳触发 API 请求
- `message-received` 使用 `invalidateQueries` 触发 refetch，因为消息有分页和去重逻辑
- `messages-submitted` 使用 `markMessagesSubmitted` 就地修补缓存（把命中 localId 的消息 `lifecycle` 翻为 `'pushed'`、`lifecycleAt`/`positionAt` 跳到 submittedAt），避免 refetch 抖动
- `message-withdrawn`（撤回，#53）走乐观移除 + 回填，与 daemon `softDeleteMessagesFrom` 无上界对齐；会话未打开时只落 store 移除、跳过回填（composer 不在场，不覆盖用户输入）
- 失效操作通过批处理（16ms 防抖）合并，避免高频事件导致多次 API 请求；列表失效分 `sessions` / `workspaceViews`（workspaces / workspaceSessions / recentSessions 三个 key）等 scope 批量执行
- `workspace-removed` 后名下会话已被 daemon 解绑进「最近」，与 `session-*` 共用 `workspaceViews` 批失效
- **sessions 单一数据源**：`useWorkspaceSessions` / `useRecentSessions` 的 queryFn 把分页会话 upsert 进全局 sessions 缓存（`mergeSessions`），列表只持 sessionIds——列表数据永远是全局缓存的视图而非独立副本

### 消息渲染管线

消息渲染分为两层：**领域层归约**（domain）和 **UI 层渲染**（components）。

```mermaid
flowchart LR
    API["REST API<br/>DecryptedMessage[]"]
    Reducer["domain/chat/<br/>reducer + reconcile"]
    Blocks["ChatBlock[]"]
    Group["groupToolCalls()<br/>折叠分组"]
    Bubble["buildBubbleItems()<br/>Bubble 渲染项"]

    API -->|"useMessages"| Reducer --> Blocks --> Group --> Bubble
```

**领域层**（`domain/chat/`）负责纯数据转换：

1. `reducer.ts` — 将原始消息事件归约为 ChatBlock 列表
2. `reducerTools.ts` — 隐藏/转换特定工具调用（如 change_title → title-changed 事件）
3. `reconcile.ts` — 消息去重、排序、合并
4. `normalize.ts` / `normalizeAgent.ts` / `normalizeUser.ts` — 消息标准化
5. `groupToolCalls.ts` — 连续可折叠工具调用分组

**UI 层**（`features/chat/`）负责渲染：

1. `ChatContainer.tsx` — 编排容器，消费 useMessages 数据
2. `buildBubbleItems.tsx` — 将 GroupedBlock[] 转为 Bubble 渲染项
3. `blocks/` — 各类型 ChatBlock 的渲染器

消息类型映射：

| ChatBlock 类型 | 渲染方式 |
|----------------|----------|
| `text` | Markdown 文本气泡 |
| `reasoning` | 可折叠思考过程 |
| `tool-call` | ToolCard 组件（根据工具名选择视图） |
| `tool-call-group` | 折叠的工具调用组（Think 组件，默认收起） |
| `cli-output` | CLI 输出块 |
| `summary` | 会话摘要 |
| `event` | 系统事件（API 错误、耗时统计） |

### Agent 消息渲染

Agent 工具（`Task` / `Agent`）是渲染复杂度最高的部分，有内联渲染和 Drawer 详情两条路径，sidechain 子对话通过双数据路径获取。

详细架构见 [→ Agent 消息渲染](agent-rendering.md)

### 流式逐字渲染

流式回复的"打字机"逐字效果横跨 CLI → daemon → Web 三层，有多个 dev-only 隐蔽坑（StrictMode 下 raf 被 cleanup 取消、snapshot/full 的 localId 不一致导致重 mount 等）。

详细架构、关键决策与调试方法见 [→ 流式逐字渲染](streaming.md)

### OpenUI 渲染层

fenced `openui` 代码块渲染为可交互 UI（Intelligent UI Native 层），含两条回灌回路：操作发消息（档②）、操作状态随 agent turn 原地更新（档③）。

详细架构见 [→ OpenUI 渲染层](openui.md)

### 工具调用折叠

消息渲染管线中，工具调用经过两层过滤后再展示：

#### 隐藏层（reducer 阶段）

`domain/chat/reducerTools.ts` 的 `isHiddenTool()` 在消息归约时直接跳过以下工具，不生成 `tool-call` block：

- `ToolSearch`、`EnterPlanMode` / `exit_plan_mode`
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskOutput` / `TaskStop`
- `mcp__mobi-core__change_title`；历史名 `mcp__mobi__change_title` / `mobi__change_title` 一并保留（老会话消息已按旧全名落库）

其中 `change_title` 转为 `title-changed` 事件，`EnterPlanMode` 转为 `plan-mode-entered` 事件，其余静默忽略。

#### 折叠层（渲染阶段）

`domain/chat/groupToolCalls.ts` 的 `groupCollapsibleToolCalls()` 对连续的可折叠工具调用进行合并收起：

**可折叠工具**：`Bash`、`shell_command`、`Read`、`Glob`、`Grep`，以及所有 `mcp__` 前缀的 MCP 工具

MCP 工具按 server 分组计数，标题格式为 `"Called {server} N times"`（server 名称中 `_` 替换为 `:`），如 `"Called plugin:chrome-devtools-mcp:chrome-devtools 4 times"`。

**核心概念 — Zone**：连续相邻的可折叠工具调用（不论状态）。Zone 边界由非可折叠工具或非 tool-call block 打断，边界稳定，不随工具状态变化而分裂或合并。

**分组规则**：

| 状态 | 处理 |
|------|------|
| `completed`（≥ 2 条） | 合并为 `ToolCallGroup`，默认收起 |
| `completed`（< 2 条） | 单独展示 |
| `running` / `pending` / `error` | 在折叠组之后单独展示 |

**渲染顺序**：`[Fold(completed)] + [non-completed 逐个展示]`，各自保持原始相对顺序。

**折叠组标题**：按类别统计 completed 工具，生成自然语言摘要（如 "Run 3 shell commands, read 2 files"），由 `formatGroupTitle()` 格式化。

**数据流**：

```
ChatBlock[]
  → groupCollapsibleToolCalls()    // 纯函数，O(n) 扫描
  → GroupedBlock[]                 // ChatBlock | ToolCallGroup
  → buildBubbleItems()             // 遍历 GroupedBlock[]
  → BubbleItemBase[]
```

| 文件 | 职责 |
|------|------|
| `domain/chat/groupToolCalls.ts` | Zone 检测 + 分组算法 + 标题格式化 |
| `domain/chat/reducerTools.ts` | `isHiddenTool()` 隐藏判断 |
| `features/chat/blocks/toolCallGroupBlock.tsx` | 折叠组渲染（Think 组件，默认收起） |
| `features/chat/buildBubbleItems.tsx` | 调用分组函数，分发到渲染器 |

### API 交互

```mermaid
flowchart LR
    subgraph Hooks层
        Q["hooks/queries/<br/>数据查询"]
        M["hooks/mutations/<br/>数据变更"]
    end

    subgraph API层
        Client["api/client.ts<br/>createMobiApi()"]
    end

    subgraph daemon
        REST["daemon WebServer<br/>HTTP REST"]
    end

    Q --> Client --> REST
    M --> Client --> REST
```

API client 是一个工厂函数 `createMobiApi()`，返回类型化的 API 方法对象。
所有请求自动附加 JWT token，401 响应触发登出跳转。

会话恢复通过 `core/data/sessionResume.ts` 的聚焦 interface 进入：module 负责调用恢复端点、返回 daemon 确认的权威会话 ID，并统一失效来源/结果会话详情、全局会话列表和工作区视图。`useSessionActions`、动作链接以及桌面/移动侧边栏只保留各自的路由、反馈和动作重放。

## 状态管理策略

Web 端区分三种状态，使用不同的管理方案：

| 状态类型 | 管理方式 | 示例 |
|----------|----------|------|
| **服务端状态** | TanStack Query | 会话列表、消息、机器列表 |
| **客户端 UI 状态** | Zustand store | 主题、语言、侧边栏开关、视图模式 |
| **认证状态** | Zustand + localStorage | JWT token |
| **URL 状态** | TanStack Router | 当前会话 ID（`$sessionId`） |

**注意**：服务端状态不存入 Zustand，统一由 TanStack Query 管理。SSE 事件直接更新 Query 缓存，UI 自动响应。

### Zustand Store 列表

| Store | 职责 |
|-------|------|
| `useAuthStore` | JWT token（localStorage 持久化） |
| `useUiStore` | UI 状态（主题、语言、侧边栏、视图模式） |
| `useChatBlocksByIdStore` | 会话级 ChatBlock 缓存（按 sessionId 索引） |
| `useBackgroundTasksStore` | 后台任务状态 |
| `useRunningAgentsStore` | 运行中 Agent 状态 |
| `useTeamAgentsStore` | Team Agent 状态 |
| `useNotificationBadgeStore` | 通知角标未读状态 |
| `useWorkspaceStore` | Inspector 面板状态（按 sessionId 隔离：tabs、activeTabId、布局，及 tab 的视图状态 `viewState` 如 PDF 缩放/滚动比例） |

## 布局体系

```
┌─────────────────────────────────────────────────┐
│ MainLayout                                       │
│ ┌────┬────────────┬──────────────────────────┐  │
│ │    │            │                          │  │
│ │Rail│ Content    │    Content Area          │  │
│ │Nav │ Sidebar    │    (页面内容)             │  │
│ │    │ (会话列表) │                          │  │
│ │ 📋 │            │    ChatContainer          │  │
│ │ ⚙️ │            │    FileView               │  │
│ │    │            │    TerminalView           │  │
│ └────┴────────────┴──────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

- **RailNav**：固定宽度图标导航栏，支持桌面/移动自适应
- **ContentSidebar**：可折叠的内容侧边栏，展示工作区分组会话列表 + 「最近」区（SidebarWorkspaces）
- **Content Area**：主内容区域，根据视图模式切换聊天/文件/终端

移动端时 RailNav 替换为汉堡菜单（MobileMenu），ContentSidebar 变为全屏覆盖。

## 关键文件速查

| 需求 | 文件 |
|------|------|
| 添加新页面 | `src/app/router.tsx` + `pages/` + `src/features/layout/navConfig.ts` |
| 添加新 API 端点 | `core/data/api/client.ts` + `core/data/api/types.ts` |
| 添加新数据查询 | `core/data/hooks/queries/` + `core/lib/queryKeys.ts` |
| 添加新工具卡片视图 | `src/features/chat/tool-card/views/` + `src/features/chat/tool-card/knownTools.tsx` |
| 修改消息归约 | `domain/chat/reducer.ts` + `domain/chat/reducerTools.ts` |
| 修改消息渲染 | `features/chat/ChatContainer.tsx` + `features/chat/blocks/` |
| 修改 SSE 事件处理 | `core/providers/SSEProvider.tsx` |
| 修改主题 | `core/config/theme/tokens.ts` + `core/config/theme/components.ts` |
| 添加新 UI 组件 | 基础件 → `src/ui/base/<组>/`；多域共享业务件 → `src/ui/shared/`；registry 组件 → `src/ui/shadcn/`（见 web.md「组件选型」章） |
| 添加领域逻辑 | `domain/` 对应子目录（chat/command/session/tool） |
