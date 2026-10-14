# web

浏览器前端，提供 Claude Code 会话的远程交互界面。

## 组件选型

**默认 antd**（含新代码）。shadcn 系组件仅限「归属登记表」内已迁移组件——机器事实源 `registry.json`（`tests/conventions/componentRegistry.test.ts` 守卫一致性），表与迁移流程见 [docs/conventions/web.md「组件选型」章](../../docs/conventions/web.md#组件选型)。要点：官方组件默认 Base UI（components.json 已锁）；同一组件禁止多实现（替换迁移先删旧再登记）；registry 组件不预装、迁移须真机验收后登记入表；registry 组件统一落 `src/ui/shadcn/<组件名>/`（shadcn 是体系名非来源名，来源只记 registry.json）；antx + 流式渲染管线为永久禁区；registry 后端包（@radix-ui/@base-ui 等）只允许被 `src/ui/shadcn/` 消费（lint 已强制）。

## 编码规范

→ [docs/conventions/web.md](../../docs/conventions/web.md)（**目录结构 / 分层规则 / 依赖门禁**见该文「目录结构」章；**浮层与全屏页面的头部锚位**见「头部布局与锚位」章）

`src/` 六层 `app → pages → features → ui → domain → core`，依赖只许向下，depcruise 硬卡：

- **features 域间互引禁止**；多域共享知识下沉 `domain/`（纯逻辑）或 `ui/`（通用呈现）；「父编排子」的伪耦合改 props/注入
- **组装链归 `pages/`**：编排其他域组件的容器（如 `pages/session/`）不放 features
- **domain 零 React**（含 type-only）；**ui 不得向上引 features/pages**（业务数据一律 props/注入传入；承载业务语义的呈现件本身合法，见下条 base/shared 二分）；**core 零 UI 组件**
- **ui 内部组织**：`base/`（零业务语义，按性质分 interactive/layout/display/markdown/motion/brand/theme/sandbox 八组，组内平铺）+ `shared/`（多域共享的业务呈现件，平铺）+ 体系目录（`openui/` `pixel-avatar/` `shadcn/`）；层级封顶三层
- **文件命名**：文件名要么是某个主导出物的名字（组件 / class → `PascalCase`，且与导出同名），要么是 `camelCase`（模块文件：hook / 工具 / 常量表 / 多组件模块）；目录 `kebab-case`。**eslint `mobi/filename-matches-export` 以 error 级强制**，例外仅 registry 上游件与生成文件

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/app/router.tsx` | 路由配置 |
| `src/core/providers/SSEProvider.tsx` | SSE 连接管理 |
| `src/core/data/api/types.ts` | API 类型定义 |
| `src/core/data/sessionResume.ts` | 会话恢复（请求、权威 ID、查询缓存收敛） |
| `src/domain/chat/normalize.ts` | 消息标准化（DecryptedMessage → NormalizedMessage） |
| `src/domain/chat/reducer.ts` | 消息归约（NormalizedMessage[] → ChatBlock[]） |
| `src/domain/chat/types.ts` | NormalizedMessage / ChatBlock 类型定义 |
| `src/features/chat/tool-card/knownTools.tsx` | 工具卡片注册 |
| `src/core/lib/queryKeys.ts` | 查询缓存 Key |
| `src/core/lib/fileAttachments.ts` | 文件附件类型与上传校验（分桶/MIME 投影单一来源 bucketCompletedAttachments） |
| `src/core/lib/composerDrafts.ts` | per-session 草稿持久化（分段结构 text/files/images/quotes，sessionStorage，旧格式兼容读取） |

## 移动端底部 sheet 规范

移动端底部弹出面板**一律用 `BottomSheet`**（`src/ui/shadcn/bottom-sheet/bottom-sheet`，registry 登记件；2026-10-13 起全量替代旧 `MobileDrawer`——旧组件与其 antd 自管位移实现已删除），不变量由组件收口，调用方不要再手动配置：

- **高度自适应 + 上限**：`height: auto` + `maxHeight`（默认 `85dvh`）；内容超过 peek 档（45dvh）先停 peek，滚内容 / 上推 / 点把手展开到上限。**菜单 / 表单 / 列表这类「打开就要看全」的传 `peek={false}`**：被裁掉的行对它们不是「还有更多」，是残缺（单档 sheet 的内容区照常滚，不会被 peek 的锁滚态挡住）
- **底部安全边界 / 开合动画 / 下拉关闭 / 手势返回哨兵 / 滚动锁**：组件内置
- **内容区里 shadow DOM 的滚动区由 sheet 负责放行，消费方零接入**：Radix Dialog 默认的滚动锁（react-remove-scroll）是 **document 级**、非 passive 的 touchmove，只沿浅 DOM 的 `parentNode` 找可滚祖先——判不出 shadow DOM 里的滚动容器（pierre diff 的 `<code>`、终端视口都算）就把整段手势 `preventDefault`，真机表现是「diff 本来就支持横向滚动，却横竖都滚不动」（2026-10-13 实测：同一个裸 pierre diff，放 sheet 里和放 sheet 外都拿到 `[true,true]`）。所以 BottomSheet 走 `modal={false}`（**不要那把锁**）+ 自建 `ui/base/interactive/bodyScrollLock`（钉 body，不碰任何触摸事件）；手势归属由内容区仲裁一处决定，判据是 `ui/base/interactive/scrollableInPath`（吃 `event.composedPath()`，**穿透 shadow 边界**，同时看方向余量）。两层都不需要消费方写一行接入代码——`DiffView` 不做任何接管，横向滚动就是 pierre 自己的
- **别在 sheet 里嵌第二层限高滚动区**：容器自己就是滚动区，内容再限高内滚就成了双滚动（真机反馈「diff 里为什么有竖向滚动条」）。工具视图在详情容器里走 `ToolViewScopeProvider fullHeight`（`features/chat/tool-card/views/toolViewScope.tsx`）——同一个视图组件在消息卡内限高（320）、在详情里全高
- **关闭是「先通知后动画」且可否决**：`onClose` 消费者须**同步**决定是否关闭；不翻转 `open` = 否决，sheet 沉降回原位（执行中的操作菜单、提交中的表单传 `() => {}` 或条件 noop 即可拦住关闭，不要另加 `maskClosable` 这类开关）
- **内容内衬归调用方**：组件默认不给 body 加 padding，需要内衬就传 `bodyStyle`（与旧组件相反——旧组件的 `padding: 0` 强制是为了抵消 antd 默认内衬，BottomSheet 没有这层默认）
- **「面」由共享壳提供**（`src/ui/base/layout/sheetSurface`）：圆角 / 描边 / 底色 / 阴影 / 裁切 / 头部基线（居中三栏与工具条两档）/ 抓手 / 图标钮都在壳里，BottomSheet 与**移动端画板**共用同一个壳（视觉统一）。**定位、尺寸、开合与手势编排仍归各自**——画板因此刻意不套 BottomSheet（要自管停靠测量与 morph 过渡），但壳、滚动锁（`bodyScrollLock`）、返回哨兵（`useHistoryGuard`）、层号分配器（`overlayLayer`）都是同一套
- 其它可用 props：`title`（ReactNode，恒居中三栏）/ `extra`（标题行右侧操作）/ `showClose`（默认 false，靠下拉·遮罩·手势返回关闭）/ `showDragHandle`

**例外——无需交互关闭的纯提示框仍可直接用 antd `Drawer`**（如 `SaveConflictDialog`：`maskClosable={false}` 且无拖拽关闭语义）。此时必须手动补齐三件事：

- `styles.wrapper: { height: 'auto', maxHeight: '85dvh' }` + `styles.body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }`
- **`rootClassName={MOBILE_SHEET_DRAWER_CLASS}`**（`src/ui/base/layout/mobileSheetClass.ts`）：`src/styles/antd.css` 的「height auto + 85dvh 上限 + body safe-area」全局规则只命中该标记类。规则不命中 `.ant-drawer-bottom` 泛选——否则会误伤同样 bottom placement 的非 sheet 抽屉（如 PC 画板停靠抽屉的固定高度被 `height: auto !important` 压塌，2026-09-19 实踩）。
- **`zIndex={useOpenOverlayLayer(open)}`**（`src/ui/base/layout/overlayLayer.ts`）：antd 弹层默认 z 1000 低于 BottomSheet 的 1080 起，不领号就会压在打开的 sheet 后面。**任何会叠在别的移动浮层之上的浮层都要领号**——包括命令式 `modal.confirm`（调用处 `zIndex: nextOverlayLayer()`）。弹窗由 core 层的动作流弹出时（core 不许引 ui），把取值函数传进去在**真要弹的那一刻**领号：先例是 `sessionDormancy` 的 `confirmZIndex`（移动端休眠入口在操作菜单 sheet 里，不领号确认框会被 sheet 盖住 → 点不到、await 不落定、菜单被 pending 拦着关不掉）。

注意：这套手动配置**仅对原生 antd Drawer 生效**，BottomSheet 不接受这些 prop（它们对应组件内部不变量）。

**不要在打开的 sheet 之上叠 antd 弹层**（Radix Dialog 会把 `document.body` 置 `pointer-events: none`，自身的浮层靠 antd 显式提回 `auto` 才点得到——能用，但 fragile：三层叠起来没人保证）。确认 / 二次选择这类交互**优先就地展开在同一个 sheet 里**（先例：`MobileWorkspaceList` 的删除确认走 `actionView` 切视图 + 自己那层手势返回哨兵），或先关 sheet 再开弹层（重命名 / 归入工作区就是这么做的）。

## 跨格式字段访问

CLI 发送的数据字段格式不统一（下划线 `tool_use_result` / 驼峰 `toolUseResult`），访问时必须使用 `@mobi/shared` 的 `getField` 函数，禁止手写双格式判断：

```typescript
import { getField } from '@mobi/shared'

// 正确
getField(data, 'parentUuid')       // 自动尝试 parentUuid → parent_uuid
getField(data, 'tool_use_result')  // 自动尝试 tool_use_result → toolUseResult

// 错误 — 遗漏即出 bug
data.parentUuid ?? data.parent_uuid
isObject(rawData.tool_use_result) ? rawData.tool_use_result : isObject(rawData.toolUseResult) ? rawData.toolUseResult : null
```

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest + @testing-library/react + jsdom
- 运行：`vitest run`（禁止 `bun test`，会忽略 vitest.config.ts 的 jsdom 配置）

## 架构文档

→ [docs/architecture/web/](../../docs/architecture/web/)
