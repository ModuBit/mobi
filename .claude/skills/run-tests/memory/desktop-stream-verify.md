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

## 真实场景（e2e 直连本机屏幕共享）

- `~/.mobi/profiles/e2e.env` 设 `MOBI_DESKTOP_VNC_PORT=5900`，`~/.mobi-e2e/settings.cli.json` 写真实 VNC 密码（屏幕共享设置的 VNC 观看者密码）
- macOS 回版本串 `RFB 003.889`（Apple 私有）：hub 按 3.8 时序协商（min 规则），且 **889 的 VNC-auth 应答须为 16 字节**（整个 challenge DES 加密；标准 8 字节会让 macOS 挂起等剩余 8 字节——曾致认证挂死）
- 5K 屏首帧洪峰大（hextile ~17MB/帧）：hub relay 必须无排空轮询（见 [[bun-ws-bufferedamount-trap]]），慢消费者用字节差值 64MB 护栏
- 诊断路径：hub `[desktop] handshake/stats/teardown` 日志 + runner `DEBUG=1` 的 `[desktop] stream ended` + 直连 5900 探针（`Bun.connect` 走握手看安全类型/挑战应答）

## 控制权全链路（迭代 2）

- 前置：profile 加 `MOBI_DESKTOP_CONTROL_IDLE_MS=15000`（E2E 短空闲时效，hub 启动读 env）+ fake-rfb 起 `FAKE_RFB_INPUT_LOG=/tmp/fake-rfb-inputs.jsonl`（上游收到的输入按行追加 JSONL，断言剥除/放行就靠它）
- 断言序列（idle 时效内要一气呵成，跨工具调用会先撞 15s 超时回落）：
  1. view-only 下 canvas 聚焦后 CDP `press_key` / 合成 KeyboardEvent → input log 零新增
  2. 点「接管控制」→ 等「控制中」Tag → 再按键 → log 出现 `{"kind":"key",...}`（down+up 两行）
  3. 等 15s → UI 自动翻回「观看中」（**验证 SSE desktop-control-changed 同步，不用刷新**）→ 再按键零新增
  4. 接管 → 点「退出控制」→ 再按键零新增
- 坑：**hub 重启后旧观看流全灭**，授予 API 404「Stream not found」——先 reload 页面重建流
- 坑：live 相位首个字节是 ClientInit（裸 shared-flag，非类型化消息），过滤器按消息表解析会吞掉它（shared=0 进 carry 永久等待）→ 全链路挂起无任何报错；filter 内已特殊处理，新增解析逻辑别动这段

## 坑

- fake-rfb rect 头必须 12 字节、须 500ms 帧率节流（修在脚本里）；noVNC 报 `Unexpected server message` 即字节流错位
- 负载：fake-rfb 全帧刷屏会打满浏览器主线程（evaluate/screenshot 全超时）——脚本已限 400×300 + 节流，别调回全速
- MCP Chrome 僵尸见 [[browser-connect]]
