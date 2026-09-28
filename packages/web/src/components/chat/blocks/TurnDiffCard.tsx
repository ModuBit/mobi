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
 *
 * 布局（对齐参考稿）：宽 100%；头部图标砖 + 标题/总统计两行 + 右侧审核；分隔线下
 * 文件清单默认铺开（前 PREVIEW_COUNT 条），超出时底部「再显示 N 个文件」展开/收起。
 */

import { memo, useState } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, FileDiff } from 'lucide-react'
import type { TurnDiffPayload } from '@mobi/shared'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { basename } from '@/core/utils/path'

/** 清单默认铺开的条数，超出折叠进「再显示 N 个文件」 */
const PREVIEW_COUNT = 3

/** prefers-reduced-motion 检测（jsdom 等无 matchMedia 环境安全退化；非响应式足够——只影响时长） */
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * 变更类型徽标字面量与配色（kind → 短标 + 明暗双档色；字面量固定不随主题，色值双档各自验证）。
 * 审查视图（GitReviewView）共用同一套：徽标语义与配色只此一处，勿复制。
 */
export const KIND_BADGES: Record<TurnDiffPayload['files'][number]['kind'], { label: string; light: string; dark: string }> = {
    add: { label: 'A', light: '#4E9A51', dark: '#6FBF73' },
    delete: { label: 'D', light: '#C2544D', dark: '#E08A84' },
    rename: { label: 'R', light: '#8A6FC9', dark: '#B9A5E8' }, // 暗档提亮：旧紫在暗底上不可读（真机实证 2026-09-27）
    modify: { label: 'M', light: '#B8860B', dark: '#D9A83C' },
}

/**
 * 路径单行展示、空间不足从左侧省略（保留尾段文件名，用户认路径靠的是尾部）。
 * 两层结构缺一不可（真机实证 2026-09-27）：外层 direction:rtl 让 text-overflow 的
 * 省略号落在行首；内层 unicode-bidi:isolate + LTR 保证路径字符序——若路径直接暴露在
 * rtl 段落里，`__`/`.` 等中性字符会被段落方向重排到行尾（「__pycache__」显示成
 * 「pycache__…__」）。目录/文件名两段配色在内层保持。
 */
export function FilePathLabel({ path }: { path: string }) {
    const { token } = theme.useToken()
    const base = basename(path)
    const dir = base && path.endsWith(base) ? path.slice(0, path.length - base.length) : ''
    return (
        <span
            style={{
                flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                direction: 'rtl', textAlign: 'left',
                fontSize: token.fontSizeSM, fontFamily: 'mono',
            }}
        >
            <span style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
                {dir && <span style={{ color: token.colorTextTertiary }}>{dir}</span>}
                <span style={{ color: token.colorText }}>{base || path}</span>
            </span>
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
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')

    const overflow = payload.files.length - PREVIEW_COUNT

    const renderFileRow = (file: TurnDiffPayload['files'][number]) => {
        const badge = KIND_BADGES[file.kind]
        return (
            <div
                key={`${file.kind}:${file.path}`}
                data-testid="turn-diff-file"
                style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, padding: '4px 0' }}
            >
                <span
                    style={{
                        fontSize: token.fontSizeSM, fontFamily: 'mono', fontWeight: 600,
                        color: isDark ? badge.dark : badge.light, flexShrink: 0,
                    }}
                >
                    {badge.label}
                </span>
                <FilePathLabel path={file.path} />
                {file.previousPath && (
                    <span style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary, marginLeft: 6, flexShrink: 0 }}>
                        ← {file.previousPath}
                    </span>
                )}
                <DiffStat additions={file.additions} deletions={file.deletions} binary={file.binary === true} />
            </div>
        )
    }

    return (
        <div
            data-testid="turn-diff-card"
            className="turn-diff-fullwidth"
            style={{
                width: '100%',
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                background: token.colorBgContainer,
                padding: '12px 16px',
                margin: '4px 0',
            }}
        >
            {/* 头部：图标砖 + 标题/总统计两行 + 右侧审核 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                    aria-hidden
                    style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 32, height: 32, flexShrink: 0,
                        borderRadius: token.borderRadiusLG, background: token.colorFillTertiary,
                    }}
                >
                    <FileDiff size={16} color={token.colorTextSecondary} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: token.fontSize, color: token.colorText }}>
                        {t('chat.turnDiff.filesEdited', { count: payload.stats.files })}
                        {!payload.git && (
                            <span title={t('chat.turnDiff.approximate')} style={{ marginLeft: 6, fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                                ≈
                            </span>
                        )}
                    </div>
                    <DiffStat additions={payload.stats.additions} deletions={payload.stats.deletions} binary={false} />
                </div>
                {onReview && payload.git && (
                    <button
                        type="button"
                        data-testid="turn-diff-review"
                        onClick={onReview}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                            cursor: 'pointer', borderRadius: 999,
                            border: `1px solid ${token.colorBorder}`, padding: '3px 12px',
                            fontSize: token.fontSizeSM, color: token.colorText, background: token.colorBgContainer,
                        }}
                    >
                        {t('chat.turnDiff.review')}
                    </button>
                )}
            </div>

            {/* 文件清单：默认铺开前 PREVIEW_COUNT 条，溢出行收进可折叠区（双向缓动） */}
            <div style={{ marginTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 4 }}>
                {payload.files.slice(0, PREVIEW_COUNT).map(renderFileRow)}

                {/* 溢出行：grid 0fr↔1fr 过渡实现展开/收起双向缓动（DESIGN.md Motion：布局量
                    过渡走 antd 主题 token）；收起态保持挂载以获得退出动画，aria-hidden 屏蔽 */}
                {overflow > 0 && (
                    <div
                        data-testid="turn-diff-overflow"
                        aria-hidden={!expanded}
                        style={{
                            display: 'grid',
                            gridTemplateRows: expanded ? '1fr' : '0fr',
                            opacity: expanded ? 1 : 0,
                            // prefers-reduced-motion 降级为瞬时切换（DESIGN.md Motion）
                            transition: REDUCED_MOTION ? 'none' : [
                                `grid-template-rows ${token.motionDurationMid} ${token.motionEaseInOut}`,
                                `opacity ${token.motionDurationMid} ${token.motionEaseInOut}`,
                            ].join(', '),
                        }}
                    >
                        <div style={{ overflow: 'hidden', minHeight: 0 }}>
                            {payload.files.slice(PREVIEW_COUNT).map(renderFileRow)}
                        </div>
                    </div>
                )}

                {/* 展开开关：仅超出预览条数时出现 */}
                {overflow > 0 && (
                    <button
                        type="button"
                        data-testid="turn-diff-toggle"
                        onClick={() => setExpanded((v) => !v)}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            border: 'none', cursor: 'pointer', background: 'none', padding: '4px 0',
                            fontSize: token.fontSizeSM, color: token.colorTextSecondary,
                        }}
                    >
                        {expanded ? t('chat.turnDiff.collapse') : t('chat.turnDiff.showMoreFiles', { count: overflow })}
                        {expanded ? <ChevronUp size={14} color={token.colorTextTertiary} /> : <ChevronDown size={14} color={token.colorTextTertiary} />}
                    </button>
                )}
            </div>
        </div>
    )
})
