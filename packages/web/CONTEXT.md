# Web 词汇表

浏览器前端上下文（会话远程交互界面）。首建于工具卡片改版（Tool Chips）特性。

## Language

### 聊天流 · 工具呈现

**工具行（Tool Row）**：
agent 单次工具调用在聊天流中的单行呈现——动词 + 摘要 + 尾随信息。行本体的点击语义是「展开/收起详情」。
_Avoid_: 工具卡片标题、tool chip 行

**文件 Chip（File Chip）**：
工具行中承载文件路径的 mono 字体元素。Chip 的点击语义是「打开文件」（mobi://file/open），与行本体的展开详情物理分离。带 hover 描边的 chip 才可点击；非文件路径的 command/pattern 用同款形态纯展示，不暗示可点。
_Avoid_: 路径链接、badge

**跳转类工具（File-bearing Tools）**：
输入中天然携带文件路径的工具（Read / Edit / MultiEdit / Write）——文件 Chip 可点击的资格集合。样式语言全量统一，点击资格按工具判定。
_Avoid_: 白名单

**diff 统计（Diff Stat）**：
编辑类工具行尾随的增删行数（+12 −3），由输入内容静态推算，非服务端权威值。
_Avoid_: 变更数、diff count

**权限面板（Permission Panel）**：
工具待审批时的请求呈现区。其中的文件路径同样以文件 Chip 呈现——审批前可先看文件再决策。
