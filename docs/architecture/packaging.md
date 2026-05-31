# 单文件打包架构

Mobi 使用 `bun build --compile` 将四个模块打包为一个独立可执行文件，无需 Bun 或 Node.js 运行时。

## 整体结构

```
mobi (单个二进制文件，~93MB)
├── Bun Runtime          ← 嵌入的 JavaScriptCore 运行时
├── CLI 模块             ← 命令路由 + 所有子命令
├── Hub 模块             ← Hono + Socket.IO 服务器
├── Web 静态资产         ← HTML/CSS/JS，嵌入 hub
├── Shared 协议          ← Zod schema，TypeScript 源码直接打包
└── 工具二进制           ← ripgrep/difftastic tar 包，按平台条件嵌入
```

## Bun `--compile` 原理

`bun build --compile` 的工作流程：

1. **静态分析**：从入口文件开始，递归追踪所有 `import`/`require`，构建完整的依赖图
2. **打包**：将所有模块合并为一个 JS bundle（类似 webpack/rollup）
3. **嵌入 Bun 运行时**：将 Bun 的 JavaScriptCore 引擎编译进二进制文件
4. **生成可执行文件**：输出一个包含 Bun 运行时 + 应用代码的自包含二进制

关键机制：

| 机制 | 用途 | 语法 |
|------|------|------|
| `import ... with { type: 'file' }` | 将文件原样嵌入二进制 | Bun 运行时通过 `$bunfs/` 虚拟文件系统访问 |
| `feature('FLAG')` | 编译时条件分支 | 通过 `--feature=FLAG` 设为 `true`，未指定的为 `false` |
| `Bun.file(path)` | 读取嵌入的文件 | 从虚拟文件系统获取文件内容 |

## 构建流水线

```mermaid
graph LR
    A["vite build"] -->|web/dist/| B["generate-embedded-web-assets"]
    B -->|embeddedAssets.generated.ts| C["bun build --compile"]
    D["tools/archives/*.tar.gz"] -->|feature() 条件导入| C
    C --> E["dist-exe/bun-darwin-arm64/mobi"]
```

### 步骤详解

**Step 1: 构建 Web 前端**

```bash
cd packages/web && vite build
```

Vite 将 React 应用编译为静态文件到 `web/dist/`。

**Step 2: 生成嵌入资产清单**

```bash
cd packages/hub && bun run generate:embedded-web-assets
```

扫描 `web/dist/` 中所有文件，生成 `hub/src/web/embeddedAssets.generated.ts`：

```typescript
import asset0 from '../../web/dist/index.html' assert { type: 'file' };
import asset1 from '../../web/dist/assets/index-xxx.js' assert { type: 'file' };
// ...

export const embeddedAssets: EmbeddedWebAsset[] = [
    { path: '/index.html', sourcePath: asset0, mimeType: 'text/html; charset=utf-8' },
    { path: '/assets/index-xxx.js', sourcePath: asset1, mimeType: 'text/javascript; charset=utf-8' },
    // ...
];
```

`assert { type: 'file' }` 告诉 Bun 将文件原样嵌入二进制，运行时通过 `$bunfs/` 虚拟文件系统访问。

**Step 3: 编译二进制**

```bash
bun build --compile \
    --no-compile-autoload-dotenv \
    --feature=MOBI_TARGET_DARWIN_ARM64 \
    --target=bun-darwin-arm64 \
    --outfile=dist-exe/bun-darwin-arm64/mobi \
    src/bootstrap.ts
```

- `--feature=MOBI_TARGET_DARWIN_ARM64`：设置特性标志，使 `embeddedAssets.bun.ts` 中只有 macOS ARM64 的工具 tar 包被导入
- `--target=bun-darwin-arm64`：指定目标平台
- 入口文件 `bootstrap.ts` → `index.ts` → 命令路由

## 入口流

```
mobi [args]
  └─ bootstrap.ts        ← 禁用 devtools，设置 DEV=false
      └─ index.ts        ← 加载 profile
          └─ runCli()    ← 解析参数，ensureRuntimeAssets()
              └─ registry 匹配子命令
                  ├─ (无参数) → claude
                  ├─ hub     → 动态 import hub/src/index
                  ├─ runner  → 后台会话管理
                  └─ ...
```

## 工具嵌入与运行时提取

工具（ripgrep、difftastic）按平台条件嵌入：

```
[构建时] embeddedAssets.bun.ts
    feature('MOBI_TARGET_DARWIN_ARM64') → true
        → import ripgrep-arm64-darwin.tar.gz with { type: 'file' }
        → import difftastic-arm64-darwin.tar.gz with { type: 'file' }
    feature('MOBI_TARGET_LINUX_ARM64') → false
        → 此分支被 tree-shake 排除

[首次运行] ensureRuntimeAssets()
    检测 ~/.mobi/runtime/{version}/.runtime-version
    版本不匹配 → 复制嵌入资产 → 解压 tar → 写入版本标记

[后续运行]
    版本匹配 → 跳过解压 → 直接使用已解压的工具
```

## Hub Web 资产服务

Hub 在两种模式下服务 Web 前端：

**编译模式**（`isBunCompiled() === true`）：
- `loadEmbeddedAssetMap()` 读取 `embeddedAssets.generated.ts` 中的资产清单
- 请求到达时从 `$bunfs/` 虚拟文件系统读取并通过 `Bun.file()` 返回
- SPA fallback 到 `index.html`

**开发模式**：
- 在 `../web/dist/` 目录查找 Vite 构建产物
- 使用 Hono 的 `serveStatic` 从磁盘提供文件

## `#embedded-assets` Import Map

CLI 的 `package.json` 中定义了 import map：

```json
{
    "imports": {
        "#embedded-assets": {
            "bun": "./src/runtime/embeddedAssets.bun.ts",
            "default": "./src/runtime/embeddedAssets.stub.ts"
        }
    }
}
```

- **Bun 运行时**（开发和编译时）：使用 `embeddedAssets.bun.ts`，通过 `feature()` 条件导入工具
- **其他环境**：使用 `embeddedAssets.stub.ts`，抛出错误

运行时代码通过 `import('#embedded-assets')` 引用，Bun bundler 根据 `package.json` 的 `imports` 字段解析。

## 分发

### 直接下载

二进制文件上传到 GitHub Release，用户下载后 `chmod +x` 即可使用。

### npm 分发

```
@mobi/cli (主包，几 KB)
├── bin/mobi.cjs           ← Node.js wrapper，检测平台
└── package.json           ← optionalDependencies 指向平台包

@mobi/cli-darwin-arm64     ← 编译好的二进制 (optional dep)
└── bin/mobi
```

`bin/mobi.cjs` 流程：检测平台 → 拼接包名 → `require.resolve()` → `execFileSync()` 执行

## 已知限制

- **非静态可分析的动态 import 不会被打包**：所有 `import()` 必须是静态字符串
- **Linux 依赖系统 libc**：非完全静态链接，需要 glibc 或 musl
- **react-devtools-core stub**：ink v7 无条件导入此包，编译后的二进制中通过 stub 包提供空导出
- **二进制体积**：~93MB（包含 Bun 运行时 + 应用代码 + Web 资产 + 工具 tar 包）
