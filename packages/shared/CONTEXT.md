# Shared

跨包协议定义包。承载消息词汇（ADR 0002）与内部操作协议（mobi URI）的权威词汇。

## Language

### 消息词汇

见 [ADR 0002](../../docs/adr/0002-custom-message-system.md)。role 是来源维度（user/agent/custom），content 由统一 block 词汇表组合表达。

**轮次（Turn）**：
一段以用户消息开始、以 agent result 结束的对话单位（compact 边界等结构性消息同样开启新轮次）。轮次是「这一轮做了什么」的归属单位；跨轮完成的后台任务，其产出按事实发生区间归属，不按发起位置。
_Avoid_: 按消息序号自创分档（轮次边界的定义唯一）、把轮次持久化为消息字段（它由边界推导）

**自定义事件（Custom Event）**：
custom 消息承载结构化应用事件的统一 wire 形态——`name` 路由 + `value` 结构化载荷，对齐 AG-UI 1.0 CUSTOM 扩展点的语义（name 路由、value 载荷、消费方解释在协议外）。与 block 词汇表的分界：文本与媒体用 block 组合表达，结构化事实走自定义事件——两者是 custom 消息内部的二分，不是竞争方案。新事件先查注册表，未注册的组合在结构上不存在。
_Avoid_: 为单个特性另起消息形态（schema 必须收敛于此）、把它登记成 block 词汇表新条目（事件是应用事实，不是渲染词汇）

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

### 路径边界

文件读写的安全边界（[ADR 0004](../../docs/adr/0004-read-boundary-cwd-union-home.md)）。协议只承诺透传路径，实际可达范围由边界裁决。

**读边界（Read Boundary）**：
允许读取的路径集合 = cwd 子树 ∪ (home 子树 − 黑名单)。`~` 前缀展开为 home 后判定。两读取通道（session / host）同源共用。
_Avoid_: 白名单——黑名单是例外列举，读边界是允许集定义

**写边界（Write Boundary）**：
允许写入的路径集合 = 严格 cwd 子树。独立于读边界，读放宽不放大写风险。
_Avoid_: 读写边界混称——两者是分离的两条规则

**黑名单（Blacklist）**：
home 直接子级中的敏感目录清单，先于一切允许域判定（cwd 恰为 home 时仍生效）。cwd 内同名目录不受影响。
_Avoid_: 禁止目录（泛称）、白名单（反义）
