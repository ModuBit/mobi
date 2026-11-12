---
last_verified: 2026-11-12
---

# Skills 管理页验证（skill-mgmt 票 08）

设置页 /settings/skills 全链路：列表/开关/删除/安装/更新/内置名单/新建预填。

## 素材准备（expendable）

- 开关/删除素材：`~/.claude/skills/e2e-alpha/SKILL.md`（toggle 用，验完开回 on）、`~/.claude/skills/e2e-del/SKILL.md`（删除用，真删）。frontmatter 只需 name+description。
- e2e 环境 CLAUDE_CONFIG_DIR 走真实 HOME（daemon 进程 env 决定，bootstrap 不传）——开关会真写 `~/.claude/settings.json`、删除真删磁盘目录，素材必须 expendable。

## 开关验证（绕开 settings.json 读权限）

`~/.claude/settings.json` 被敏感文件保护 Read/cp 均拒——**不要试图读文件**，用 API 断言写入闭环：

```js
await fetch('/api/skills', { credentials: 'include' })
// 断言 ownState / effectiveState / effectiveFromLayer === 'user'
```

UI 侧：`[data-skill-name="x"] [role="switch"]` 点击后断言 aria-checked + 「已停用」徽标。开关是自管 shadcn Switch（button[role=switch]）非 antd。

## 删除（untracked）

`[data-skill-name="x"] [data-skill-delete]` → modal.confirm（untracked 文案「将直接删除该技能目录」；tracked 文案「将通过 skills CLI 卸载」）→ OK 按钮文案含 locale 键内容。验三层：DOM 行消失 + API 列表不含 + 磁盘 `ls -d` 目录消失。

## 安装/更新（真实 npx skills）

- **先终端预检 CLI 非交互**：`env -u MOBI_HOME CLAUDE_CONFIG_DIR=/tmp/probe npx -y skills add vercel-labs/skills --agent claude-code -g --yes`（repo 单 skill 时无交互；`--yes` 必带）。
- UI：`[data-testid="skills-install"]` → `#skills-install-source` 填 source（React 受控须 native setter + input 事件）→ OK。npx 冷启动 30–60s，轮询 toast「安装完成」+ 弹窗关闭。
- tracked 断言：API `tracked: true` + `installSource`；磁盘 `~/.agents/skills/<name>`（中央仓）+ `~/.claude/skills/<name>`（实体目录非 symlink）。
- 更新：`[data-skill-update]` → toast「已更新」→ 目录 mtime 刷新。
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

- **curl 直调 daemon API 带.cookie token 无效**（401/Invalid）——统一在已登录页面内 `fetch(相对路径, { credentials: 'include' })`。
- locale 缺键在确认弹窗 OK 按钮暴露为原始键文本（如 `common.delete`）——弹窗按钮文案必查。
