---
name: plan-mode-verify
description: 验证 plan 批准后权限模式切换（auto/acceptEdits/default）—— 切 plan / 触发 exit_plan_mode / 批准按钮 / 模式生效观测点
metadata:
  type: recipe
  last_verified: 2026-08-15
---

# plan 批准后权限模式切换验证

验证「plan 批准时选某档 mode，新 turn 是否真正进入该模式」。修复点：`permissionHandler` 批准时调 `onApplyPermissionMode` → `queryControlRef.current.setPermissionMode` 动态切 SDK Query 运行时模式（修复前只写 session，SDK 仍停留 plan）。

## 切到 Plan Mode

composer 底部权限模式 combobox（文案随当前模式变：Request Approval / Auto / Plan Mode …）。a11y 展开后 listbox 选项在 verbose snapshot 才完整列出，**推荐 evaluate_script 直接点 option**：

```js
() => {
  const opts = Array.from(document.querySelectorAll('[role="option"]'));
  const target = opts.find(o => o.textContent?.includes('Plan Mode'));
  if (target) { target.click(); return 'ok'; }
  return opts.map(o => o.textContent?.slice(0,20));
}
```

校验切中：combobox 旁出现 compass 图标 + 文案 "Plan Mode"。

## 触发 exit_plan_mode

发「创建/编辑/覆盖某文件」类任务（plan 模式禁止编辑，模型必走规划路径）：
> 请在当前目录创建一个 hello.txt 文件，内容是 hello world

模型会 Read 探索 → 写 plan 文件 → 调 exit_plan_mode。状态条出现 `Plan ready for review` + 四个按钮（**用 evaluate_script 点，文案稳定**）：

| 按钮 | mode |
|---|---|
| `Approve (Auto)` | auto（classifier 自动决策） |
| `Approve (Auto Accept Edits)` | acceptEdits |
| `Approve (Manual Review)` | default |
| `Keep Planning` | deny（带反馈输入框） |

```js
() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find(b => /Approve \(Auto\)/.test(b.textContent||''));
  b?.click(); return b ? 'clicked' : 'nf';
}
```

## 模式生效观测点（关键）

批准后新 turn 模型会立即执行编辑工具。**看两处**判断 mode 是否真正切到 SDK Query 运行时：

1. **composer 模式指示器**（右下角图标 + 文案）：plan→auto 时 compass 变 **bulb**；plan→default 变 question-circle + "Request Approval"。指示器随 session.permissionMode（keepAlive 同步）。
2. **编辑工具是否弹审批卡片**：
   - `auto` → Write **不弹审批**，直接 "wrote N lines" 完成（classifier 放行）
   - `default` → Write **弹审批卡片**（Allow / Allow all / Deny + "Irreversible — proceed with care" + `awaiting approval`）
   - `acceptEdits` → Write 不弹（SDK 自动放行编辑）

## 三档预期

| 批准档 | 新 turn Write 行为 | 修复前（卡 plan） |
|---|---|---|
| Auto | 免审批 | 弹审批（bug） |
| Accept Edits | 免审批 | 弹审批（bug） |
| Manual (default) | 弹审批（逐次） | 模型不执行编辑，困在规划态（bug） |

## 坑

- **提交消息用 evaluate_script 点底部 arrow-up 按钮**（type_text + submitKey 在自定义框不可靠，见 [[input-box]] / [[chat-verify]]）
- **批准后立即生效，无重启延迟**（2026-08-15 起 PLAN_FAKE hack 已拆除：批准 → allow + query.setPermissionMode，模型**同一 turn** 直接开始执行计划；旧的「等 ~10s 等 PLAN_FAKE_RESTART 注入」不再需要）
- **同一会话可复用**：切回 Plan Mode 再发新任务，模型会再次规划（不必新建会话）。但任务要换文件名，否则模型纠结已存在文件
- **pending 审批收尾**：default 档验证完会留 pending Write 审批，点 `Deny` 收掉，避免会话一直 awaiting
