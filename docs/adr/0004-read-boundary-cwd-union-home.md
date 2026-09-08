# 文件读取边界放宽：cwd ∪ home−黑名单，写仍锁 cwd

## Status

accepted（2026-09-08）。取代此前「读边界 = 严格 cwd 子树」的保守基线（走法 A），为 mobi://file/open 动作协议（ADR 0003）二期「@ 引用文件打开」铺路。

## 背景

file/open 协议的 path 参数透传任意路径，但实际可达范围由 CLI readFile*（readFileMeta/readFileRange）的边界校验决定。原边界 = 严格 cwd 子树，导致四类 @ 引用形态中只有「项目内相对路径」真正可打开——用户 @ 了家目录下文件（`~/notes/a.md`、绝对路径）时 inspector 必然失败。原始保守基线的担忧是「放宽 = home 全量暴露」。

## 决定

**读取边界 = cwd 子树 ∪ (home 子树 − 黑名单)，读写分离**：

- **黑名单先于一切允许域**：路径落入黑名单目录即拒绝，即使 cwd 恰为 home（此时 cwd 子树全放行会绕过黑名单，故黑名单必须先行）。黑名单只匹配 home 直接子级（`DEFAULT_BLACKLISTED_DIR_NAMES`：`.ssh` `.aws` `.gnupg` `.config` `.claude` `.agents` `.mobi` + `MOBI_SEARCH_BLACKLIST` 扩展），cwd 内同名目录（`src/.config/`、`.mobi/uploads/` 附件）不误伤
- **`~` 前缀展开为 `os.homedir()`**：仅裸 `~` 与 `~/`；`~user` 不支持（多用户语义罕见且歧义大），按字面路径交给边界拒绝
- **写边界不变**：writeFile/saveFile 及一切写路径保持严格 cwd 子树。读放宽不放大写风险；web 端据此把写边界外文件直接渲染为只读态
- **两通道同源**：session 通道（files.ts）与 machine 通道（machineFiles.ts，保留其独有的扩展名白名单）共用同一校验函数（shared `validateReadPath`），「读文件边界」语义单源收口，杜绝双写漂移
- **可写性下发**：readFileMeta 响应携带 `writable`（CLI 用与 writeFile 同一校验函数计算，hub 透传）——web 端 inspector 不复刻边界规则，可写性判定与写校验永远一致

## Considered Options

- **维持严格 cwd 边界 + web 端预判不绑点击**：协议透传沦为空话——@ 家目录文件点击无响应，且 web 复刻边界规则必然漂移
- **黑名单全局生效（含 cwd 子树）**：`.mobi/uploads` 附件在项目即 home 的场景被误拦，需要养豁免清单，复杂度换不来安全增益
- **web 端复刻写边界规则计算只读态**：约 5 行前缀判断，但「可写」语义有了第二个权威，未来写边界调整时两处必有一处漏改
- **只读渲染视图承接不可写文件**（沿用旧路径）：CodeMirror/TipTap 只读态与编辑态渲染不一致（两套渲染器），违背「编辑与只读渲染效果一致」的产品语义

## Consequences

- home 下未拉黑文件（笔记、配置、文档）在 inspector 中可查看；黑名单目录读取失败态诚实呈现
- web 端 text/markdown 一律挂编辑器（readOnly = 离线 ∨ 写边界外），离线只读渲染视图（Shiki 高亮 / XMarkdown 只读渲染）对 text/markdown 退役，MarkdownContentView 删除
- 读写分离后攻击面变化：web 端会话内可读 home 全量（除黑名单）——黑名单是唯一闸门，扩黑名单只动 `DEFAULT_BLACKLISTED_DIR_NAMES` / `MOBI_SEARCH_BLACKLIST`
- `file/open` 协议本体零改动：四类 @ 形态的可达性由本边界承接，协议只承诺透传
