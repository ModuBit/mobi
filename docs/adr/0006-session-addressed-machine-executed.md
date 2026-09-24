# 会话文件 RPC 执行层无条件 machine 化：session 寻址、runner 执行

## Status

accepted（2026-09-24）。修订 ADR 0004 中「machineFiles.ts 保留其独有的扩展名白名单」条款（白名单放宽，读边界两通道完全统一）。

## 背景

文件/路径类能力存在 session 与 machine 两条 HTTP 链路，行为与可达性割裂：

- **session 链**（`/api/sessions/:id/*`）经 `sessionRpc` 到**会话 CLI 进程**执行——会话进程退出即不可达，哪怕文件就在磁盘上
- **machine 链**（`/api/machines/:id/*`）经 `machineRpc` 到 **runner** 执行——跨会话存活，但历史上带扩展名白名单（附件预览场景的纵深防御）

同一能力两套端点、两种可达性：InspectorPane 里文件树走 session 链（会话死即失效）而聊天图片走 machine 链（永远可达），认知与行为都混乱。根因是把「会话进程」当成了文件 I/O 的执行器，而它只是众多执行器之一。

hub 内部本就分三层：**路由注册**（hub 启动时，永不过期）、**会话解析**（DB 回落，会话行存在即可解析出 `metadata.path`/`machineId`）、**RPC 执行**（绑定进程存活）。前两层从不因会话退出失效——失败的只是第三层。

## 决定

**session 寻址、machine 执行，无条件单路径**（save-file 的例外条款于 2026-09-24 依 dormancy 决策反转，见第 4 条修订）：

1. **`/api/sessions/:id/*` 文件/路径类的 engine 执行层从 `sessionRpc` 换为 `machineRpc`**：engine 按会话行解析 `machineId + cwd`（`metadata.path`）后注入参数，经 runner 执行。runner 侧注册的就是同一批 handler（`registerCommonHandlers` 双端共用），CLI 侧零新增。覆盖：readFileMeta / readFileRange（read-file、file-meta、serve-file 共用）/ listSessionDirectory / searchSessionFiles / upload 三件套（writeFileRange、deleteUpload、replaceUpload）
2. **不做「socket 在不在」分支**：无条件 machine 化让读文件只有一条执行路径，行为恒定。活跃会话与休眠会话的文件读完全同构
3. **会话行不存在 → 404**（现成行为，`resolveSessionAccess` 兜底 DB 回落）；**machineId 或 cwd 缺失 → 显式报错，不回退 session socket**——双执行路径正是本决策要消灭的东西，存量 machineId 缺失由一次性回填脚本兜底
4. **`save-file` 亦 machine 化**（2026-09-24 修订，dormancy 特性）：原「唯一例外」条款作废。为改文件唤醒整个会话过重——写边界锚定改为 **hub 注入 cwd**（engine 经 `resolveSessionFileExecution` 解析会话 `metadata.path`，随参数下发；runner 侧 saveFile 以注入 cwd 为根做 `validateWritePath`），不再依赖 runner 进程自身 cwd；会话进程不在也可写（冷编辑器自动保存不唤醒）
5. **扩展名白名单放宽**（修订 ADR 0004）：machine 读与 session 读边界完全统一为 `validateReadPath`（cwd ∪ home−黑名单 ∪ /tmp）。两链读边界本就几乎等价（同覆盖 home−黑名单），白名单是唯一不对称，保留它只制造「冷会话预览代码文件被拒」的行为分叉
6. **URL 不变**：本决策只动 hub 执行层，web 与 API surface 零改动。URL 规范化（RESTful 资源名）另立一波，不与本波混合

## Considered Options

- **全量单链化到 machine 通道（改寻址）**：web 全部文件调用改投 `/machines/:id/*` 后删 session 文件端点。被否：API surface 双轨过渡、web 全量改寻址，收益不比本方案多——「session 是逻辑对象」的产品语义下，web 永远应该对会话寻址，执行位置是 hub 的实现细节
- **降级式双路径（session socket 不在才转 machine）**：比无条件化少一个前提（不要求活跃会话也走 machine）。被否：两条执行路径意味着两种行为，测试矩阵翻倍，且「降级」把执行器选择泄漏成分支逻辑；无条件单路径让这个分支根本不存在
- **URL 路径段化（/file/{path...}）**：文件路径含斜杠/`..`/编码字符，path 段劣化于 query 参数；serve-file 的 splat 形态保留（浏览器相对解析依赖）

## Consequences

- 会话进程退出（将来的「休眠」）后文件树、预览、搜索、附件全部照常可用——为休眠特性的「冷可读」提供地基
- 活跃会话的文件读也经 runner 转发，多一跳 runner RPC。两者都是单跳 socket RPC，时延同量级
- 存量 machineId 缺失的历史行需一次性回填（缺失时显式报错是故意的：让缺口可见，而不是静默双路径）
- machine 链 `read-file` 端点在 web 侧消费方（`resolveUserImageUrl`）迁移后删除（后续波次）；machine 链最终定位 = 「会话创建前的机器能力」+「机器维度配置」
- ADR 0004 的「两通道同源」语义进一步收窄：两通道读边界完全同一函数同一参数形态，扩展名白名单条款作废
- 白名单废除后的补充收窄（2026-09-24 code-review）：扩展名白名单原是 machine 链上「home 散落敏感文件」的唯一闸门，废除后 `~/.env` 等可被读通道静默读取。已在 `validateReadPath` 单源补**敏感文件名黑名单**（凭证/shell 历史/密钥材料，basename 级全域拒绝，`.mobi/uploads` 豁免保写读对称）——两通道同时收窄，统一性不破。与「token 持有者可经对话让 CC 执行任意命令」的既有事实不矛盾：那条路径要过对话与审批的可视环节，read-file 直连是可脚本化的静默通道，收窄针对后者
