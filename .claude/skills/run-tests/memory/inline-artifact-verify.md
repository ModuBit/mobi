---
name: inline-artifact-verify
description: 产物声明 :mobi-artifact 全链路 E2E recipe——inline 渲染断言、悬空降级、挂载验证、孤儿进程误判坑
metadata:
  type: recipe
  last_verified: 2026-09-26
---

# 产物声明（:mobi-artifact）全链路验证

## 前置

- **必须 cleanup + bootstrap 重启环境**：契约在系统提示、插件在 spawn 挂载，会话 CLI 进程启动即固化代码（同 [[env-bootstrap]] 代码新鲜度纪律）
- 断言全用 `evaluate_script` 查 testid：`artifact-card`（产物卡）/ `artifact-inline-image` / `artifact-inline-audio` / `artifact-inline-video` / `artifact-inline-html`（iframe 在内）/ `[data-artifact-html-placeholder]`（流式占位）
- 流式占位断言需包 `DirectiveStreamGate.Provider value=true` 的场景才出现；历史消息加载恒非流式 → 直接 iframe

## 场景 recipe（真机已验证 2026-09-26）

- **A 图片 inline**：prompt 明确要求「生成后用 :mobi-artifact 声明」（首轮模型契约遵从率实测 100%，但点名更稳）。断言 `[data-testid="artifact-inline-image"]` 内 img src 含 `/read-file` 且带 `v=<etag>`
- **B HTML iframe**：断言 iframe src 含 `/serve-file/`、sandbox 含 allow-scripts、`data-wide` 属性随 mode。模型对「多面板对比」自主选 mode="wide"（skill §4 判据生效的行为证据）
- **C 悬空降级**：直接 `rm` 已声明的产物文件 → 刷新页面 → 原 inline 变产物卡且文案「文件不存在或不可读」。比 DB 造消息简单且确定性等价
- **D 窄屏**：`resize_page 375` → 断言 wrap/iframe clientWidth ≤ 视口且 `getBoundingClientRect().right <= viewport+1`（无横向溢出）。注意 Chrome 最小窗宽限制，viewport 可能 >375，断言以实际 clientWidth 为准
- **挂载验证**：找 e2e 会话 CLI（`--started-by runner` 且启动时间在 bootstrap 之后）的**内层 claude 子进程**（`pgrep -P <cli-pid>`），arg 里应有 `--plugin-dir <repo>/packages/cli/plugins/mobi`。`~/.mobi-e2e/runtime/*/plugins/` 不存在是**正常的**——开发态走源目录直连不落 runtime

## 坑

- **孤儿进程误判挂载失效（2026-09-26 实踩）**：`ps | grep "index.ts claude --resume"` 会命中**当天早些时候的孤儿会话进程**（ppid 1、启动时间远早于本次改动），其内层 claude 自然没有新 flag——据此断「挂载没生效」是误判。判别三要素：command 含 `--started-by runner` + ppid 指向活 runner + lstart 晚于 bootstrap。**生产会话（`.local/bin/mobi` 二进制）混在同一 ps 输出里，禁碰**（[[send-message-verify]] 的杀进程归属纪律同样适用）
- 截图保存路径必须在 workspace 内（/tmp 被 CDP 拒），放 `.scratch/<feature>/` 即可（.scratch 本地不提交）
