---
name: generative-ui-verify
description: generative-ui（Native openui 面板 + Sandbox App）真机验收 recipe——档②③回灌/原地更新/主题/bridge/安全探针的观测点与坑
metadata:
  type: recipe
  last_verified: 2026-10-11
---

# generative-ui 验收

## 观测点（按档位）

- **档②回灌**：点面板按钮 → 用户气泡带「界面触发」标记出现在 timeline；agent 回复直接响应消息语义
- **档③原地更新**：按钮文案三态 idle→「执行中...」→「已完成 ✓」，说明文字随 `$actionState` 联动；**刷新/切会话后终态从落库 meta 恢复**（evaluate_script 读 `main main` innerText 断言文案）
- **失败回滚**：停 daemon（按 PID）→ 点按钮 → Network 里 POST messages `ERR_CONNECTION_REFUSED` → 按钮文案回 idle 不卡 running；daemon 恢复后重试可发出
- **Sandbox App**：自然口吻出 iframe 卡片 + `Skill(mobi:visualize)` 工具卡；文件落 `<cwd>/.mobi/artifacts/YYYY-MM/`；「查看文件」链接 + 尺寸切换（自适应/736/1024）+ turn-file-changes「已编辑 N 个文件」卡
- **bridge 回灌**：沙箱按钮 → 气泡带「应用触发」标记；Edit 后 iframe 重建、新按钮出现（dataUpdatedAt 重建，app 本地状态会归零——非 bug）
- **主题跟随**：`localStorage['mobi-ui']` 的 **`state.theme`**（不是顶层键！顶层残留键会误导）改 `dark` 后**必须整页 reload**；断言 iframe body `backgroundColor` 翻转
- **沙箱安全**：让 app 放「fetch 外网 + 读 file://」两按钮，iframe 内点 → 双双 `TypeError: Failed to fetch`（CSP connect-src 'none' 实证）；iframe 内网络请求 `contentWindow.performance.getEntriesByType('resource').length === 0`
- **无 provider**：直接开 serve-file URL（聊天外独立打开）→ 点 bridge 按钮 → app 自己的 fallback 提示、不发消息不报错

## 坑

- **发消息探针必须单行**（[[input-box]] 通用坑），openui prompt 也不例外
- **排队窗口抓取**：慢任务执行中点按钮 → 「排队中（N）」悬浮条出现即成功；慢任务结束瞬间的中间态（门控防误翻 done）真机抓不到，由 actionState 单测锁定（queued 窗口内 result 不归因），真机只验终态正确
- **daemon 时限杀 + bootstrap 退出**：`run_in_background` 默认 30min 时限会杀 daemon；拉环境用 `timeout: 7200000`（2h 上限）。bootstrap 退出后手动拉 daemon 前必须 `mkdir -p ~/.mobi-e2e/logs`（trap 清目录致日志重定向失败 exit 1）
- **数据目录清空后**：seed 脚本直插 DB 重建 workspace+session（[[env-bootstrap]] 模板）；磁盘产物（.mobi/artifacts）不受影响
- **e2e daemon 重启后旧 CLI 成孤儿（ppid=1）不重连**：消息受理但 turn 不跑；按 PID 验证归属（workspace id + etime）后 kill，发消息触发新 spawn
