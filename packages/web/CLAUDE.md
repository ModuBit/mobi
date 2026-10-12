# web

浏览器前端，提供 Claude Code 会话的远程交互界面。

## 组件选型

**默认 antd**（含新代码）。shadcn 系组件仅限「归属登记表」内已迁移组件——机器事实源 `registry.json`（`tests/conventions/componentRegistry.test.ts` 守卫一致性），表与迁移流程见 [docs/conventions/web.md「组件选型」章](../../docs/conventions/web.md#组件选型)。要点：官方组件默认 Base UI（components.json 已锁）；同一组件禁止多实现（替换迁移先删旧再登记）；registry 组件不预装、迁移须真机验收后登记入表；registry 组件统一落 `src/ui/shadcn/<组件名>/`（shadcn 是体系名非来源名，来源只记 registry.json）；antx + 流式渲染管线为永久禁区；registry 后端包（@radix-ui/@base-ui 等）只允许被 `src/ui/shadcn/` 消费（lint 已强制）。

## 编码规范

→ [docs/conventions/web.md](../../docs/conventions/web.md)（**目录结构 / 分层规则 / 依赖门禁**见该文「目录结构」章）

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

## 移动端 Drawer 规范

所有移动端底部弹出 Drawer（`placement="bottom"`）**优先使用 `MobileDrawer`**（`src/ui/base/layout/MobileDrawer.tsx`），以下不变量由组件统一收口，调用方不要再手动配置：

- **高度自适应 + 上限**：组件内置 `wrapper: { height: 'auto', maxHeight: '85dvh' }`（需调整上限时传 `maxHeight` prop）
- **底部安全边界**：sheet 自带 `paddingBottom: 'max(24px, env(safe-area-inset-bottom))'`——**禁止调用方往 `styles.body` 传 padding**（组件强制 `padding: 0`，body padding 会把 sheet 抬离屏底、露出 mask 空隙），同样禁止覆盖 `body.overflow` / `body.maxHeight`
- **开合动画 / header 下拉关闭 / 手势返回哨兵**：组件内置，`onClose` 消费者须**同步**决定是否关闭（异步决定会看到「沉降再滑出」弹跳）

仅当无需交互关闭的纯提示框（如 `SaveConflictDialog`，`maskClosable={false}` 且无拖拽关闭语义）可直接用 antd `Drawer`，手动配置：

- `styles.wrapper: { height: 'auto', maxHeight: '85dvh' }`
- `styles.body: { paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }`

**必须同时传 `rootClassName="mobile-sheet-drawer"`**：`src/styles/antd.css` 的「height auto + 85dvh 上限 + body safe-area」全局规则只命中该标记类（MobileDrawer 恒挂它）。规则不命中 `.ant-drawer-bottom` 泛选——否则会误伤同样 bottom placement 的非 sheet 抽屉（如 PC 画板停靠抽屉的固定高度被 `height: auto !important` 压塌，2026-09-19 实踩）。

注意：这套手动配置**仅对原生 antd Drawer 生效**；同一 prop 传给 MobileDrawer 会被组件不变量覆盖（见上）。

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
