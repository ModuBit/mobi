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
 * 工具卡 Diff 视图（Edit/MultiEdit/Write 共用）：渲染本体换 @pierre/diffs 的
 * PatchDiff——与审查面板同核（虚拟化承载大 diff、主题同走 PIERRE_BRIDGE_VARS）。
 *
 * 数据源双轨合成 unified patch 文本（composePatchText / composePatchFromLineRows，
 * structuredPatch 优先、old/new 自 diff 回退），props 契约不变。
 *
 * 高度姿势（与审查面板固定 host 不同，工具卡要求内容自适应、超限内滚）：
 * PatchDiff 虚拟器以 host getBoundingClientRect 高度为视口（源码 getHeight 实证），
 * host 高 0 起步——两段式：先给足够高的估计高度，首帧后测 shadow container 实际
 * 内容高收缩到 min(实际, 上限)，上限内滚。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Modal, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { PatchDiff } from '@pierre/diffs/react'
import { formatDiffStats } from './lineNumberUtils'
import { composePatchText, composePatchFromLineRows, countPatchLines } from './structuredPatchUtils'
import type { StructuredPatch } from '@/domain/chat/types'
import { FilePathText } from '@/components/ui/FilePathText'
import { ToolViewPanel } from './ToolViewPanel'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { PIERRE_BRIDGE_VARS } from '@/components/review/pierreTheme'

const { useToken } = antTheme

/** inline 卡片内 diff 高度上限（超出内滚） */
const INLINE_MAX_DIFF_HEIGHT = 320

/** 估计初始高度：宁大勿小（首帧后按实际收缩），但封顶防超大 patch 撑出滚动闪跳 */
const INITIAL_ESTIMATE_HEIGHT = 1600

/**
 * 简单的行级 diff 算法（回退路径：执行中预览 / Write 无 patch / 历史消息缺 structuredPatch）
 */
function diffLines(oldStr: string, newStr: string): Array<{ value: string; added?: boolean; removed?: boolean }> {
    const oldLines = oldStr.split('\n')
    const newLines = newStr.split('\n')
    const result: Array<{ value: string; added?: boolean; removed?: boolean }> = []

    let oldIdx = 0
    let newIdx = 0

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (oldIdx < oldLines.length && newIdx < newLines.length) {
            if (oldLines[oldIdx] === newLines[newIdx]) {
                result.push({ value: oldLines[oldIdx] })
                oldIdx++
                newIdx++
            } else {
                // 查找在 old 中是否有匹配
                const matchInOld = newLines.slice(newIdx).findIndex(l => l === oldLines[oldIdx])
                const matchInNew = oldLines.slice(oldIdx).findIndex(l => l === newLines[newIdx])

                if (matchInOld === -1 && matchInNew >= 0) {
                    // new 中这行在 old 中找不到匹配，作为添加
                    result.push({ value: newLines[newIdx], added: true })
                    newIdx++
                } else if (matchInNew === -1 && matchInOld >= 0) {
                    // old 中这行在 new 中找不到匹配，作为删除
                    result.push({ value: oldLines[oldIdx], removed: true })
                    oldIdx++
                } else if (matchInOld >= 0 && (matchInNew === -1 || matchInOld <= matchInNew)) {
                    // 先添加 new 中的行
                    for (let i = 0; i < matchInOld; i++) {
                        result.push({ value: newLines[newIdx + i], added: true })
                    }
                    newIdx += matchInOld
                } else if (matchInNew >= 0) {
                    // 先删除 old 中的行
                    for (let i = 0; i < matchInNew; i++) {
                        result.push({ value: oldLines[oldIdx + i], removed: true })
                    }
                    oldIdx += matchInNew
                } else {
                    // 无法匹配，一个删除一个添加
                    result.push({ value: oldLines[oldIdx], removed: true })
                    result.push({ value: newLines[newIdx], added: true })
                    oldIdx++
                    newIdx++
                }
            }
        } else if (oldIdx < oldLines.length) {
            result.push({ value: oldLines[oldIdx], removed: true })
            oldIdx++
        } else {
            result.push({ value: newLines[newIdx], added: true })
            newIdx++
        }
    }

    return result
}

/**
 * 内容自适应高度的 PatchDiff 宿主：PatchDiff 需要确定高度视口（虚拟化硬约束），
 * 而工具卡要求卡片高度随 diff 行数自适应、超上限内滚。两段式解决——初始给
 * 估计高度（宁大勿小），首帧后读 shadow container 实际内容高收缩到 min(实际, 上限)。
 * patch 变化（流式更新）时回到估计高度重新测量。
 */
function AutoHeightPatchDiff({ patch, options, maxHeightPx }: {
    patch: string
    options: Record<string, unknown>
    maxHeightPx: number
}) {
    const hostRef = useRef<HTMLDivElement>(null)
    const [height, setHeight] = useState<number>(INITIAL_ESTIMATE_HEIGHT)

    useEffect(() => {
        // 先回到估计高度再测：旧高度可能小于新内容，会被 host 截断出假读数
        setHeight(INITIAL_ESTIMATE_HEIGHT)
        const el = hostRef.current
        if (!el) return
        // pierre 的 shadow 内容异步渲染（首帧可能只有 0 高占位 svg）——轮询直到测到
        // 内容高或超时（~2s）。用 setTimeout 不用 rAF：后台 tab 的 rAF 完全暂停，
        // 重新可见时才补跑，卡片会长时间停在估计高度
        let timer: ReturnType<typeof setTimeout> | undefined
        const startedAt = Date.now()
        const measure = () => {
            // diffs-container（PatchDiff 渲染的 host web component）在其子位置，
            // shadow 里首子是 0 高 svg（spinner 占位），内容在 PRE/容器子元素——
            // 取各子元素实测高度的最大值（contain 无裁剪，即虚拟化总内容高）
            const host = el.querySelector('diffs-container') as (HTMLElement & { shadowRoot?: ShadowRoot }) | null
            const shadow = host?.shadowRoot
            const contentHeight = shadow
                ? Math.max(0, ...[...shadow.children].map((c) => c.getBoundingClientRect().height))
                : 0
            if (contentHeight > 0) {
                setHeight(Math.min(Math.ceil(contentHeight), maxHeightPx))
                return
            }
            if (Date.now() - startedAt < 2000) timer = setTimeout(measure, 50)
        }
        timer = setTimeout(measure, 50)
        return () => clearTimeout(timer)
    }, [patch, options, maxHeightPx])

    return (
        <div
            ref={hostRef}
            data-testid="tool-diff-viewer"
            style={{ height, maxHeight: maxHeightPx, overflow: 'auto', display: 'flex' }}
        >
            <PatchDiff
                patch={patch}
                options={options}
                style={{ ...PIERRE_BRIDGE_VARS, height: '100%', flex: 1, minWidth: 0 } as CSSProperties}
            />
        </div>
    )
}

/**
 * Diff 视图组件
 * 支持 inline（卡片内嵌）和 preview（概要 + Modal）两种模式
 */
export function DiffView(props: {
    oldString: string
    newString: string
    /** 工具完成后的原生 diff patch（携带文件真实行号），优先于 old/new 自 diff */
    structuredPatches?: StructuredPatch[]
    filePath?: string
    variant?: 'preview' | 'inline'
    statsType?: 'edit' | 'write'
}) {
    const { t } = useTranslation()
    const { token } = useToken()
    const resolved = useUiStore((s) => resolveTheme(s.theme))

    const name = props.filePath ?? '_'
    const hasPatches = !!props.structuredPatches && props.structuredPatches.length > 0

    // 双轨合成 unified patch 文本 + 行数统计（structuredPatch 优先，内容与行号和 CC 一致）
    const { patchText, statsLabel } = useMemo(() => {
        if (hasPatches) {
            const patches = props.structuredPatches!
            const { added, removed } = countPatchLines(patches)
            return {
                patchText: composePatchText(name, patches),
                statsLabel: formatDiffStats({ added, removed, unchanged: 0 }, props.statsType ?? 'edit'),
            }
        }
        const rows = diffLines(props.oldString, props.newString)
        let added = 0
        let removed = 0
        for (const row of rows) {
            if (row.added) added += 1
            else if (row.removed) removed += 1
        }
        return {
            patchText: composePatchFromLineRows(name, rows),
            statsLabel: formatDiffStats({ added, removed, unchanged: 0 }, props.statsType ?? 'edit'),
        }
    }, [hasPatches, props.structuredPatches, props.oldString, props.newString, name, props.statsType])

    const options = useMemo(() => ({
        diffStyle: 'unified' as const,
        overflow: 'scroll' as const,
        hunkSeparators: 'simple' as const,
        disableFileHeader: true,
        themeType: resolved as 'light' | 'dark',
    }), [resolved])

    const header = useMemo(() => (
        <>
            <div style={{
                fontSize: 11,
                color: token.colorTextSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}>
                {props.filePath ? (
                    <FilePathText path={props.filePath} style={{ fontSize: 11 }} />
                ) : 'Diff'}
            </div>
            <div style={{
                fontSize: 11,
                color: token.colorTextTertiary,
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}>
                {statsLabel}
            </div>
        </>
    ), [props.filePath, statsLabel, token])

    const diffBody = patchText ? (
        <AutoHeightPatchDiff patch={patchText} options={options} maxHeightPx={INLINE_MAX_DIFF_HEIGHT} />
    ) : (
        <div style={{ padding: 8, fontSize: 12, color: token.colorTextTertiary }}>{t('review.noDiff')}</div>
    )

    if (props.variant !== 'preview') {
        return <ToolViewPanel header={header}>{diffBody}</ToolViewPanel>
    }

    // preview Modal：上限放宽到视口 75%（与 Modal 容器一致），不共用 inline 的 320 上限
    const modalMaxHeight = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.75) : INLINE_MAX_DIFF_HEIGHT
    const modalBody = patchText
        ? <AutoHeightPatchDiff patch={patchText} options={options} maxHeightPx={modalMaxHeight} />
        : diffBody

    return <DiffPreviewView modalBody={modalBody} statsLabel={statsLabel} filePath={props.filePath} />
}

/**
 * preview 模式（详情抽屉）：概要行 + Modal 全量 diff。
 * 独立子组件承载 Modal 状态——DiffView 的 inline 分支无需挂 hooks（原实现
 * 把 useState 放在条件 return 之后，规则违规仅因 variant 恒定未炸）。
 */
function DiffPreviewView({ modalBody, statsLabel, filePath }: {
    modalBody: ReactNode
    statsLabel: string
    filePath?: string
}) {
    const { t } = useTranslation()
    const { token } = useToken()
    const [modalOpen, setModalOpen] = useState(false)

    return (
        <>
            <button
                type="button"
                onClick={() => setModalOpen(true)}
                style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer'
                }}
            >
                <ToolViewPanel
                    header={filePath ? <FilePathText path={filePath} style={{ fontSize: 11 }} /> : undefined}
                    hoverBackground={token.colorBgTextHover}
                >
                    <div style={{ padding: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{
                                minWidth: 0,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11,
                                color: token.colorTextSecondary,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {statsLabel}
                            </div>
                            <div style={{ flexShrink: 0, fontSize: 11, color: token.colorPrimary }}>
                                {t('diff.view')}
                            </div>
                        </div>
                    </div>
                </ToolViewPanel>
            </button>

            <Modal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={null}
                title={filePath ?? t('diff.title')}
                width={800}
            >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: token.colorTextSecondary, marginBottom: 12 }}>
                    {statsLabel}
                </div>
                <div style={{ maxHeight: '75dvh', overflow: 'auto' }}>
                    {modalBody}
                </div>
            </Modal>
        </>
    )
}
