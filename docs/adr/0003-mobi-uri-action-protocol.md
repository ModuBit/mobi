# 内部操作协议：mobi URI 动作链接，ref block 退场

## Status

accepted（2026-09-07）。部分取代 ADR 0002 的 ref block 设计。

## 背景

ADR 0002 为自定义消息设计了 `ref` block（`targetType` 受控注册）作为「消息内可跳转实体」。交付次日扩展「内部操作」时发现结构性局限：ref block 是**消息层结构化载体**，只能由 mobi 自己构造，无法被 agent 写进回复 markdown、无法出现在消息之外（通知、剪贴板）；而内部操作的诉求（跳转页面、打开文件面板、自动发送消息）天然需要一种**可嵌入任何文本、多方可生成**的编码。

参照钉钉/飞书的「动作即链接」模式（`dingtalk://`、飞书 applink——发 markdown 消息里带链接，点击即执行，无需互动卡片）。

## 决定

**mobi URI 是内部动作的唯一权威编码**：`mobi://<资源域>/<动作>?<params>`（如 `mobi://session/open?id=x`）。host = 资源域（名词，非 UI 动词——动作描述意图「打开会话 X」而非后果「页面切换」），path = 动作，参数一律 query。注册键 `domain/action`，注册表 = 参数约束 + 风险等级 + 执行器的唯一权威映射，未注册组合结构上不存在。

**承载形态是 Markdown 链接** `[文案](mobi://…)`，渲染层统一拦截 `mobi://` scheme 分发到注册表——天然覆盖所有消息来源（mobi 注入、agent 输出、未来用户输入），因为它们都走同一 Markdown 渲染路径。

**ref block 从 block 词汇表删除**（ADR 0002 词汇收缩为 text/image/document/quote）。既然动作注册表是唯一权威，block 层再留一种可跳转表达就是第二权威、两份编码必然漂移。存量 ref 数据一次性迁移为动作链接文本。

**安全模型分级且分级是注册时声明**：导航/打开类点击即执行；发送类内容可见点击即确认；高危动作（删除/配置）永不注册。降级：未注册/不可达链接渲染为正常链接、点击 toast，不做静态置灰。链接文案写入时冻结（消息即快照），不随目标状态涨落。

## Considered Options

- **ref block 保留为存储形态（双编码等价）**：结构化校验更硬，但两份编码 + 一份转换层长期维护，且 ref 无法被 agent/文本环境生成——「多方生成」是本次的核心诉求
- **`mobi://navigate/xxx` 作 host**：navigate 是 UI 效果动词，`navigate/file`、`navigate/send` 语义拧；业界（飞书 applink、VS Code、Zoom）通行 host=资源域
- **agent 来源一律二次确认弹层**：毁掉「快捷指令按钮」体验；先例（user 通道拒 ref、quote excerpt 上限）都是「结构上不可表达危险形态」而非运行时拦截
- **渲染时实时校验目标置灰**：链接密度上来后是查询风暴；成本推迟到点击时刻足够

## Consequences

- ADR 0002 的 `ref.targetType` 注册机制由动作注册表继承（键从 `targetType` 变 `domain/action`，多一级动作）；fork 溯源消息从 `text + ref(session)` 组合改为含动作链接的 text block
- Markdown 渲染层新增 scheme 拦截（现所有链接 `target="_blank"`）——这是协议的执行入口基建
- 扩展骨架就位：`file/open`（含确保侧边面板打开）、`message/send`、PWA 跨端解析（B）、消息卡片（C，action 引用同一套 URI）均只是注册新键/新消费方，协议本体不动
- agent 感知（系统提示注入协议说明，让模型主动生成动作链接）为后续独立迭代
- 第一期范围：仅注册 `session/open`，迁移 fork 溯源场景；spec 见 `.scratch/mobi-uri-protocol/SPEC.md`
