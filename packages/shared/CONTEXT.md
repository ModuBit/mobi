# Shared

跨包协议定义包。承载消息词汇（ADR 0002）与内部操作协议（mobi URI）的权威词汇。

## Language

### 消息词汇

见 [ADR 0002](../../docs/adr/0002-custom-message-system.md)。role 是来源维度（user/agent/custom），content 由统一 block 词汇表组合表达。

### 内部操作协议（mobi URI）

以 URI 为权威编码的 mobi 内动作体系——动作可嵌入任何文本，点击即执行。

**动作（Action）**：
点击 mobi URI 触发的一个可执行操作，以 `资源域/动作` 为注册键。动作描述意图（打开会话 X），不描述 UI 后果（页面切换）。
_Avoid_: 指令、命令、deep link

**资源域（Resource Domain）**：
mobi URI host 位置上的名词域（session、file、message……），动作的归属命名空间，也是执行分发的第一级。
_Avoid_: 页面、路由、模块

**动作注册表（Action Registry）**：
`资源域/动作` 到参数约束、风险等级、执行器的唯一权威映射。未注册的组合在结构上不存在——不存在该动作，而非被禁止的动作。
_Avoid_: 白名单、路由表

**风险等级（Risk Level）**：
动作注册时声明、而非运行时判定的安全属性，决定点击行为（直接执行 / 内容可见即确认）；高危操作永不注册。
_Avoid_: 权限、守卫

**动作链接（Action Link）**：
Markdown 链接形态的动作编码：`[文案](mobi://域/动作?参数)`。文案是写入时冻结的消息快照，不随目标状态涨落。
_Avoid_: 引用（ref）——ref block 已删除，动作链接是其唯一后继形态
