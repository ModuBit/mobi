---
name: yolo-bypass-verify
description: 权限审批链路 E2E 验证——Write 是可靠审批探针（change_title 已不触发）；agent_state.requests 是审批 pending 权威判据
metadata:
  type: recipe
  last_verified: 2026-11-17
---

# YOLO 免审放行验证（shouldBypassApproval，2026-11-17）

## 探针工具选择

- **Write 是可靠审批探针**：default 档下 SDK 必回调 canUseTool → `agent_state.requests` 出现 `tool=Write` 的 pending。
- **change_title 不再触发审批**（native-id-verify 时代「首回合 Change Title 审批卡」已不复现，SDK 行为已变）——别再拿它当审批探针。

## 判据（别用 DOM 文本正则）

- **审批 pending 权威判据 = DB `agent_state.requests`**：`sqlite3 -readonly ~/.mobi-e2e/mobi.db "SELECT agent_state FROM sessions WHERE id=..."` 解析 `requests` 字典。页面文本正则（允许/拒绝/mobi 字样）必误报——权限档位菜单文案含「批准」、浏览器通知条含「允许通知」。
- YOLO 放行断言 = 全程 requests 恒空 **且** 副作用达成（文件落盘内容核对）——挂起审批与副作用互斥，副作用成立即无挂起。

## 手法

对照组先行：default 档会话跑同探针，先证明「这条链路会弹」，再验 YOLO「不弹」——否则「没弹」可能只是探针根本不触发审批。spawn 直传 `permissionMode`（bypassPermissions / default）比 UI 切档稳。

## 坑

- daemon 重启后 jwt-secret 重建，web 登录 cookie 失效需重新 /api/auth。
- 探针写进 `~/workspace/demo` 的文件记得清理（该目录与用户共享）。
- `run_in_background` 的 daemon 30 分钟硬限被杀后（setsid 不免疫），重拉即可，数据目录保留。
