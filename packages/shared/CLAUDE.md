# shared

协议定义包，使用 Zod Schema 定义跨包共享的类型和协议。

## 编码规范

→ [docs/conventions/shared.md](../../docs/conventions/shared.md)

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/schemas.ts` | Schema 定义（Session, AgentState, SyncEvent 等） |
| `src/types.ts` | 纯 TypeScript 类型重导出 |
| `src/messages.ts` | 消息辅助函数（unwrapRole / unwrapOutput / lifecycle） |
| `src/messageClassification.ts` | 消息投影单一来源：写路径分类 classifyMessage + 读路径可见性 isClaudeChatVisibleMessage |
| `src/mobiXml.ts` | 指令族 XML 命名空间协议单源：`<mobi:name/>` 族通用原语（标签正形/扫描/去重/流式尾巴截断）+ artifact 成员语义（path/mode 校验、去重键） |
| `src/mobiXmlFamily.ts` | XML 指令族成员注册表：族标签清单/开前缀/tokenizer 正形 + 命中→成员去重键路由（键前缀按成员隔离）——新增族成员在此注册 |
| `src/quoteProtocol.ts` | quote 协议单源：进出同形引用协议（标签族常量、index 合法性与去重键、进向 XML 组装、批注↔回复配对 uuid 优先+线性兜底、XML 转义原语；出向扫描/去重/截断走 mobiXml 族通用原语） |
| `src/streamingToolInputPreview.ts` | 流式工具入参预览单一来源：半截 JSON 尽力解析 + 白名单字段抓取 + 8KB 扫描窗口 |
| `src/socket.ts` | Socket.IO 事件类型定义（含 `snapshot-stream-end`） |
| `src/transcriptTap.ts` | transcript tap 生产/消费契约单源（`TRANSCRIPT_TAP_SESSION_APPEND_RULES` / 信封 type `goal.append`；mod 生产端 config.mjs 由 cli 测试锁定等值） |
| `src/forkedSkillTap.ts` | forked skill tap 契约单源（信封 `forked-skill.append` + 载荷 schema + 流侧抑制纯函数 `shouldSuppressStreamMessage`） |
| `src/snapshotDelta.ts` | Snapshot delta 协议 apply 端共享逻辑（buildSnapshotMessage / locateSnapshotBlocks / applySnapshotBlockDeltas） |
| `src/modes.ts` | 权限模式定义（PermissionMode 等） |
| `src/utils.ts` | 通用工具函数（isObject 等） |
| `src/version.ts` | 版本常量 |
| `src/pathSecurity.ts` | 路径安全校验工具 |
| `src/profile.ts` | 用户配置 Schema 与类型 |
| `src/sessionSummary.ts` | 会话摘要 Schema 与类型 |
| `src/upload.ts` | 文件上传 Schema 与类型 |
| `src/userContentSchema.ts` | 用户消息 content block Schema（AG-UI 对齐四型 union）+ 四形态归一化 normalizeUserContent |
| `src/appTheme.ts` | mode=app 宿主注入的 `--mobi-*` 主题变量词表（CSS 生成 / prompt 教学 / 契约测试三方 pivot） |
| `src/chromeTheme.ts` | 窗口 chrome 底色 `CHROME_BG`（daemon PWA manifest + web 标题栏/首屏共引；值与 web 调色板的等式由 palette-consistency 守卫锁定） |
| `src/inboundOrigin.ts` | 入站消息落在 meta 上的来源标注：跨会话来源 `CrossSessionOrigin` + turn 来源 `TurnOrigin` 的形状与读写单源 |
| `src/exitLogger.ts` | 进程退出日志（hub/runner/cli 共用基础设施） |
| `src/openuiFunctions/` | openui `@函数`目录（59 个，纯 JS + Zod）：web 渲染器与 session prompt 生成器单源（票 02） |
| `src/openuiComponents/` | openui 自定义组件签名（13 个：Chart / Map / Svg 图元 / HtmlView）：实现留 web，签名两面共用（票 03/04） |
| `src/mapSettings.ts` | 地图设置（高德两种 key 分开存）+ 三档模式推导 `deriveMapMode`（interactive / static / none）与锁内合并写 |
| `src/errorPresentation.ts` | 错误分类与呈现单一来源：classifyError / presentError / 上下文满状态机 / 重置时间与请求 ID 提取（web 渲染与未来 daemon 遥测共用） |
| `src/index.ts` | Barrel export |

## 测试

→ [docs/conventions/testing.md](../../docs/conventions/testing.md)

- 框架：vitest
- 运行：`vitest run`

## 约束

- 所有跨包共享的类型必须在此包定义
- 使用 Zod 进行运行时校验
- 修改 Schema 后，检查所有消费方（hub、cli、web）是否需要同步更新
