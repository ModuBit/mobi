# Hub（会话同步中心）

hub 侧的领域语言：会话实体的持久化与多端同步。

## Language

### 会话实体

**会话行**:
hub 中一个 mobi 会话的持久化实体。一个会话行的生命周期内可以跨多个 native session（如 /clear 换链、fork 激活换链），归属关系靠消息行的 metadata 维系。
_Avoid_: session（与 native session 口语混用）

**native session**:
Claude Code 侧的会话链（一个 transcript 文件）。会话行经 metadata.nativeSessionId 绑定当前链；/clear 前的旧链仍在盘上但不等于会话行的当前链。
_Avoid_: 原生会话

**消息行**:
归属唯一会话行；metadata.nativeId 是其在 native transcript 上的锚、metadata.nativeSessionId 记录所在链。去重键是会话行 + localId，范围限单会话行。
_Avoid_: message（与 native transcript entry 混用）

### 分叉

**分叉会话**:
从 parent 会话某条 agent 回复（result）分叉出的独立会话行：建行时复制锚点（含）之前的消息行，激活后拥有自己的 native session，与 parent 互相独立。
_Avoid_: fork 会话（口语可，正式文档用「分叉会话」）

**parent 会话**:
分叉来源会话。分叉激活后 parent 的任何变化（继续对话、rewind）不影响分叉会话已锁定的历史。
_Avoid_: 源会话

**待激活态**:
分叉会话已建行（含复制消息行与预生成 native id）但 CC transcript 尚未物化；用户发出首条消息时激活。放弃 = 删除该会话行。
_Avoid_: 空会话、pending fork（内部代号可用）
