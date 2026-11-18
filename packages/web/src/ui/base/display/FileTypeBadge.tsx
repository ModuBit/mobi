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
 * - 目录 → 琥珀 Folder glyph（行内 @ 目录引用则随正文色）
 * - 常用扩展名 → Material Icon Theme 真实文件图标（fileTypeIcons.generated.ts，
 *   多彩自带配色、明暗主题通用，VS Code 同款观感）——裸 svg 无底色
 * - 其余 → 扩展名文本色块（GitHub 语言色淡底 + 前景；dark 提亮规则在 base.css
 *   .file-type-badge）；dotfile（无扩展名）画通用 FileText glyph
 *
 * 嵌在链接/chip 行内使用，flexShrink 0 防压缩变形。
 */

import { memo, type CSSProperties } from 'react'
import { resolveFileType, FALLBACK_COLOR, type FileTargetType } from '@/core/lib/fileTypeMeta'
import { EXT_TO_ICON, FILE_TYPE_ICONS } from './fileTypeIcons.generated'

/** 类型色淡底的 alpha 后缀（15%，hex 拼接——表内色值均为 6 位 hex） */
const TINT_ALPHA = '26'
export const DIRECTORY_TINT = '#E8A33D'

/*! Folder / FileText 路径来自 Lucide；React 与编辑器 DOM 共用。
 * ISC License — Copyright (c) 2026 Lucide Icons and Contributors
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const FOLDER_PATH = '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'
const FILE_PATH = '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8"/>'

function outlineSvg(glyph: 'folder' | 'file', size: number, stroke: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyph === 'folder' ? FOLDER_PATH : FILE_PATH}</svg>`
}

/** 行内引用的目录 glyph 随正文色；独立文件类型徽章的目录色块仍为琥珀色。 */
export const MENTION_FOLDER_SVG = outlineSvg('folder', 13, 'currentColor')

interface BadgePresentation {
    className?: string
    style: CSSProperties
    tint?: string
    svg?: string
    label?: string
}

function badgePresentation(target: FileTargetType, size: number, knownFile: boolean): BadgePresentation {
    // 用同一份外观数据生成 React 或编辑器 DOM，避免样式/图标分叉。
    const sizeStyle = {
        display: 'inline-flex',
        width: `${size}px`,
        height: `${size}px`,
        marginRight: '4px',
        verticalAlign: 'middle',
        flexShrink: 0,
    }
    if (target.kind === 'file' && Object.hasOwn(EXT_TO_ICON, target.ext)) {
        const svg = FILE_TYPE_ICONS[EXT_TO_ICON[target.ext]]
        if (svg) return { className: 'file-type-icon', style: sizeStyle, svg }
    }

    const tint = target.kind === 'file' ? target.color : knownFile ? FALLBACK_COLOR : DIRECTORY_TINT
    const box = {
        ...sizeStyle,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-square)',
        background: `${tint}${TINT_ALPHA}`,
    }
    if (target.kind === 'directory' || target.label === null) {
        const glyph = target.kind === 'directory' && !knownFile ? 'folder' : 'file'
        return { style: box, svg: outlineSvg(glyph, size - 5, tint) }
    }
    return {
        className: 'file-type-badge',
        tint,
        label: target.label,
        style: {
            ...box,
            color: 'var(--file-type-badge-fg)',
            fontSize: `${target.label.length > 2 ? size * 0.5 : size * 0.62}px`,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.02em',
        },
    }
}

/** 编辑器已持有路径类型；标签以文本节点写入，只有本地静态 SVG 进入 innerHTML。 */
export function createFileBadgeElement(doc: Document, target: FileTargetType): HTMLElement {
    const { className, style, tint, svg, label } = badgePresentation(target, 14, true)
    const badge = doc.createElement('span')
    badge.setAttribute('aria-hidden', 'true')
    if (className) badge.className = className
    Object.assign(badge.style, style)
    if (tint) badge.style.setProperty('--badge-fg-base', tint)
    if (svg) badge.innerHTML = svg
    else badge.textContent = label ?? ''
    return badge
}

export const FileTypeBadge = memo(function FileTypeBadge({ path, size = 14, knownFile = false }: { path: string; size?: number; /** 文件列表已确认此路径是文件时，覆盖无扩展名的目录启发式。 */ knownFile?: boolean }) {
    const target = resolveFileType(path)
    if (!target) return null
    const { className, style, tint, svg, label } = badgePresentation(target, size, knownFile)
    return <span
        aria-hidden="true"
        className={className}
        style={tint ? { ...style, '--badge-fg-base': tint } as CSSProperties : style}
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >{label}</span>
})
