---
name: send-message-verify
description: E2E 验证 send_message_to_session 的投递链路 — 造一对会话 / 探针措辞（必须点名工具）/ DB 断言（meta + lifecycle + 恰好一行）/ 富内容（引用+图片+附件）与跨机器的造法 / 死目标与扇出素材
metadata:
  type: recipe
  last_verified: 2026-09-12
---

# 跨会话消息投递验证（send_message_to_session）

验「会话 A 的 agent 把消息投给会话 B、B 用同一工具回信」这条链路。前置同
[[agent-tool-verify]]（环境、登录），但**不需要浏览器**：环境照 [[env-bootstrap]]，
建会话与发探针都可以 curl 直调（见下），浏览器只在要验 Web 呈现时才开。

⚠️ 会话 CLI 代码在**进程启动时固化** → 改了 CLI 源码后必须**新建会话**才验得到
（[[env-bootstrap]] 的「会话 CLI 代码新鲜度」）。改了 Hub 则走「hub 单独重启」。

## 步骤

1. 换 cookie：`curl -c /tmp/e2e-jar.txt -X POST -H 'Content-Type: application/json'
   -d '{"accessToken":"e2e-test-token-mobi"}' http://localhost:2224/api/auth`
2. 取机器 id：`curl -s -b /tmp/e2e-jar.txt http://localhost:2224/api/machines`
   （响应是 `{"machines":[...]}`；机器 id 是 `id` 字段）
3. 造一对会话（免走浏览器/项目）——**每会话一次**：
   ```bash
   curl -s -b /tmp/e2e-jar.txt -X POST -H 'Content-Type: application/json' \
     -d '{"directory":"/Users/manerfan/workspace/demo","permissionMode":"auto"}' \
     http://localhost:2224/api/machines/$M/spawn     # → {"type":"success","sessionId":"…"}
   ```
   A = 发信方（你去跟它说话的那个），B = 目标。`permissionMode: "auto"` 免审批卡住。
4. 给 A 发探针：`curl -s -b /tmp/e2e-jar.txt -X POST -H 'Content-Type: application/json'
   -d @probe.json http://localhost:2224/api/sessions/$A/messages`（body `{"content": "<文本>"}`；
   探针文本含中文时用 `python3 -c "json.dumps({'content': open(f).read()}, ensure_ascii=False)"` 生成 body，别手拼转义）
5. 等 40-60s，查 DB（见断言）。等够时间再查：agent 一轮含多次工具调用，实测 30-45s。

## 探针措辞（2026-09-12 实测：这一点决定成败）

**必须点名工具**。只说「用同一个工具回我」时，收件方 agent 会去用 **CC 原生的
`SendMessage`**（按 agent 名寻址，如 `demo-22`）而不是 mobi 的工具，并按 my envelope
里的会话标题去寻址 → 连试三次全失败（`No agent named '跨会话 ping 测试' is reachable`）。
点名后它一次就对（`ToolSearch select:mcp__mobi-apps__send_message_to_session`）。

发信方探针（发 + 让它自己不等待）：

> 请用 mobi 应用自己提供的 `send_message_to_session` 工具，把下面这句话发给会话 `<B>`：
> 「你好，我是另一个 mobi 会话。收到请回我一句 pong。」
> 发完就结束这一轮，不要等待回复。不要用命令行或读文件，只用 mobi 工具。

回信侧不要替它写工具名——那是**验收点**（「收件方能否自己看出该用哪个工具回」）。
「不要用命令行或读文件」照 [[agent-tool-verify]] 的理由保留。

## DB 断言（`~/.mobi-e2e/mobi.db`）

```bash
sqlite3 -newline ' ' ~/.mobi-e2e/mobi.db "SELECT 'seq='||seq||' life='||COALESCE(lifecycle,'NULL')||' from='||COALESCE(json_extract(content,'\$.meta.crossSession.from'),'-')||' fromSid='||COALESCE(substr(json_extract(content,'\$.meta.fromSessionId'),1,8),'-')||' | '||substr(json_extract(content,'\$.content'),1,80) FROM messages WHERE session_id='<目标 sid>' AND json_extract(content,'\$.role')='user' ORDER BY seq;"
```

一条消息到达目标会话后，应当**恰好一行**，且：

| 断言 | 期望 |
|---|---|
| `lifecycle` | `NULL`（非排队轨道——`sentFrom: 'cli'` 的现成判据） |
| `meta.sentFrom` | `'cli'` |
| `meta.crossSession.from` | 发信方**会话标题**（agent 自己 change_title 的名字；未命名时为空串） |
| `meta.fromSessionId` | 发信方 session id |
| `meta.turnOrigin` | 缺省（不写；带 `peer` 的是 hook 观测写的另一行 = 重复落库 bug） |
| `content` | 归一后的 blocks **数组**，且**不含** `<cross-session-message` 字样 |

富内容时另加两条：`json_array_length(...content)` 等于 agent 给的 block 数、
`json_each` 串出的 types 顺序与入参一致（**原形保留**，Hub 不重排不改写）。

**「恰好一行」是回归断言**：曾经一封信封会落两行（投递路径一行 + hook 观测路径一行，
相隔 15ms），行数变了先查这个。

工具回执在**发信方**会话里：查 `tool_use`/`tool_result`（同 [[agent-tool-verify]] 的
`content.data.message.content[]` 下钻），文案是 `Sent to session: …` /
`Sent to 1 of 2 sessions.` / `None of the N targets received the message.`

## 看收件方 CC 到底收到什么（D28 换算表）

比 DB 更权威的是**目标会话的 transcript**——`SELECT json_extract(metadata,'$.nativeSessionId')
FROM sessions WHERE id='<B>'` 拿 native id，读
`~/.claude/projects/-Users-manerfan-workspace-demo/<nativeId>.jsonl` 里第一条 user entry
（`message.content` 数组），应看到：

```
text:  <cross-session-message from-name="…" from-session-id="…" message-id="…">
text:  [引用 user]：<excerpt 压平换行>
image: {"type":"image","source":{"type":"base64","media_type":"image/png",…}}   ← 真读出了磁盘上的文件
text:  @/abs/path/doc.pdf  </cross-session-message>                            ← document 只给路径
```

信封**跨元素**完整（首尾各一个 text block），且落库那一份**不含**信封。

## 富内容素材（2026-09-12 实测可用）

```bash
mkdir -p ~/workspace/demo/e2e-agents
cp <repo>/packages/web/public/brand/icon.png ~/workspace/demo/e2e-agents/e2e-pic.png   # 180×180 PNG
sips -s format pdf ~/workspace/demo/e2e-agents/e2e-pic.png --out ~/workspace/demo/e2e-agents/e2e-doc.pdf
```

⚠️ 别拿 `~/workspace/demo` 根下那个 100MB 的 PDF 当素材（read-file 会真去流它）。
`sips` 生成的 PDF **没有 ToUnicode**，收件方 agent 读正文会拿到乱码——不影响投递验收，
但别据此判断链路。素材放在**会话 cwd 之内**（`/Users/manerfan/workspace/demo/e2e-agents/…`），
read-file 的边界是 `cwd ∪ home−黑名单`，`/tmp` 下的文件渲染不出来。

探针把 block 数组**原样贴给它照抄**（agent 不必自己构思 quote 的字段）。

## 跨机器（E2E 只有一台机器，得自己造）

把**目标会话**的机器身份改写成另一台，再让 hub 的 session 缓存重读：

```bash
sqlite3 ~/.mobi-e2e/mobi.db "UPDATE sessions SET metadata=json_set(metadata,'\$.machineId','e2e-other-machine') WHERE id='<B>';"
curl -s -b /tmp/e2e-jar.txt http://localhost:2224/api/sessions >/dev/null   # → sessionCache 每次调用都从 DB 重读
```

`GET /api/sessions` 走 `getSessionsByNamespace`，会把 DB 的 metadata 刷进缓存（**不用重启 hub**）。
改完必须**还原**（见下），否则后续渲染断言会全错。

同一探针里让它**连做两次**（一次纯文本、一次带本机图片）最省一轮：
期望纯文本 `Sent to session: …`、带图 `is_error: true` +
`The message carries a local file ("…"), and that session is on a different machine.`（整条失败，目标会话**不落行**）。

⚠️ **`machineId` 是渲染层构造 read-file URL 的输入**（`ImageView` 用 `env.machineId`）——
改完之后 Web 上的图片会变成兜底图（naturalWidth 240 的 data:svg），**这不是 bug**。还原：

```bash
sqlite3 ~/.mobi-e2e/mobi.db "UPDATE sessions SET metadata=json_set(metadata,'\$.machineId','<真机器 id>') WHERE id='<B>';"
curl -s -b /tmp/e2e-jar.txt http://localhost:2224/api/sessions >/dev/null
```

## 网络图（值自足 → 跨机器也能投）

`source.value` 是 `https?://` 时判为「不依赖本机文件」，跨机器照投，Web 直接用它渲染。
要一个**确定可达**的 URL：本地静态服

```bash
cd ~/workspace/demo/e2e-agents && exec python3 -m http.server 8899 --bind 127.0.0.1   # run_in_background
```

⚠️ **Bash 沙箱会拦非白名单端口的出站请求**（`curl http://127.0.0.1:8899` 返回 000，加
`dangerouslyDisableSandbox` 才通）——**浏览器不受影响**，别据此以为服务没起来；
用 `lsof -nP -iTCP:8899 -sTCP:LISTEN` 确认真活了，用完 `kill -TERM <pid>`（按 PID，禁全局 pkill）。

## 死目标 / 扇出素材（免造）

`kill -TERM <该会话 CLI 的 PID>`（`ps -eo pid,lstart,command | grep "index.ts claude"`
按启动时间认最新两个）→ Hub 行保留、`active=false`。用它的 id 做 targets 之一即可验
「部分成功 + 逐条人话」（实测文案：`NOT delivered — Session "…" is not running any more…`）。

## Web 呈现

两边会话页各查一次气泡 header：

```js
[...document.querySelectorAll('.ant-bubble')].map(b => ({
  header: b.querySelector('.ant-bubble-header')?.innerText,
  imgs: [...b.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src')?.slice(0,90), natural: i.naturalWidth })),
  quote: [...b.querySelectorAll('[data-testid^="user-quote-"]')].map(q => q.innerText),
  links: [...b.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(h => h?.startsWith('mobi://')),
}))
```

期望：

- `From <发信方标题>` 胶囊（与 CC 原生 peer 消息同一个 `CrossSessionTag`），**标签不可点**（组件无链接，与原生路径同形）
- 本机图片：`src` = `/api/machines/<真机器 id>/read-file?cwd=…&path=…`（无 etag v 参数），`natural > 0` = 真加载了
- 网络图：`src` **就是那个 URL**（不构造 read-file URL）
- 引用：`[data-testid^="user-quote-"]` 命中，innerText 是 excerpt
- 附件：`mobi://file/open?path=…&name=…` 链接；点它会在右侧 inspector 开出该文件的 tab
  （验「点开文件」看 `take_snapshot` 里有没有 `tab "<文件名>"`——`evaluate` 里查 inspector 选择器会误判成没开）

**缩略图点开看原图**：`.ant-bubble img` 派发 click → 500ms 后查 `.ant-image-preview` 存在
且里面 `img` 的 `naturalWidth > 0`（合成事件够用，不必走 CDP click）。

查不到时先确认该会话的消息真的落了库，再确认 `getCrossSessionFrom` 读的 `meta.crossSession.from` 非空
（空串会降级成「来自 其他会话」）。
