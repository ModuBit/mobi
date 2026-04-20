# chat/ — 消息标准化管线

本模块实现了 `DecryptedMessage` → `NormalizedMessage` → `ChatBlock[]` 的完整消息标准化管线，
为未来的**虚拟滚动消息视图**设计。

## 当前状态

仅 `modelConfig.ts` 的 `getContextBudgetTokens` 被活跃代码使用（`components/composer/StatusBar.tsx`）。

其余文件（normalize、reducer、reconcile 等）构成了完整的管线框架，但尚未集成到 UI 层。

## 架构

```
DecryptedMessage
  → normalize.ts        解包消息信封，分发到 agent/user 处理器
  → normalizeAgent.ts   标准化 agent 消息（文本、思考、工具调用）
  → normalizeUser.ts    标准化 user 消息（文本、工具结果）
  → reducer.ts          将 NormalizedMessage[] 转换为 ChatBlock[]
  → reducerTimeline.ts  时间线折叠（相邻事件合并）
  → reducerTools.ts     工具权限提取、标题变更检测
  → reducerEvents.ts    事件去重、API 错误折叠
  → reducerCliOutput.ts CLI 输出块处理
  → reconcile.ts        块级去重和排序
  → presentation.ts     显示格式化（时间戳、事件标签）
  → tracer.ts           调试追踪
```

## 注意

**简单聊天视图**（当前使用的 `ChatContainer`）使用的是 `components/chat/messageParser.ts`，
它有自己独立的 `ParsedMessage` 类型系统。两个管线不共享类型。

如果后续实现虚拟滚动视图，应考虑统一为单一管线，避免维护两套消息解析逻辑。
