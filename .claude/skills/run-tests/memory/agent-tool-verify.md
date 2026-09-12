---
name: agent-tool-verify
description: 验证 agent 侧 MCP 工具（B 类系统操作）— 探针 prompt 设计 / tool_use+tool_result DB 断言 / tool search defer 真相 / Auto 模式使审批断言失效
metadata:
  type: recipe
  last_verified: 2026-09-12
---

# Agent 侧 MCP 工具验证（B 类）

验证「给 agent 用的工具」是否真能被检索、调用、拿到正确结果。与 [[web-tools-verify]]
（设置页 Web Tools 卡片）不同：那条测的是 provider 配置落盘，这条测的是**工具本身在真会话里跑通**。

## 步骤

环境照 [[env-bootstrap]] / [[login]] / [[create-project]] / [[create-session]]。建会话前确认
权限模式下拉值是 **Auto**（残留坑见 [[create-session]]）。

1. 发探针消息。**不要点工具名**——想验证检索就描述需求，让模型自己找：

   > 现在有哪些 mobi 机器在线？请用 mobi 应用自己提供的工具来查，不要用命令行或读文件。

   后半句「不要用命令行或读文件」是关键——否则模型很可能用 Bash 绕过，验证不到工具链。

2. 等 20-30s（建会话 + spawn CLI + 首轮约 5-10s），`evaluate_script` 读正文确认答对。

3. **DB 断言硬证据链**（`~/.mobi-e2e/mobi.db`，content 结构是
   `content.data.message.content[]`，注意多一层 `.data`）：

   ```bash
   # ① init 事件里工具是否注册（schema 被 defer，名字仍列出）
   sqlite3 ~/.mobi-e2e/mobi.db "SELECT CASE WHEN content LIKE '%mcp__你的server__工具名%' THEN 'HIT' ELSE 'MISS' END FROM messages WHERE session_id='<sid>' AND json_extract(content,'\$.content.data.subtype')='init';"

   # ② tool_use 是否真发生
   sqlite3 ~/.mobi-e2e/mobi.db "SELECT substr(content,1,900) FROM messages WHERE session_id='<sid>' AND content LIKE '%工具名%' AND content LIKE '%tool_use%' ORDER BY position_at LIMIT 3;"

   # ③ tool_result 原文（拿 tool_use 的 id 回查）
   sqlite3 ~/.mobi-e2e/mobi.db "SELECT content FROM messages WHERE session_id='<sid>' AND content LIKE '%<tool_use_id>%' AND content LIKE '%tool_result%' LIMIT 1;"
   ```

   会话 id 从 URL 取（`/sessions/<uuid>`）。③ 的输出用
   `python3 -c "import sys,json; d=json.load(sys.stdin); ..."` 展开。

4. 交叉验证返回值：拿工具返回的标识（如 machineId）与 Hub 侧权威源（`curl -b jar /api/machines`）
   比对。**模型编不出 UUID + 当前时刻的心跳**，对上了才算真链路通。

## 往同一个 server 加第二个工具（2026-09-12 实测）

改了 Hub 侧（新 socket handler / 新服务方法）后，**运行中的 hub 进程是旧代码**——必须重启
hub 才验得到（recipe 见 [[env-bootstrap]] 的「hub 单独重启」，数据目录保留，比 cleanup+bootstrap 省一轮重建素材）。

会话 CLI 同理：已 spawn 的会话是旧代码，**必须新建会话**。

一步到位的顺序：改代码 → hub 单独重启 → 新建会话（沿用旧项目，`/sessions/new?projectId=<id>`）→ 发探针。

**回归检查用 init 工具清单**（一次查询覆盖所有 mobi 工具是否都还在）：

```bash
sqlite3 ~/.mobi-e2e/mobi.db "SELECT content FROM messages WHERE session_id='<sid>' AND json_extract(content,'\$.content.data.subtype')='init' LIMIT 1;" \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['content']['data']; print([t for t in d['tools'] if t.startswith('mcp__mobi-')])"
```

## 验证「状态是否瞬时」/「返回时是否已生效」

问「工具返回的那一刻，某个状态是否已经就绪」时，别盯 DOM（轮询粒度不够），用两侧夹逼：

1. **基准侧**：从 DB 取该次 `tool_result` 的 `data.timestamp`（毫秒精度，就是 CLI 写回执的时刻）
2. **观测侧**：后台跑高频轮询权威源（如 `curl -b jar /api/sessions`），只在**内容变化**时打印
   `python3 -c 'import time;print(f"{time.time():.3f}")'` + 变化后的快照

两侧一减就是窗口长度。实测（2026-09-12）：`create_session` 的结果时间戳与轮询首次看到
新会话（且已 `active=1`）相差 **51ms**，据此判定「建完即可发消息」成立、不需要加等待。

```bash
# 轮询脚本骨架（写 /tmp 后台跑，只在变化时输出）
prev=""
for i in $(seq 1 240); do
  cur=$(curl -s -b /tmp/e2e-jar.txt http://localhost:2224/api/sessions | python3 -c "…一行摘要…")
  [ "$cur" != "$prev" ] && [ -n "$cur" ] && { echo "$(python3 -c 'import time;print(f"{time.time():.3f}")') $cur"; prev="$cur"; }
  sleep 0.05
done
```

**坑**：轮询间隔受 `curl`+`python` 进程启动开销限制（实测每轮 ~200ms 起，机器压载时更差），
所以只能给出**上界**（「窗口 < X ms」），别把「没观察到」当成「不存在」——要更细的粒度就得
看日志或加埋点。

## 坑

- **Auto 权限模式自动放行一切 → 「没弹审批」不能证明预授权生效（2026-09-12 实测）**
  做了判别实验：让 agent 跑 `Bash pwd`（未预授权），**同样不弹审批**。故 Auto 模式下
  `allowedTools` 预授权条目是否拼对**无法用 E2E 证伪**。要真验证必须新建会话并选一个会弹审批的
  权限模式；权限模式**只在建会话时可选**（既有会话 composer 只有 Model + Output Style）。
  反过来，读到这条前别拿「没弹审批」当预授权通过的证据。
- **deferred 工具名在 init 里是可见的，描述不参与「检索」** — `system/init` 的 `tools[]`
  已含 `mcp__xxx__yyy` 全名，只有 schema/描述被 defer。实测模型直接用
  `ToolSearch "select:mcp__mobi-apps__list_machines"` 精确取，而非关键词搜索。写工具描述时
  别假设「描述决定能否被发现」——决定的是**名字**；描述影响的是**用不用、怎么用**。
- **composer 的 more 按钮点击后无菜单**（2026-09-12）— 用
  `ta.closest('.ant-sender')` 取最后一个 icon 按钮 `.click()` 不弹 Dropdown。需要 composer
  菜单时改用 a11y snapshot 拿 uid click。
- **Settings 页只有 Notifications / Web Tools 两项** — 没有「自动审批」开关；[[create-session]]
  说的「关自动审批」指的是**权限模式**，不是设置项。
- 回归检查顺带做：同一轮里模型通常还会调 `mobi-core:change_title`，它的 tool_result
  （`Successfully changed chat title to: "…"`）能同时证明 mobi-core server 未被改坏。
