# @ant-design/x CodeHighlighter patch 维护

## 背景

antdx CodeHighlighter 的 `getFullPrismHighlighter` 内部 `import('react-syntax-highlighter')`
（访问 `module.Prism`）使整包全量 Prism（~609KB：全部语言定义 + 各变体）保持可达，
rolldown 把它与静态依赖（PrismLight）合并进同一个关键路径 chunk。perf 基线
（`perf/基线.md` 爬山 #2）实测为 ready 路径最大热点。

patch 内容：`getFullPrismHighlighter` 直接返回 light 实例（PrismLight），
移除动态 import 分支 → 全量包被摇树消失。配套：web 侧 `prismLightMode={true}` +
`codeHighlighterLanguages.ts` 预注册 33 语言子集。

实测收益（2026-09-28 配对测，cpu4×10）：打开会话 p75 1867→1488ms（**-20.3%**），
lan 档 -9.7%，sessions 列表页顺带 1032→805ms。

## patch 方式

走 **bun `patchedDependencies`**（区别于 x-markdown 的手工 store 覆盖——这套是仓库级、
`bun install` 自动重放）：

- `patches/@ant-design%2Fx@2.9.0.patch`
- 根 `package.json` 的 `patchedDependencies`

## 升级 @ant-design/x 时

1. patch 按 `@ant-design/x@2.9.0` 精确版本锁定——升版本后 bun 会报 patch 不匹配
2. 先看新版 antdx 是否已移除 full-prism 分支或提供语言注册的 light 模式（可撤 patch）
3. 未变 → 重做 patch：`bun patch @ant-design/x` → 对新版本重新应用同样改动
   （`getFullPrismHighlighter` 返回 `SyntaxHighlighter`）→ `bun patch --commit node_modules/@ant-design/x`
4. 验证：`bun run build:web` 后确认 dist 无 ~600KB 的 esm-*.js chunk；
   跑 `tests/components/AutoDetectCodeBlock.test.tsx`（抓「注册到错误实例」的静默失色）
