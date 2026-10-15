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
 * 模型行的 effort 子菜单（ChatComposer / NewSessionPage 共用，自两页的逐字复制收敛）：
 * - EffortDot：级别小圆点（列表入口 + 触发器 prefix 共用）；
 * - EffortPopoverContent：Popover 面板内容（级别行，点击回调）；
 * - useModelOptionsWithEffort：把 effort 子菜单入口装配进模型选项的 morph trailing 槽
 *   （morph 对 trailing 已收口 stopPropagation，点入口不会误选模型）；
 *   antd Popover 形态与 effort-popover 样式注入归 CompactHoverSelect 单点。
 */

import { useMemo, useState } from 'react'
import { Popover, theme } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { EFFORT_LEVELS, EFFORT_LABELS } from '@mobi/shared'
import type { EffortLevel } from '@mobi/shared'
import type { CompactHoverSelectOption } from '@/features/composer/CompactHoverSelect'
import { useHasFinePointer } from '@/core/data/hooks/useMediaQuery'

const EFFORT_COLORS: Record<EffortLevel, string> = {
    low: 'var(--ant-color-text-quaternary)',
    medium: 'var(--ant-color-info)',
    high: 'var(--ant-color-warning)',
    xhigh: 'var(--ant-color-error)',
}

/** Effort 级别小圆点 */
export function EffortDot({ level }: { level: EffortLevel }) {
    return (
        <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: EFFORT_COLORS[level],
            flexShrink: 0,
        }} />
    )
}

/** model option 中的 effort 选择 Popover 内容 */
function EffortPopoverContent({ modelValue, effort, onEffortSelect }: {
    modelValue: string
    effort: EffortLevel
    onEffortSelect: (model: string, effort: EffortLevel) => void
}) {
    const { token } = theme.useToken()
    const [hovered, setHovered] = useState<string | null>(null)
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100 }}>
            {EFFORT_LEVELS.map(e => (
                <div
                    key={e}
                    onClick={(ev) => { ev.stopPropagation(); onEffortSelect(modelValue, e) }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', margin: '0 4px', borderRadius: token.borderRadiusSM,
                        cursor: 'pointer',
                        // 选中 = colorPrimaryBg（selected 档，比 hover 深），hover = colorBgTextHover（hover 档）
                        background: e === effort ? token.colorPrimaryBg
                            : hovered === e ? token.colorBgTextHover : undefined,
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={() => setHovered(e)}
                    onMouseLeave={() => setHovered(null)}
                >
                    <EffortDot level={e} />
                    <span style={{ fontSize: 12 }}>{EFFORT_LABELS[e]}</span>
                </div>
            ))}
        </div>
    )
}

/**
 * 给模型选项逐项装配 effort 子菜单入口（morph trailing 槽）。
 * enabled=false（调用方无 effort 回调的形态）不加 trailing。
 */
export function useModelOptionsWithEffort(
    options: CompactHoverSelectOption[],
    { effort, onSelect, enabled = true }: {
        effort: EffortLevel
        onSelect: (model: string, effort: EffortLevel) => void
        enabled?: boolean
    },
): CompactHoverSelectOption[] {
    const hasFinePointer = useHasFinePointer()
    const [popoverModel, setPopoverModel] = useState<string | null>(null)
    return useMemo(
        () => options.map(option => ({
            ...option,
            trailing: enabled ? (
                <Popover
                    open={popoverModel === option.value}
                    onOpenChange={(open) => setPopoverModel(open ? option.value : null)}
                    placement="leftTop"
                    trigger={hasFinePointer ? 'hover' : 'click'}
                    mouseEnterDelay={0.1}
                    mouseLeaveDelay={0.3}
                    zIndex={1051}
                    rootClassName="effort-popover"
                    content={
                        <EffortPopoverContent
                            modelValue={option.value}
                            effort={effort}
                            onEffortSelect={(m, e) => {
                                onSelect(m, e)
                                setPopoverModel(null)
                            }}
                        />
                    }
                >
                    <span
                        style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            minWidth: 24, minHeight: 24, borderRadius: 4, cursor: 'pointer',
                        }}
                        onClick={(ev) => ev.stopPropagation()}
                    >
                        <RightOutlined style={{ fontSize: 10, opacity: 0.4 }} />
                    </span>
                </Popover>
            ) : undefined,
        })),
        [options, enabled, effort, popoverModel, hasFinePointer, onSelect],
    )
}
