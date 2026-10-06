# node-core（节点侧共享库）

节点侧共享库的领域语言。本包是无领域词汇的基础设施层——git 簇 / logger / configuration / persistence / host 族 handlers（hostFiles / hostDirectory / webToolsConfig 等） / api 四件等不依赖会话与 daemon 的本地节点模块，供 daemon 与 session 双侧共用；词汇随消费方（[daemon](../daemon/CONTEXT.md)、[session](../session/CONTEXT.md)）走，此处不重复定义。

## Language

**co-located 部署**:
daemon 与会话子进程同机同 MOBI_HOME 的唯一部署形态（单机假设）。token 由 daemon 首启自动同步到 `settings.cli.json`，开箱即连。
_Avoid_: 远程部署（多机拓扑旧形态，已废）
