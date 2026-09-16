---
name: desktop-stream-verify
description: 远程桌面 E2E — fake-rfb-server 起停、watch 全链路、抢占/关流/断开清理的验证观测点
metadata:
  type: recipe
  last_verified: 2026-09-17
---

# 远程桌面观看验证

## 前置

1. e2e 环境起好后（[[env-bootstrap]]），另起假 RFB server：
   `nohup bun packages/cli/scripts/fake-rfb-server.ts 15900 > /tmp/fake-rfb.log 2>&1 &`
   （端口 = profile 的 `MOBI_DESKTOP_VNC_PORT`；只吃裸端口号，不支持 `--port`）
2. VNC 密码写入 `~/.mobi-e2e/settings.cli.json`：`{"desktop":{"vncPassword":"..."}}`（1-16 位；cli 启动时读取，改后须重启 e2e runner）
3. 鉴权注意：`/api/desktop/*` 走 JWT（cookie 或 Bearer），裸 cli token 会 401「Invalid token」——curl 验证时改在浏览器里 `fetch('/api/desktop/streams')`

## 验证路径与观测点

- **画面渲染**：`/desktop?machine=<id>` → Canvas 出现 RGB 色带；侧边栏「远程桌面」分区出现流条目
- **抢占**：再开一个 tab 同 URL → 新 tab 出画面；旧 tab 显示「该机器已在其他设备开始新的观看」；旧 tab `list_network_requests` 里 `POST /api/desktop/watch` 只出现一次（归因 4000 不重连）
- **侧边栏关流**：点条目 ✕ → modal.confirm「关闭这条观看流？」→ 确定后观看页显示「观看流已被关闭（可能从其他设备操作）」、分区消失
- **断开清理**：关页面 → `/tmp/fake-rfb.log` 出现 `client disconnected`、浏览器查 `/api/desktop/streams` 为 `{"streams":[]}`

## 坑

- fake-rfb rect 头必须 12 字节、须 500ms 帧率节流（修在脚本里）；noVNC 报 `Unexpected server message` 即字节流错位
- 负载：fake-rfb 全帧刷屏会打满浏览器主线程（evaluate/screenshot 全超时）——脚本已限 400×300 + 节流，别调回全速
- MCP Chrome 僵尸见 [[browser-connect]]
