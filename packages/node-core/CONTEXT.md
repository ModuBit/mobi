# node-core（节点侧共享库）

节点侧共享库的领域语言。本包是无领域词汇的基础设施层——git 簇 / logger / configuration / persistence / host 族 handlers（hostFiles / hostDirectory / webToolsConfig 等） / api 四件等不依赖会话与 daemon 的本地节点模块，供 daemon 与 session 双侧共用；词汇随消费方（[daemon](../daemon/CONTEXT.md)、[session](../session/CONTEXT.md)）走，此处不重复定义。

## Language

**co-located 部署**:
daemon 与会话子进程同机同 MOBI_HOME 的唯一部署形态（单机假设）。token 由 daemon 首启自动同步到 `settings.cli.json`，开箱即连。
_Avoid_: 远程部署（多机拓扑旧形态，已废）

**宿主通道拓扑**:
宿主通道地址知识的单一归属（`hostChannel.ts`，架构评审候选⑤）：端口派生规则（主端口 + 10000，2222→12222）、`MOBI_HOST_PORT` env 覆盖（非法回退派生 fail-open、越界 wrap 回非特权段）与 loopback URL 构造。daemon 权威派生、同机 CLI 开箱默认、executor spawn 注入三方只消费这里的结论；通道决策本身（独立 loopback listener、不经 frp 暴露）见 ADR 0009 与 daemon CONTEXT。
_Avoid_: 在任何包再写一份 +10000/12222/2222 派生逻辑或「注释对齐」契约（此前四处编码点即此类泄漏）
