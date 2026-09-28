/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 生成文件类型图标模块（fileTypeIcons.generated.ts）。
 *
 * 图标来源：Material Icon Theme（material-extensions/vscode-material-icon-theme，MIT）。
 * 流程：拉取主题映射 JSON（dist/material-icons.json 的 fileExtensions）→ 按
 * COMMON_EXTS 白名单过滤 → 拉取涉及的 icons/*.svg 清洗内联。ext→icon 不手填，
 * 直接取主题映射（对齐上游，升级零维护）。
 *
 * 白名单控制体积：主题全表 1377 扩展名/369 图标（~150KB+），常用集合 ~160 个
 * 扩展名（映射到 ~80 图标，~35KB）。要补扩展名时往白名单加一行重跑即可。
 *
 * 运行：bun run gen:file-type-icons（packages/web 目录下）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Material Icon Theme 版本（npm material-icon-theme） */
const THEME_VERSION = '5.38.1'

/** 常用扩展名白名单：日常开发 + 办公/媒体场景（小写）。分组无语义，便于增删 */
const COMMON_EXTS = new Set([
    // 语言/脚本
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'rb', 'php', 'java', 'kt', 'kts', 'swift', 'rs', 'go', 'dart',
    'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'fs', 'scala', 'groovy',
    'lua', 'pl', 'r', 'jl', 'zig', 'nim', 'ex', 'exs', 'erl', 'hs', 'clj',
    'cljs', 'scala', 'sol', 'asm', 's', 'v',
    // web/模板
    'vue', 'svelte', 'astro', 'html', 'htm', 'ejs', 'hbs', 'pug', 'twig', 'liquid',
    // 样式
    'css', 'scss', 'sass', 'less', 'styl', 'pcss',
    // 数据/配置
    'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
    'properties', 'xml', 'csv', 'tsv', 'plist', 'gradle', 'cmake', 'nix',
    'proto', 'graphql', 'gql', 'tf',
    // shell
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
    // 文档
    'md', 'mdx', 'txt', 'log', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'pdf', 'tex', 'bib',
    // 图片
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'avif', 'heic', 'tif', 'tiff',
    // 音视频
    'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac',
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv',
    // 字体
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    // 3D/设计
    'blend', 'obj', 'stl', 'fbx', 'glb', 'gltf', 'psd', 'ai', 'sketch', 'fig', 'xcf',
    // 归档/可执行
    'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'class',
    'exe', 'dll', 'so', 'dylib', 'bin', 'dmg', 'iso', 'deb', 'rpm', 'apk',
    // 证书/密钥
    'pem', 'key', 'crt', 'cer', 'pub',
    // 数据库
    'sql', 'db', 'sqlite', 'db3',
    // 其他
    'lock', 'sum',
])

/** 清洗 SVG：去掉无关属性（xmlns/固定尺寸/编辑器元数据），保留 viewBox 与内容。
 *  内联进 HTML 时 xmlns 可省；尺寸由 CSS .file-type-icon svg 控制 */
function cleanSvg(svg) {
    return svg
        .replace(/\sxml:\w+="[^"]*"/g, '')
        .replace(/\swidth="\d+"/g, '')
        .replace(/\sheight="\d+"/g, '')
        .replace(/\sxmlns="[^"]*"/g, '')
        .trim()
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '../src/components/ui/fileTypeIcons.generated.ts')

// 1. 拉主题映射 JSON，白名单过滤出 ext→icon
const mapUrl = `https://unpkg.com/material-icon-theme@${THEME_VERSION}/dist/material-icons.json`
const mapRes = await fetch(mapUrl)
if (!mapRes.ok) {
    console.error(`✗ 主题映射拉取失败：HTTP ${mapRes.status}（${mapUrl}）`)
    process.exit(1)
}
const theme = await mapRes.json()
const themeFe = theme.fileExtensions ?? {}

const extToIcon = {}
const iconNames = new Set()
for (const ext of COMMON_EXTS) {
    const v = themeFe[ext]
    const name = typeof v === 'string' ? v : v?.icon
    if (name) {
        extToIcon[ext] = name
        iconNames.add(name)
    }
}
const missing = [...COMMON_EXTS].filter((ext) => !extToIcon[ext])
if (missing.length > 0) {
    console.warn(`⚠ 主题无映射的白名单扩展名（跳过）：${missing.join(' ')}`)
}

// 2. 拉涉及的 SVG
const icons = {}
for (const name of [...iconNames].sort()) {
    const url = `https://unpkg.com/material-icon-theme@${THEME_VERSION}/icons/${name}.svg`
    const res = await fetch(url)
    if (!res.ok) {
        console.error(`✗ ${name}: HTTP ${res.status}（${url}）`)
        process.exit(1)
    }
    icons[name] = cleanSvg(await res.text())
}

const totalBytes = Object.values(icons).reduce((n, s) => n + s.length, 0)
console.log(`✓ ${Object.keys(extToIcon).length} 扩展名 → ${iconNames.size} 图标（SVG 共 ${(totalBytes / 1024).toFixed(1)}KB）`)

const header = `/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 文件类型图标（生成文件，勿手改）——由 scripts/generate-file-type-icons.mjs 生成。
 *
 * 图标来源：Material Icon Theme v${THEME_VERSION}
 * （material-extensions/vscode-material-icon-theme，MIT License，
 * https://github.com/material-extensions/vscode-material-icon-theme）
 * ext→icon 取自主题 fileExtensions 映射（白名单过滤，见脚本 COMMON_EXTS）；
 * SVG 已内联（去 xmlns/固定尺寸，尺寸由 .file-type-icon svg CSS 控制）。
 * 补扩展名：脚本白名单加一项，bun run gen:file-type-icons 重跑。
 */

/** 主题图标名 → 内联 SVG（多彩自带配色，明暗主题通用） */
export const FILE_TYPE_ICONS: Record<string, string> = ${JSON.stringify(icons, null, 4)}

/** 扩展名 → 主题图标名（未收录扩展名由展示层回退文本色块） */
export const EXT_TO_ICON: Record<string, string> = ${JSON.stringify(extToIcon, null, 4)}
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, header)
console.log(`\n→ 已写入 ${outPath}`)
