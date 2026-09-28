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
 * 文件目标类型识别（单一来源）：从路径推断「文件（含扩展名徽章）还是目录」。
 *
 * 消费方：ActionLink 的 file/open 链接徽章（覆盖 markdown mobi:// 链接与 @mention）、
 * FileChip 工具行 chip。纯函数零依赖，判定与展示分离（徽章组件见 FileTypeBadge）。
 *
 * 判定规则：
 * - basename 不含 `.`（或路径以 `/` 结尾）→ 目录。代价：`Dockerfile` / `Makefile`
 *   这类无扩展名文件名会被判成目录——无 fs 访问能力的纯启发式只能取此权衡，
 *   误标的视觉损失可接受（徽章 glyph 而非正文信息）
 * - 其余为文件：取最后一个 `.` 后的扩展名查表；未命中表的颜色走中性灰、label 用
 *   扩展名大写（截 4 字符）；裸 dotfile（`.env` 等，唯一 `.` 在开头）无扩展名
 *   label 为 null → 展示层画通用文件 glyph
 */

export type FileTargetType =
    | {
          kind: 'file'
          /** 扩展名（小写；空串 = 无扩展名，裸 dotfile 或惯例文件名）——展示层映射类型 icon 用 */
          ext: string
          /** 徽章缩写（如 TS / JSON）；null = 无扩展名，展示通用文件 glyph */
          label: string | null
          color: string
      }
    | { kind: 'directory' }

/** 扩展名 → 徽章配色表。色值固定不随主题（品牌色语义，白字前景需中低明度底色） */
const EXT_BADGES: Record<string, { label: string; color: string }> = {
    ts: { label: 'TS', color: '#3178C6' },
    tsx: { label: 'TSX', color: '#3178C6' },
    js: { label: 'JS', color: '#B08800' },
    jsx: { label: 'JSX', color: '#B08800' },
    mjs: { label: 'JS', color: '#B08800' },
    cjs: { label: 'JS', color: '#B08800' },
    json: { label: '{ }', color: '#B08800' },
    md: { label: 'MD', color: '#4A7CA5' },
    mdx: { label: 'MDX', color: '#4A7CA5' },
    css: { label: 'CSS', color: '#563D7C' },
    scss: { label: 'SCS', color: '#C6538C' },
    less: { label: 'LES', color: '#5A6FBE' },
    html: { label: 'HTM', color: '#E34C26' },
    vue: { label: 'VUE', color: '#3E9B6E' },
    py: { label: 'PY', color: '#3572A5' },
    rs: { label: 'RS', color: '#B7410E' },
    go: { label: 'GO', color: '#0080A8' },
    java: { label: 'JV', color: '#B07219' },
    rb: { label: 'RB', color: '#CC342D' },
    php: { label: 'PHP', color: '#777BB4' },
    c: { label: 'C', color: '#666666' },
    h: { label: 'H', color: '#666666' },
    cpp: { label: 'C++', color: '#D63B6B' },
    swift: { label: 'SW', color: '#E8552F' },
    kt: { label: 'KT', color: '#8B5CF6' },
    sh: { label: 'SH', color: '#3E8914' },
    bash: { label: 'SH', color: '#3E8914' },
    zsh: { label: 'SH', color: '#3E8914' },
    sql: { label: 'SQL', color: '#C65D21' },
    yml: { label: 'YML', color: '#6D8086' },
    yaml: { label: 'YML', color: '#6D8086' },
    toml: { label: 'TOM', color: '#6D8086' },
    lock: { label: 'LCK', color: '#5C6B6F' },
}

/** 未知扩展名的中性徽章色（白字可读）；调用方持 fs 事实覆盖启发式误判时也用它 */
export const FALLBACK_COLOR = '#7A7A7A'

/**
 * 无扩展名的惯例文件名（大小写不敏感）：构建脚本/元数据文件按约定不带扩展名，
 * 「basename 无 `.`」的目录启发式对它们误判——纯路径无 fs 能力，用清单兜底
 * （badge 不再画成目录色块，mention 不再静默降级为不可点）。
 */
const KNOWN_EXTENSIONLESS_FILES = new Set([
    'makefile', 'dockerfile', 'license', 'licence', 'readme', 'changelog',
    'contributing', 'codeowners', 'notice', 'jenkinsfile', 'procfile',
    'rakefile', 'gemfile', 'vagrantfile', 'justfile', 'snakefile',
])

/** basename 提取（容忍尾部 `/`；空路径返回 null） */
function basenameOf(path: string): string | null {
    const trimmed = path.replace(/\/+$/, '')
    if (trimmed === '') return null
    const base = trimmed.split('/').pop() ?? ''
    return base === '' ? null : base
}

/**
 * 路径 → 文件/目录判定 + 文件徽章元数据。
 * 无法判定（空路径）返回 null，展示层据此不画徽章。
 */
export function resolveFileType(path: string): FileTargetType | null {
    const base = basenameOf(path)
    if (!base) return null

    // 目录：basename 无 `.`（`src`、`~`）；无扩展名的惯例文件名（Makefile 等）优先按文件；
    // 隐藏 dotfile（`.env`）有 `.`，落到文件分支
    if (!base.includes('.')) {
        if (KNOWN_EXTENSIONLESS_FILES.has(base.toLowerCase())) {
            return { kind: 'file', ext: '', label: null, color: FALLBACK_COLOR }
        }
        return { kind: 'directory' }
    }

    const lastDot = base.lastIndexOf('.')
    // 裸 dotfile（`.env` / `.gitignore`）：唯一 `.` 在开头 → 无扩展名，通用文件 glyph
    const ext = lastDot > 0 ? base.slice(lastDot + 1).toLowerCase() : ''

    if (ext === '') return { kind: 'file', ext: '', label: null, color: FALLBACK_COLOR }
    const known = EXT_BADGES[ext]
    if (known) return { kind: 'file', ext, label: known.label, color: known.color }
    // 未入表的扩展名：中性色 + 扩展名大写截 4 字符（png→PNG、csv→CSV）
    return { kind: 'file', ext, label: ext.toUpperCase().slice(0, 4), color: FALLBACK_COLOR }
}
