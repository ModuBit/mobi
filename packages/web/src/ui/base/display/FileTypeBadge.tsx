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
 * 文件类型徽章：路径 → 类型图标（Material Icon Theme 多彩 SVG）或扩展名色块。
 * 判定单源在 fileTypeMeta（resolveFileType），本组件只管展示。
 *
 * 三种形态：
 * - 目录 → 琥珀 Folder glyph（DIRECTORY_TINT 单源，mention 徽章共用）
 * - 常用扩展名 → Material Icon Theme 真实文件图标（fileTypeIcons.generated.ts，
 *   多彩自带配色、明暗主题通用，VS Code 同款观感）——裸 svg 无底色
 * - 其余 → 扩展名文本色块（GitHub 语言色淡底 + 前景；dark 提亮规则在 base.css
 *   .file-type-badge）；dotfile（无扩展名）画通用 FileText glyph
 *
 * 嵌在链接/chip 行内使用，flexShrink 0 防压缩变形。
 */

import { memo } from 'react'
import { Folder, FileText } from 'lucide-react'
import { resolveFileType, FALLBACK_COLOR } from '@/core/lib/fileTypeMeta'
import { EXT_TO_ICON, FILE_TYPE_ICONS } from './fileTypeIcons.generated'

/** 类型色淡底的 alpha 后缀（15%，hex 拼接——表内色值均为 6 位 hex） */
const TINT_ALPHA = '26'

/** 目录琥珀色：FileTypeBadge 目录色块单源（mention 徽章 icon 已改随文本色 currentColor，不再共用） */
export const DIRECTORY_TINT = '#E8A33D'

export const FileTypeBadge = memo(function FileTypeBadge({ path, size = 14, knownFile = false }: { path: string; size?: number; /** 调用方持 fs 事实（如文件树节点 f.type==='file'）时置 true：启发式误判成目录的无扩展名文件（Caddyfile 等）按无扩展名文件呈现，不画目录色块 */ knownFile?: boolean }) {
    const target = resolveFileType(path)
    if (!target) return null

    if (target.kind === 'file') {
        // 常用扩展名：Material 真实文件图标（静态内联 SVG，非用户内容，innerHTML 安全）
        const iconName = EXT_TO_ICON[target.ext]
        const svg = iconName ? FILE_TYPE_ICONS[iconName] : null
        if (svg) {
            return (
                <span
                    aria-hidden="true"
                    className="file-type-icon"
                    style={{ display: 'inline-flex', width: size, height: size, marginRight: 4, verticalAlign: 'middle', flexShrink: 0 }}
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            )
        }
    }

    const tint = target.kind === 'directory' ? DIRECTORY_TINT : target.color
    const box: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 3,
        flexShrink: 0,
        // 右距收进组件：行内消费方（ActionLink / FileChip）都在徽章后紧跟文本，
        // 调用方各自拼空格会引入文本空格宽度不齐 + 复制带空格的问题
        marginRight: 4,
        // middle：盒子垂直中心对齐正文 x-height 中心（负长度值会双重下压——inline-flex
        // 的 baseline 已随内部文字对到正文 baseline，再 -2px 整体偏下，2026-09-26 真机）
        verticalAlign: 'middle',
        background: `${tint}${TINT_ALPHA}`,
    }

    if (target.kind === 'directory') {
        if (knownFile) {
            // 启发式误判被 fs 事实推翻：按裸 dotfile 同款（中性底 + 通用文件 glyph）
            return (
                <span aria-hidden="true" style={{ ...box, background: `${FALLBACK_COLOR}${TINT_ALPHA}` }}>
                    <FileText size={size - 5} color={FALLBACK_COLOR} strokeWidth={2.4} />
                </span>
            )
        }
        return (
            <span aria-hidden="true" style={box}>
                <Folder size={size - 5} color={tint} strokeWidth={2.4} />
            </span>
        )
    }

    if (target.label === null) {
        // 裸 dotfile（.env / .gitignore 等，无扩展名）：中性色 + 通用文件 glyph
        return (
            <span aria-hidden="true" style={box}>
                <FileText size={size - 5} color={target.color} strokeWidth={2.4} />
            </span>
        )
    }

    return (
        <span
            aria-hidden="true"
            className="file-type-badge"
            style={{
                ...box,
                '--badge-fg-base': target.color,
                color: 'var(--file-type-badge-fg)',
                fontSize: target.label!.length > 2 ? size * 0.5 : size * 0.62,
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: '-0.02em',
            } as React.CSSProperties}
        >
            {target.label}
        </span>
    )
})
