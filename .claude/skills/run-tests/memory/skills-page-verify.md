---
last_verified: 2026-11-14
---

# Skills 管理页验证（skill-mgmt 票 08 + 详情 sheet 迭代）

设置页 /settings/skills 全链路：列表/开关/详情 sheet/删除/安装/更新/内置名单/新建预填。

## 素材准备（expendable）

- 开关/删除素材：`~/.claude/skills/e2e-alpha/SKILL.md`（toggle 用，验完开回 on）、`~/.claude/skills/e2e-del/SKILL.md`（删除用，真删）、`~/.claude/skills/e2e-meta/SKILL.md`（详情 sheet 用，frontmatter 带 when_to_use/argument-hint/model/effort/context: fork 等富字段）。frontmatter 只需 name+description。
- e2e 环境 CLAUDE_CONFIG_DIR 走真实 HOME（daemon 进程 env 决定，bootstrap 不传）——开关会真写 `~/.claude/settings.json`、删除真删磁盘目录，素材必须 expendable。

## 开关验证（绕开 settings.json 读权限）

`~/.claude/settings.json` 被敏感文件保护 Read/cp 均拒——**不要试图读文件**，用 API 断言写入闭环：

```js
await fetch('/api/skills', { credentials: 'include' })
// 断言 ownState / effectiveState / effectiveFromLayer === 'user'
```

UI 侧：`[data-skill-name="x"] [role="switch"]` 点击后断言 aria-checked + 「已停用」徽标。开关是自管 shadcn Switch（button[role=switch]）非 antd。

**Sheet 内开关同步必须验**（2026-11-14 实踩两连 bug）：点行打开详情 sheet → 点 sheet 头部开关 → 断言「sheet 开关 aria-checked 与 API effectiveState 同步翻转」。曾坏两处：① useSkillVisibility 只失效列表键不含 skillsDetail → sheet 缓存旧值；② sheet 头部用行数据快照 prop 不随列表刷新。判据：`match: (ui === 'true') === (api === 'on')`，正反两个方向各点一次。

## 详情 sheet

点击行打开 BottomSheet（行右槽只留开关+徽标，更新/删除已搬进 sheet 操作区——`[data-skill-delete]/[data-skill-update]` 行级选择器已失效）。断言：

- 头部：名 + 描述 + 开关；`when_to_use` 等元数据行「有才显示」（e2e-meta 富字段 vs e2e-alpha 裸字段对照）
- 正文：SKILL.md 全量 Markdown（sheet 本体滚动，无限高内滚）
- 卸载：ConfirmMorph **就地确认两击**（armed → 删除钮），**不是 modal.confirm**；6s confirmTimeout，工具调用往返超时会让 armed 回 idle——一气呵成单脚本内两击。生产无 data-testid，按文本定位（卸载 → 「将直接删除…」armed prompt → data-autofocus 删除钮）
- 三层断言：DOM 行消失 + API 列表不含 + 磁盘目录消失

## 安装/更新（真实 npx skills）

- **先终端预检 CLI 非交互**：`env -u MOBI_HOME CLAUDE_CONFIG_DIR=/tmp/probe npx -y skills add vercel-labs/skills --agent claude-code -g --yes`（repo 单 skill 时无交互；`--yes` 必带）。
- UI：`[data-testid="skills-install"]` → `#skills-install-source` 填 source（React 受控须 native setter + input 事件）→ OK。npx 冷启动 30–60s，轮询 toast「安装完成」+ 弹窗关闭。
- tracked 断言：API `tracked: true` + `installSource`；磁盘 `~/.agents/skills/<name>`（中央仓）+ `~/.claude/skills/<name>`（实体目录非 symlink）。
- 更新：详情 sheet 操作区「更新」钮 → toast「已更新」→ 目录 mtime 刷新。
- 幂等重装已 tracked skill 是安全路径（不产生重复行）。

## 内置名单首采

首访全局 tab 触发 probe（~2.5s，底部 busy）。断言：
- `~/.mobi-e2e/bundled-skills.json` 落盘（键 `claudeVersion`）
- `ls ~/.claude/skills/ | grep mobi` 空（mobi-probe 用完即删）
- `pgrep -fl mobi-probe` 空
- 用户同名覆盖：内置行「被同名技能覆盖」徽标（如 code-review）

## 新建预填（票 07 链路）

- 无工作区分支：提交 → warning toast「请先创建一个工作区」+ 不跳转。
- 建工作区 API：`POST /api/workspaces { name, folders: [{ path, primary: true }] }`（**primary 必带**否则 Invalid body；path 须在 homeDir 内）。
- 主路径：弹窗选 ws radio（按 value=workspaceId 定位）→ 提交 → 跳 `/sessions/new?workspaceId=...`。
- **composer 不是 textarea**：查 `.tiptap.ProseMirror` 的 textContent（预填 prompt 445+ 字符）。

## 主题/移动端

- 主题：`localStorage['mobi-ui']` 的 `state.theme` 改写 + 整页 reload（见 design-walkthrough.md，不重复）。
- 移动视口 resize 390×844 实际渲染 500px；断言 `scrollWidth <= clientWidth`（无水平溢出）+ 行 rect 不超视口。

## 坑

- **curl 直调 daemon API 带 cookie token 无效**（401/Invalid）——统一在已登录页面内 `fetch(相对路径, { credentials: 'include' })`。
- locale 缺键在确认弹窗 OK 按钮暴露为原始键文本（如 `common.delete`）——弹窗按钮文案必查。
- 行级开关点击要用行内文本元素定位（`children.length === 0` 的叶子），不要点行容器——右槽开关区有 stopPropagation 但点容器可能误触开关。

