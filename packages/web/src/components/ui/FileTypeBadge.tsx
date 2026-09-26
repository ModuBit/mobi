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
 * 文件类型徽章：路径 → 扩展名色块（TS/MD/{ }…）或目录 glyph。
 * 判定单源在 fileTypeMeta（resolveFileType），本组件只管展示。
 *
 * 形态：14px 圆角色块；配色走「类型色淡底（15% alpha）+ 类型色前景」——保留
 * 编辑器语言色的类型区分度，但饱和底+白字在消息流里喧宾夺主（2026-09-26 真机），
 * 降为点缀级。alpha 混合底随明暗主题自动适配，原色前景两档均可读（对齐
 * 主题双档约束：两种主题下各自验证过对比度阶梯）。嵌在链接/chip 行内使用，
 * flexShrink 0 防压缩变形。
 */

import { memo } from 'react'
import { Folder, FileText } from 'lucide-react'
import { resolveFileType } from '@/core/lib/fileTypeMeta'

/** 类型色淡底的 alpha 后缀（15%，hex 拼接——表内色值均为 6 位 hex） */
const TINT_ALPHA = '26'

export const FileTypeBadge = memo(function FileTypeBadge({ path, size = 14 }: { path: string; size?: number }) {
    const target = resolveFileType(path)
    if (!target) return null

    const tint = target.kind === 'directory' ? '#E8A33D' : target.color
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
            style={{
                ...box,
                color: target.color,
                fontSize: target.label.length > 2 ? size * 0.5 : size * 0.62,
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: '-0.02em',
            }}
        >
            {target.label}
        </span>
    )
})
