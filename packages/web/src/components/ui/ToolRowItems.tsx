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

import { memo } from 'react'
import { theme as antTheme } from 'antd'
import { FileChip } from './FileChip'
import { ShinyText } from './ShinyText'
import type { ToolRow } from '@/core/lib/toolRow'

/**
 * 工具行新形态（Tool Row × File Chip）的共享渲染段：动词 + 摘要 + 行附加信息 +
 * 文件 Chip + diff 统计。消息列表 ToolCallRenderer、Task 卡摘要行、工具卡 header
 * 三个消费点共用——视觉规格只在此处调（mockup 变体 A）。
 *
 * dense 模式：嵌在小字号语境（Task 卡摘要 11px）时不设 fontSize，继承外层。
 * chip 的点击语义（打开文件）与行本体（展开详情）的分离由 FileChip 内部收口。
 *
 * shimmer：运行态扫光（工具 running 时由调用方传入）——动词与摘要合并在**同一个
 * ShinyText** 里：gradient 跨组合宽度连成一道波。分属两个 ShinyText 时各自独立
 * sweep，流式期摘要晚于动词挂载、动画相位错开，视觉上是两处各眨各的（2026-09-25
 * 验收）。chip / rowMeta / stats 是徽章/元数据，保持静态不扫光。行形态此前没接
 * shimmer，运行中工具行无任何 blink 反馈（2026-09-20 回归）。
 */
export const ToolRowItems = memo(function ToolRowItems({ row, dense, shimmer }: { row: ToolRow; dense?: boolean; shimmer?: boolean }) {
    const { token } = antTheme.useToken()
    return (
        <>
            <ShinyText
                active={Boolean(shimmer)}
                style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, flex: '0 1 auto' }}
            >
                <span style={{ fontWeight: 600, fontSize: dense ? undefined : 13, flexShrink: 0 }}>
                    {row.verb}
                </span>
                {row.summary && (
                    // 纯展示工具的 description（Bash 的 title 语义）：优先于人读摘要，允许收缩截断
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {row.summary}
                    </span>
                )}
            </ShinyText>
            {row.rowMeta && (
                <span style={{ fontSize: dense ? undefined : 12, color: token.colorTextTertiary, flexShrink: 0 }}>
                    {row.rowMeta}
                </span>
            )}
            {row.chip && (
                // chip 让位优先：basis 0 + grow 1（上限由 chip 自身 max-width 收口）——
                // 摘要按自然宽度优先展示，chip 只占剩余空间；空间不足时摘要先收缩，
                // wrapper 72px 保底保证命令 chip 不被完全挤没（Bash 描述长、命令被盖没的回归）
                <span style={{ flex: '1 1 0%', minWidth: 72, display: 'flex' }}>
                    <FileChip chip={row.chip} />
                </span>
            )}
            {row.stats && (
                <span style={{ fontSize: dense ? undefined : 11.5, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <span style={{ color: token.colorSuccess }}>+{row.stats.add}</span>
                    {row.stats.del > 0 && (
                        <span style={{ color: token.colorError, marginLeft: 4 }}>−{row.stats.del}</span>
                    )}
                </span>
            )}
        </>
    )
})
