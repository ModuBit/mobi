---
name: radio-widget-verify
description: antd Radio 清零后的单选件验证——RadioGroup/RadioCards/自管 Radio 探针、worktree 无会话素材速造、圆点居中几何断言
metadata:
  type: recipe
  last_verified: 2026-11-17
---

# 单选件（RadioGroup / RadioCards / Radio）验证

## 现状（2026-11-17 起）

antd `Radio` 全站清零且 eslint 禁新增。三件分工：

- **整组短文本**：`ui/shadcn/radio-group`（fieldset/legend + 描边行 + 滑移高亮）→ 消费点 WorktreeMergeModal 合并策略
- **带描述/图标卡片**：`ui/shadcn/radio-cards`（导出 `RadioIndicator`）→ AssignWorkspaceModal 桌面态（layout=list，icon 传 antd icon 时记得 `aria-hidden`，否则读屏名变成 "folder e2e-quote"）
- **单行布尔**：自管 `ui/base/interactive/radio/Radio`（label 包隐藏原生 input，指示器复用 RadioIndicator）→ WorkspaceFormModal「主目录」

## 素材：无会话 worktree（MergeModal 免走 spawn）

`GET /api/worktrees` 只扫会话/工作区里的仓库根 + 目录形状 `<repoParent>/<repoName>-worktrees/<name>` + 分支 `mobi-<name>`。E2E 里直接造，不用建真会话（孤儿 = 合回可用）：

```bash
cd ~/workspace/<e2e-workspace-folder> && git init -q && git config user.email e2e@example.com \
  && git config user.name e2e && echo x > README.md && git add . && git commit -qm init \
  && git worktree add -q -b mobi-merge-ui ../<folder>-worktrees/merge-ui
```

- 设置页 `/settings/worktrees` 刷新即见；`合回` 打开 MergeModal（**只验 UI 不点最终合回**）
- 右上「开启通知」toast 会盖住行内按钮，先把 toast 关掉再点

## 断言集

- **语义**：`getByRole('radio', { name })`；RadioGroup 的可访问名含 label+description，卡片名=label（图标要 aria-hidden）
- **双档配色**：indicator `backgroundColor`/`borderColor` 与内部 dot `backgroundColor` 必须反向
  - dark：fill `#f6f6f8`(246,246,248) / dot `#131316`(19,19,22)
  - light：fill `#3a3a41`(58,58,65) / dot `#f0f0f4`(240,240,244)
- **圆点居中**（用户曾疑 antd 圆点不居中）：uiarc mark/indicator 内 dot 用 grid place-items，实测 `dot中心 − 圆中心 = (0,0)`。
  测量要点：`label > span` 是 wrapper，indicator 在下一层（`> span > span`），dot 再里一层；逐层测，别拿 wrapper 当 dot
- **行内对齐**（WorkspaceFormModal）：radio label 行心 / 18px mark 心 / Combobox 心 三者 y 相等（实测同一值）
- **受控回环**：两行文件夹时点第二行 label 文本 → 两行 checked 互换（label 点击→原生 input→onChange→外部 state）

## 坑

- 移动端 MergeModal（BottomSheet）里「路径」标签会被长路径挤成逐字换行——MetaRow 字段名需 `flex: none`（已修）
- dev POC `/__poc-diff` 的分段控件已换 TabStrip(panelless)；工具栏 Flex 必须 `wrap`，否则窄屏说明文字被挤成 12px 竖排（已修）
- Radix 菜单/更多按钮（title="更多"）常 hover 才出，MCP click 会超时：用 evaluate 找 `button[title="更多"]` 派发 pointerdown→mousedown→pointerup→mouseup→click
