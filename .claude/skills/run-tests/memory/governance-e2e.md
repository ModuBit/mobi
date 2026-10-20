---
last_verified: 2026-10-20
---

# 治理（Governor/warm-on-open）E2E

SessionGovernor / LRU 逐出 / warm-on-open 的真机验证 recipe（会话生命周期治理迭代，2026-10-20 实测）。

## 基本事实

- cap 公式：`max(6, floor(totalmem/3GiB))`；本机 24GiB → **cap=8**
- 会话行/CLI 进程对账：`ps -eo pid,command | grep "packages/cli/src/index.ts claude" | grep -v grep | wc -l`
- 逐出落库验证：`sqlite3 ~/.mobi-e2e/mobi.db "SELECT substr(id,1,8), end_state FROM sessions WHERE end_state IS NOT NULL;"`（终结快照单列 JSON：`{reason, trigger?, at}`）
- **spawn 直登会话不产生 session-alive 心跳**（freshSpawn=1 走 resume 死链冷启，CLI 侧 never attach）——不进 SessionRegistry，governor 看不到它 → 纯 yield 场景（满员且无 120s 合格受害者）**无法用纯 spawn 造出**。历史唯一一次 governor_yielded 是首波 8 会话 idle<120s 的窗口
- 逐出受害者判据走 registry lastActivityAt：发过消息的会话 idle ≥120s 即合格

## 造 pause 态会话（warm-on-open 前置）

`POST /api/sessions/:id/dormant` 是 **archive 终态（stop）不是 pause**！造 pause 只能走 governor 逐出：

1. 会话 A spawn + 发消息（`POST /api/sessions/:id/messages`）等回复——**判 role=='agent' 不是 'assistant'**
2. spawn 7 个 filler 填满 cap=8
3. 等 130s（A idle ≥120s）
4. 第 9 个 spawn → governor 逐出 A → DB 落 `pause|governor_evict`

## warm-on-open 触发（无需浏览器）

`POST /api/snapshot-resync` 需真实 SSE 订阅：

```bash
# SSE 建连拿 subscriptionId（后台挂住）
(curl -s -N -b ~/.mobi-e2e/cookies.txt "http://localhost:2224/api/events?sessionId=<A>&visibility=visible" > /tmp/sse.log &)
sleep 3; SUBID=$(grep -o '"subscriptionId":"[^"]*"' /tmp/sse.log | head -1 | cut -d'"' -f4)
# 模拟打开会话页
curl -b ~/.mobi-e2e/cookies.txt -X POST http://localhost:2224/api/snapshot-resync \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"<A>\",\"subscriptionId\":\"$SUBID\"}"
```

- 2s 防抖后 fire；满员 → `warm_yielded`（正确放弃）；有空位 → `warm_triggered` → `warm_done` → A 翻 active + endReason 清 null
- 验收断言：日志 `[WARM-ON-OPEN] warm_*` + A 发消息即答（热身意义实证）

## 日志双写点坑（定位耗 1h 的教训）

- `daemonLogger`（node-core logger）→ `~/.mobi-e2e/logs/daemon.log`
- 进程 stdout/stderr（console.* + bootstrap 重定向）→ `~/.mobi-e2e/logs/<ts>-pid-<pid>-daemon.log`
- **`ls -t | head -1` 取到的文件随两者 mtime 竞争漂移**——grep daemon 事件必须固定查 `daemon.log`；console.error 诊断日志在 pid 文件
- 定位「函数没被调 vs 调了没日志」：console.error（stdout）与 logger.info（文件）分开打，各查各的文件

## spawn 直登无心跳的绕法

governor 逐出实验要受害者进 registry：必须给会话发过消息（消息驱动 attach + 心跳）。纯 spawn 的 filler 只是占名额（追踪表计数），对 registry 不可见——**对 cap 记账无影响（effective 走追踪表），只影响逐出候选池**。

## idle_timeout 自主路径（1.1/1.3 验收）

daemon env 加 `MOBI_IDLE_TIMEOUT_MS=30000`（默认 86400000=1 天，node-core configuration.ts）→ 会话空闲 30s 自主 pause 退出，DB 落 `pause|idle_timeout`；再发消息即唤醒（active + endReason 清空 + 即答）。bootstrap 命令前缀直接加变量即可（`MOBI_IDLE_TIMEOUT_MS=30000 perl ... env -u ...`——env -u 只删列出的变量）。

## 内存 critical 档 mock（2.2 验收，零代码改动）

daemon PATH 前置假 `vm_stat` 脚本（`PATH=/tmp/fakevm-bin:$PATH`）——`readAvailableMemoryBytes` 走 `execSync('vm_stat')`（shell 管道，PATH 劫持生效）。脚本输出 free/speculative/purgeable/inactive 各 ~100 页（page size 16384）→ 可用 ~6.5MB（0.03%）→ 启动即扫出 `governor_memory_pressure critical` + cap 折半（8→4）。假脚本只含 vm_stat 一个文件，其余命令继续走原 PATH。验完删目录。

## QuitCleanup 验收形态（4.1）

SIGTERM daemon pid（`lsof -ti :2224 -sTCP:LISTEN`）→ 5s 内优雅退出 ✓。注意：**生产 registerQuitHandler 零调用**（空注册表）——验的是「退出序不崩」，handler 计时/abandoned 名单只有单测覆盖；要真机验 handler 需先有生产注册项。daemon 退出后 bootstrap trap 会 rm 数据目录（含日志），退出日志要趁活着抓。
