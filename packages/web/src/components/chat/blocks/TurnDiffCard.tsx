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
 * 轮次变更卡（Turn Diff Card）：渲染 CLI 合成的 turn-diff 自定义事件（ADR 0008）。
 * 卡片是已落库事实的呈现，自身不做任何统计——数字即载荷（唯一权威口径，ADR 0008）。
 * git 模式（payload.git）带「审核」按钮：打开 inspector 审查 tab 落「上一轮」档；
 * 近似口径（git: null）无两树指针，不出按钮。
 */

import { memo, useState } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronsUpDown, FileDiff } from 'lucide-react'
import type { TurnDiffPayload } from '@mobi/shared'
import { basename } from '@/core/utils/path'

/** 变更类型徽标字面量与配色（kind → 短标 + 色；颜色固定不随主题，同 FileTypeBadge 纪律） */
const KIND_BADGES: Record<TurnDiffPayload['files'][number]['kind'], { label: string; color: string } | null> = {
    add: { label: 'A', color: '#4E9A51' },
    delete: { label: 'D', color: '#C2544D' },
    rename: { label: 'R', color: '#8A6FC9' },
    modify: null, // 修改是常态，不占一枚徽标
}

/** 目录段弱化显示的路径（basename 加粗语义由字重承担） */
function FilePathLabel({ path }: { path: string }) {
    const { token } = theme.useToken()
    const base = basename(path)
    const dir = base && path.endsWith(base) ? path.slice(0, path.length - base.length) : ''
    return (
        <span style={{ fontSize: token.fontSizeSM, fontFamily: 'mono', wordBreak: 'break-all' }}>
            {dir && <span style={{ color: token.colorTextTertiary }}>{dir}</span>}
            <span style={{ color: token.colorText }}>{base || path}</span>
        </span>
    )
}

/** +N -N 统计（绿增红删；二进制以标记替代计数） */
function DiffStat({ additions, deletions, binary }: { additions: number; deletions: number; binary: boolean }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    if (binary) {
        return <span style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>{t('chat.turnDiff.binary')}</span>
    }
    return (
        <span style={{ fontSize: token.fontSizeSM, fontFamily: 'mono', whiteSpace: 'nowrap' }}>
            <span style={{ color: '#4E9A51' }}>+{additions}</span>{' '}
            <span style={{ color: '#C2544D' }}>-{deletions}</span>
        </span>
    )
}

export const TurnDiffCard = memo(function TurnDiffCard({ payload, onReview }: { payload: TurnDiffPayload; onReview?: () => void }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [expanded, setExpanded] = useState(false)

    return (
        <div
            data-testid="turn-diff-card"
            style={{
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                background: token.colorFillQuaternary,
                padding: '10px 12px',
                margin: '4px 0',
            }}
        >
            {/* 摘要行（折叠态即全卡）：图标 + 文案 + 总统计 + 展开开关 */}
            <div
                role="button"
                data-testid="turn-diff-toggle"
                onClick={() => setExpanded((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, cursor: 'pointer' }}
            >
                <FileDiff size={15} color={token.colorTextSecondary} aria-hidden />
                <span style={{ fontSize: token.fontSize, color: token.colorText, flex: 1 }}>
                    {t('chat.turnDiff.filesEdited', { count: payload.stats.files })}
                    {!payload.git && (
                        <span title={t('chat.turnDiff.approximate')} style={{ marginLeft: 6, fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                            ≈
                        </span>
                    )}
                </span>
                <DiffStat additions={payload.stats.additions} deletions={payload.stats.deletions} binary={false} />
                {onReview && payload.git && (
                    <button
                        type="button"
                        data-testid="turn-diff-review"
                        onClick={(e) => {
                            // 摘要行整体是展开开关，按钮须阻断冒泡避免顺手折叠
                            e.stopPropagation()
                            onReview()
                        }}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            border: 'none', cursor: 'pointer', borderRadius: token.borderRadiusSM,
                            padding: '2px 8px', fontSize: token.fontSizeSM,
                            color: token.colorText, background: token.colorFillTertiary,
                        }}
                    >
                        <FileDiff size={12} aria-hidden />
                        {t('chat.turnDiff.review')}
                    </button>
                )}
                {expanded ? <ChevronDown size={14} color={token.colorTextTertiary} /> : <ChevronsUpDown size={14} color={token.colorTextTertiary} />}
            </div>

            {/* 展开清单：文件路径 + 类型徽标 + 增删计数 */}
            {expanded && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 6 }}>
                    {payload.files.map((file) => {
                        const badge = KIND_BADGES[file.kind]
                        return (
                            <div
                                key={`${file.kind}:${file.path}`}
                                data-testid="turn-diff-file"
                                style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, padding: '3px 0' }}
                            >
                                {badge && (
                                    <span
                                        style={{
                                            fontSize: token.fontSizeSM - 1, fontFamily: 'mono', color: '#fff',
                                            background: badge.color, borderRadius: 4, padding: '0 4px', lineHeight: '16px',
                                        }}
                                    >
                                        {badge.label}
                                    </span>
                                )}
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <FilePathLabel path={file.path} />
                                    {file.previousPath && (
                                        <span style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary, marginLeft: 6 }}>
                                            ← {file.previousPath}
                                        </span>
                                    )}
                                </span>
                                <DiffStat additions={file.additions} deletions={file.deletions} binary={file.binary === true} />
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
})
