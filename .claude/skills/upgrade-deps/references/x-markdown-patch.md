# @ant-design/x-markdown 块级 memo patch 维护

## 背景

x-markdown 2.9.0（npm 发版）流式渲染时每帧全量重建 React 元素树，实测 6x CPU 节流下 >100ms 长任务 ~42 个/千字，页面动画周期性卡顿。ant x main 分支已实现 `streaming.incremental`（块级 memo，commit `313d3016` 起，见 mobi `docs/pending.md` #88），**截至记录时未发版**。

patch 方式：用 antx 源码 father 构建产物覆盖 bun store 中的 npm 包。**机器本地，`bun install` 会还原**，还原后需按本文重做。

实测收益（6x 节流、3000 字长文流式）：>100ms 长任务 304 个 → 4~7 个（~30 倍），长任务 p50 118ms → 54ms。

## 涉及的两处改动

1. **bun store 覆盖**（机器本地）：
   `node_modules/.bun/@ant-design+x-markdown@<版本>+<hash>/node_modules/@ant-design/x-markdown/`
   下的 `es/` `lib/` `plugins/` `themes/` `dist/` 被替换为 antx 源码构建产物。
   store 路径的 `<hash>` 随 lockfile 变化，用 `find node_modules/.bun -maxdepth 1 -name '@ant-design+x-markdown*'` 定位。

2. **`packages/web/src/components/ui/Markdown.tsx`**：
   `MARKDOWN_STREAMING_CONFIG` 中的 `incremental: true`（带注释）。

## 升级 x-markdown 时的检查步骤

1. `npm view @ant-design/x-markdown version` 确认新版版本号
2. **检查新版是否已含 incremental**（升级前必做）：
   ```bash
   cd /tmp && npm pack @ant-design/x-markdown@<新版> && tar xzf ant-design-x-markdown-<新版>.tgz
   grep -c "minSectionChars" package/es/XMarkdown/hooks/useStreaming.js
   grep -c "incremental" package/es/XMarkdown/interface.d.ts
   ```
   两处命中 = 已发版。
3. **已发版 → 撤 patch**：
   - 正常升级 package.json 版本
   - 删掉 `Markdown.tsx` 的 `incremental: true` 行及其注释
   - typecheck（确认 `StreamingOption` 类型不再报错）+ E2E 流式回归（长文 prompt，观察动画不卡）
4. **未发版 → 重做 patch**：见下节

## 重做 patch 的完整命令

前置：antx 源码仓库在 `~/workspace/github/antx/x`（没有则 clone ant-design/x），构建用 utoo（`npm i -g utoo`）。

```bash
cd ~/workspace/github/antx/x
git pull                      # 拿最新源码（含 incremental 实现）
ut install
ut run compile --workspace packages/x-markdown

# 覆盖 bun store（路径按当前 lockfile 定位）
STORE=$(find node_modules/.bun -maxdepth 1 -name '@ant-design+x-markdown*' | head -1)/node_modules/@ant-design/x-markdown
SRC=~/workspace/github/antx/x/packages/x-markdown
rm -rf "$STORE/es" "$STORE/lib" "$STORE/plugins" "$STORE/themes" "$STORE/dist"
cp -R "$SRC/es" "$SRC/lib" "$SRC/plugins" "$SRC/themes" "$SRC/dist" "$STORE/"

# 验证产物含 incremental（grep 需 -a，产物含中文注释会被当 binary）
grep -ac "minSectionChars" "$STORE/es/XMarkdown/hooks/useStreaming.js"
```

然后 `bun run build`（packages/web），确认 `dist/assets/SessionDetailPage-*.js` 含 `minSectionChars`。

注意：
- antx 的 `ut run compile` 依赖 `src/version/version.ts` 生成（precompile 步骤自动做）；若 esbuild 单独打包报 `Could not resolve "./version"`，补 `echo 'export default "2.9.0-patch";' > src/version/version.ts`
- 覆盖 dist 后必须重建 web（`bun run build`），否则产物不带 patch
- antx 源码 HEAD 除 incremental 外还带其他未发版改动（streaming preset、typewriter 等），flag 关闭时与 2.9.0 行为等价，但撤 patch 前不要依赖它们

## 已知非回归项

marked/CommonMark 对 CJK 标点的固有限制：闭合 `**` 前是 `）`、后接汉字时不渲染强调（如 `**能力注入（capability-based）**的`）。原版与 patch 行为一致，勿误判为 patch 回归。
