# @ant-design/x-markdown 块级 memo patch 维护

## 背景

x-markdown 2.9.0（npm 发版）流式渲染时每帧全量重建 React 元素树，实测 6x CPU 节流下 >100ms 长任务 ~42 个/千字，页面动画周期性卡顿。ant x main 分支已实现 `streaming.incremental`（块级 memo，commit `313d3016` 起，见 mobi `docs/pending.md` #88），**截至记录时未发版**。

patch 内容 = antx 源码（main）的正式构建产物，覆盖 npm 包的 `es/` `lib/` `plugins/`。**已入库**：`patches/@ant-design%2Fx-markdown@2.9.0.patch` + 根 `package.json` 的 `patchedDependencies`，`bun install` 自动应用，**本机与 CI 同源**（此前是机器本地覆盖 store，`bun install` 会还原，导致 CI typecheck 与本机分叉）。

实测收益（6x 节流、3000 字长文流式）：>100ms 长任务 304 个 → 4~7 个（~30 倍），长任务 p50 118ms → 54ms。

**patch 不含 `dist/` 与 `*.map`**：web 从 `es/`（vite 取 `module` 字段）与 `lib/`（类型解析）入口消费，无人 import `dist/`；纳入 dist 会让 patch 从 ~270KB 涨到 ~7.8MB。

## 涉及的两处改动

1. **`patches/@ant-design%2Fx-markdown@2.9.0.patch` + 根 `package.json` `patchedDependencies`**：bun 在安装时把 patch 应用到 store 里的包。
2. **`packages/web/src/ui/base/markdown/Markdown.tsx`**：`MARKDOWN_STREAMING_CONFIG` 中的 `incremental: true`（带注释）。

## 升级 x-markdown 时的检查步骤

1. `npm view @ant-design/x-markdown version` 确认新版版本号
2. **检查新版是否已含 incremental**（升级前必做）：
   ```bash
   cd /tmp && rm -rf xmd-check && mkdir xmd-check && cd xmd-check
   npm pack @ant-design/x-markdown@<新版> && tar xzf ant-design-x-markdown-<新版>.tgz
   grep -c "minSectionChars" package/es/XMarkdown/hooks/useStreaming.js
   grep -c "incremental" package/es/XMarkdown/interface.d.ts
   ```
   两处命中 = 已发版。
3. **已发版 → 撤 patch**：
   - 正常升级 package.json 版本
   - 删掉 `Markdown.tsx` 的 `incremental: true` 行及其注释
   - 删掉 `patches/@ant-design%2Fx-markdown@<旧版>.patch` 与根 `package.json` 里对应的 `patchedDependencies` 条目，`bun install`
   - typecheck（确认 `StreamingOption` 类型不再报错）+ E2E 流式回归（长文 prompt，观察动画不卡）
4. **未发版 → 重做 patch**：见下节

## 重做 patch 的完整命令

前置：antx 源码仓库在 `~/workspace/github/antx/x`（没有则 clone ant-design/x），构建用 utoo（`npm i -g utoo`）。

```bash
cd ~/workspace/github/antx/x
git pull                      # 拿最新源码（含 incremental 实现）
ut install
ut run compile --workspace packages/x-markdown

# 1) 覆盖 bun store（路径按当前 lockfile 定位）
cd <mobi 仓库根>
STORE=$(find node_modules/.bun -maxdepth 1 -name '@ant-design+x-markdown*' | head -1)/node_modules/@ant-design/x-markdown
SRC=~/workspace/github/antx/x/packages/x-markdown
rm -rf "$STORE/es" "$STORE/lib" "$STORE/plugins" "$STORE/themes" "$STORE/dist"
cp -R "$SRC/es" "$SRC/lib" "$SRC/plugins" "$SRC/themes" "$SRC/dist" "$STORE/"

# 验证产物含 incremental（grep 需 -a，产物含中文注释会被当 binary）
grep -ac "minSectionChars" "$STORE/es/XMarkdown/hooks/useStreaming.js"

# 2) 用「npm 官方 tarball」与「已覆盖的 store」对生成 patch（勿用 bun patch --commit：
#    它要求 node_modules/<pkg> 是实体目录，bun 的 symlink 布局下报 ENOENT）
cd /tmp && rm -rf xmd-diff && mkdir -p xmd-diff/old xmd-diff/new
cd xmd-diff
(cd <解包好的 npm 官方包目录> && tar cf - --exclude=dist --exclude='*.map' .) | (cd old && tar xf -)
(cd "$STORE" && tar cf - --exclude=dist --exclude='*.map' .) | (cd new && tar xf -)
git diff --no-index --full-index old new > raw.diff
sed -e 's|^diff --git a/old/|diff --git a/|' -e 's| b/new/| b/|' \
    -e 's|^--- a/old/|--- a/|' -e 's|^+++ b/new/|+++ b/|' \
    -e 's|^diff --git a/new/|diff --git a/|' -e 's|^--- a/new/|--- a/|' raw.diff > final.diff
cp final.diff <mobi 仓库>/patches/@ant-design%2Fx-markdown@<版本>.patch

# 3) 校验：把 store 挪走让 bun 从 registry 重新解包 + 打 patch，再 grep 命中
mv node_modules/.bun/@ant-design+x-markdown@<版本>+<hash> /tmp/stash-xmd
bun install
grep -ac minSectionChars node_modules/.bun/@ant-design+x-markdown@<版本>+<hash>/node_modules/@ant-design/x-markdown/es/XMarkdown/hooks/useStreaming.js
```

然后 `bun run build`（packages/web），确认 `dist/assets/SessionDetailPage-*.js` 含 `minSectionChars`。

注意：
- antx 的 `ut run compile` 依赖 `src/version/version.ts` 生成（precompile 步骤自动做）；若 esbuild 单独打包报 `Could not resolve "./version"`，补 `echo 'export default "<版本>-patch";' > src/version/version.ts`
- patch 是整包级别的分叉（~2500 行、56 个文件段），升级 x-markdown 版本时**必须**按上面第 2 步重新判断，patch 文件名与 `patchedDependencies` 的键都要跟着版本号走（版本不匹配时 bun 不会应用，也不会报错）
