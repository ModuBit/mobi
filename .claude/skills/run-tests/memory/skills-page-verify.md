---
last_verified: 2026-11-17
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
- UI（2026-11-17 起单输入重构，旧 `#skills-install-source` + `#skills-install-find` 双输入已废）：
  `[data-testid="skills-install"]` → 弹窗内唯一 `input[type="search"]` 填值（React 受控须 native setter + input 事件）。
  形态判定：纯关键词 → 点底部主钮/回车/字段内左侧放大镜（`button[aria-label=搜索]`）搜生态；
  `owner/repo` → 主钮变「获取清单」拉整仓清单；`owner/repo@skill` → 主钮「安装」直装（不拉清单）。
  打字过程零请求（断言 `mockFind/available/install` 都未被调用，请求走 XHR 拦截时可看 `/api/skills/find` 是否发出）。
- 搜索结果点选 → 只锁定该 skill（chip「名称 + owner/repo ×」），**不再拉整仓清单**；点主钮直装，source 带 `@skillId`。
- 拉清单期间：底部次钮变「取消获取」= 放弃等待（不关弹窗、seq 丢弃晚到结果）——拦 XHR 延迟 5–8s 即可验；点取消后断言「正在拉取仓库清单…」消失、弹窗仍在、延迟返回后选择段不出现。
- npx 冷启动 30–60s，轮询 toast「安装完成」+ 弹窗关闭。
- **只验选择段/复选框外观时别等真克隆**（2026-11-17）：在页面里拦 `XMLHttpRequest.prototype.open/send`，对 `/api/skills/available` 直接回 `{ skills: [{ name, skillId, source, description, installed, conflict }] }`（自定义 readyState/status/responseText + 调 onreadystatechange/onload/onloadend）；点「获取清单」1s 内出列表。装 `installed:true` 得 checked+disabled 样本，`false` 得可点样本；点一下可切 unchecked。
- tracked 断言：API `tracked: true` + `installSource`；磁盘 `~/.agents/skills/<name>`（中央仓）+ `~/.claude/skills/<name>`（实体目录非 symlink）。
- 更新：详情 sheet 操作区「更新」钮 → toast「已更新」→ 目录 mtime 刷新。
- 幂等重装已 tracked skill 是安全路径（不产生重复行）。

## Checkbox 外观双档断言（2026-11-17 修「勾不可见」）

- 选择段用的 `ui/shadcn/checkbox`：`.box` color=--control-glyph（暗档 #131316 / 亮档 #f0f0f4），`.fill` bg=--control-on（暗档 #f6f6f8 / 亮档 #3a3a41）
- **判据（双主题各验）**：`getComputedStyle(svg path).stroke` 必须等于 `--primary-foreground`、且与 `.fill` 背景形成反差；`.copy label` 14px colorText、`.copy span[description]` 12px text-muted（标题/描述层级）
- **坑：容器级后代选择器泄漏**——本页 `FormBody` 曾有 `span, label { color: colorText }`，钻进 Checkbox 内部把 `.visual` 的 color 覆盖成正文色 → 暗档白勾压白块全不可见（用户截图实锤），亮档勾与底同暗。修复 = 收窄到 `> span, > label`（只命中表单自己的字段标题）。**今后看到「嵌入组件的勾/图标颜色莫名等于正文色」先查外层 styled 的裸元素选择器**
- 回归探针：两档下 `path.stroke !== fill.bg` 且色差 ≥ 明显反差；unchecked 态 border 双档可见（亮 #adadb4 / 暗 #5d5d65）
- **单选件已迁 uiarc（2026-11-17）**：antd Radio 全站清零（eslint 禁新增），本页新建/安装弹窗用的是自管 Combobox；antd.css 的 `--ant-radio-radio-color` 覆写已随迁移删除。单选件探针见 [radio-widget-verify.md](radio-widget-verify.md)


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

