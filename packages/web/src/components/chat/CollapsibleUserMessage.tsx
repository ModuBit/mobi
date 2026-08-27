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

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { css } from '@emotion/react'
import { ChevronDown } from 'lucide-react'
import type { UserContentBlock } from '@mobi/shared'
import { areUserBlocksEqual, collectUserText } from '@/domain/chat/userContent'

/** 用户消息气泡收起高度阈值（px）：超过则默认折叠，点击展开 */
export const USER_MESSAGE_COLLAPSE_THRESHOLD = 200

/** 折叠态底部渐隐区域高度（px） */
const COLLAPSE_FADE_HEIGHT = 48

/** 展开动画时长（ms） */
const EXPAND_TRANSITION_MS = 300

/**
 * 预估用的行数/字符数阈值（对应约 USER_MESSAGE_COLLAPSE_THRESHOLD 渲染高度的保守估计）。
 * 行数与渲染高度强相关（每行至少占一行高 ~22px）；字符数兜底捕获单行长文本的软换行。
 */
const ESTIMATE_LINE_LIMIT = 8
const ESTIMATE_CHAR_LIMIT = 360

/**
 * 基于原始文本长度保守预估是否可能超过折叠阈值。
 *
 * 用于「渲染即折叠」：DOM 测量（scrollHeight）首帧不可靠（Markdown 代码块高亮等异步渲染，
 * 首次测量常偏小），会导致长消息「先全展示再折叠」的闪烁。本预估在渲染前用文本长度给出
 * 首帧初始态，长消息首帧即为折叠态。
 *
 * 偏保守（倾向判定为长）：宁可少量边界短消息首帧折叠（useLayoutEffect 在 paint 前同步测量修正），
 * 也不让真正的长消息首帧全展示。真实是否折叠由 ResizeObserver 测量决定，并可双向修正。
 */
export function estimateUserMessageOverflow(text: string): boolean {
    if (!text) return false
    return text.split('\n').length > ESTIMATE_LINE_LIMIT || text.length > ESTIMATE_CHAR_LIMIT
}

// 折叠容器全局样式。导出供 ChatContainer 挂载一次（<Global>），
// 避免每条 user 消息各自挂载 <Global> 导致长会话中随消息数线性增长的 React 协调开销。
export const collapsibleUserMessageStyles = css`
    .collapsible-user-msg {
        position: relative;
    }
    .collapsible-user-msg__content {
        /*
         * 允许 height:auto 等关键字参与过渡（浏览器原生插值），
         * 从而展开/收起在「阈值高度」与「自适应高度」间平滑过渡，
         * 无需 JS 测量真实高度，避免布局抖动。
         * 不支持的浏览器（旧版）降级为瞬切，功能不受影响。
         */
        interpolate-size: allow-keywords;
        transition: height ${EXPAND_TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1);
        /*
         * 始终裁剪溢出：过渡过程中内容随高度变化被逐步揭示/收纳，
         * 才是「展开/收起」效果；若仅在收起态裁剪，展开瞬间 overflow 变 visible，
         * 完整内容会提前溢出显示，并把下方消息推乱。
         * （代码块复制按钮在 CodeHighlighter 内部、Tooltip 走 portal，均不受此影响。）
         */
        overflow: hidden;
    }
    /* 折叠态：限制到阈值高度，底部渐隐露出气泡背景，提示下方还有内容 */
    .collapsible-user-msg__content--collapsed {
        height: var(--collapsible-threshold, ${USER_MESSAGE_COLLAPSE_THRESHOLD}px);
        -webkit-mask-image: linear-gradient(
            to bottom,
            #000 calc(100% - ${COLLAPSE_FADE_HEIGHT}px),
            transparent
        );
        mask-image: linear-gradient(
            to bottom,
            #000 calc(100% - ${COLLAPSE_FADE_HEIGHT}px),
            transparent
        );
    }
    .collapsible-user-msg__toggle-wrap {
        display: flex;
        justify-content: center;
        margin-top: 6px;
    }
    .collapsible-user-msg__toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        font-size: 12px;
        line-height: 1.5;
        color: var(--ant-color-text-secondary);
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease;
    }
    .collapsible-user-msg__toggle:hover {
        background: var(--ant-color-fill-tertiary);
        color: var(--ant-color-primary);
    }
    .collapsible-user-msg__chevron {
        transition: transform 0.2s ease;
    }
    /* 展开态：chevron 旋转 180° 朝上 */
    .collapsible-user-msg__toggle[data-expanded='true'] .collapsible-user-msg__chevron {
        transform: rotate(180deg);
    }
    /* 无障碍：尊重用户的减少动画偏好 */
    @media (prefers-reduced-motion: reduce) {
        .collapsible-user-msg__content,
        .collapsible-user-msg__chevron {
            transition: none !important;
        }
    }
`

/**
 * 用户消息气泡折叠容器
 *
 * 内容高度超过 {@link USER_MESSAGE_COLLAPSE_THRESHOLD} 时默认收起（阈值高度 + 底部渐隐），
 * 点击 toggle 在展开/收起间切换，带丝滑高度过渡。
 *
 * - 首帧用 blocks 聚合文本的长度预估初始化（渲染即折叠），避免 DOM 测量延迟导致的「先全展示再折叠」闪烁；
 *   注：image/document 卡片的固定高度未计入预估——预估本就保守且 RO 测量会双向修正，
 *   纯附件消息高度小、不触发折叠，混合消息由文本主导，误差可接受；
 * - `useLayoutEffect` 在 paint 前同步测量真实 scrollHeight 并**双向**修正 clippable ——
 *   既能让真正超阈值的长消息折叠，也能让被预估误判（如英文长文本渲染偏矮）的消息回到无按钮态，
 *   不会因保守预估而永久错误折叠；
 * - 动画完全由 CSS 驱动（`interpolate-size` 让浏览器原生插值 `height: auto`），JS 不参与高度过渡。
 *
 * `blocks` 按结构相等 memo 化预估结果，chatBlocks 高频重渲染（流式期间）时不会对历史消息重复计算。
 */
export const CollapsibleUserMessage = memo(
    function CollapsibleUserMessage({
        children,
        blocks,
        threshold = USER_MESSAGE_COLLAPSE_THRESHOLD,
        // isSynthetic 不在组件体内渲染，仅供底部 memo 比较器纳入（避免同 blocks 不同
        // isSynthetic 时跳过重渲、子视图用旧值），故此处显式标记不参与 unused 检查
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        isSynthetic,
    }: {
        children: ReactNode
        /** 消息 content blocks：首帧按聚合文本做折叠预估（结构相等 memo 化，避免高频重渲染重复计算） */
        blocks: UserContentBlock[]
        threshold?: number
        /**
         * 是否合成消息（透传给 children 的合成样式标记）。
         * children 内部用到此字段，但 memo 比较器忽略 children 元素引用，故必须把 isSynthetic
         * 显式提到 prop 纳入比较，否则同 blocks 不同 isSynthetic 时会跳过重渲、子视图用旧值。
         */
        isSynthetic?: boolean
    }) {
        const { t } = useTranslation()
        const [expanded, setExpanded] = useState(false)
        // 首帧预估：按 blocks memo（结构相等即不算，user 消息静态则只算一次）
        const initiallyCollapsed = useMemo(
            () => estimateUserMessageOverflow(collectUserText(blocks)),
            [blocks],
        )
        const [clippable, setClippable] = useState(initiallyCollapsed)
        const contentRef = useRef<HTMLDivElement>(null)

        useEffect(() => {
            const el = contentRef.current
            if (!el) return

            // 虚拟化（react-virtuoso）下 bubble 频繁 mount/unmount，useLayoutEffect 同步读
            // scrollHeight 会触发 forced reflow（PoC trace 实测 292ms）。改 useEffect + ResizeObserver
            // 异步测量。useEffect 在 paint 后执行（不阻塞 paint，不算 forced reflow），
            // 故可同步读一次 scrollHeight 作首帧修正，弥补 RO 首次回调可能延迟/不触发的边界
            // （否则 estimate 与真实不符时 clippable 会永久停在 initiallyCollapsed 估值）。
            const measure = () => setClippable(el.scrollHeight > threshold)
            measure()
            const ro = new ResizeObserver(measure)
            ro.observe(el)
            return () => ro.disconnect()
        }, [threshold])

        const collapsed = clippable && !expanded

        return (
            <div className="collapsible-user-msg">
                <div
                    ref={contentRef}
                    className={`collapsible-user-msg__content${collapsed ? ' collapsible-user-msg__content--collapsed' : ''}`}
                    style={{ '--collapsible-threshold': `${threshold}px` } as CSSProperties}
                >
                    {children}
                </div>
                {clippable && (
                    <div className="collapsible-user-msg__toggle-wrap">
                        <button
                            type="button"
                            className="collapsible-user-msg__toggle"
                            data-expanded={expanded}
                            onClick={() => setExpanded((v) => !v)}
                            aria-expanded={expanded}
                        >
                            <span>{expanded ? t('chat.collapse') : t('chat.expand')}</span>
                            <ChevronDown size={14} className="collapsible-user-msg__chevron" />
                        </button>
                    </div>
                )}
            </div>
        )
    },
    // 自定义比较：user-text 的 children 由 (blocks, isSynthetic) 唯一决定（renderChatBlock 固定传
    // <UserBlocksView blocks={block.blocks} env={{isSynthetic, sessionId}}/>），故 blocks 结构相等
    // 且 isSynthetic 相同即内容实质相同。忽略 children 元素引用变化（renderChatBlock 每次都新建
    // JSX 元素）与 sessionId 变化（切换会话必然整体重建消息列表，无需靠比较器兜底），
    // 让流式期间未变化的用户消息气泡跳过重渲。
    // ⚠️ 前提：children 不含这些字段以外的动态字段；当前唯一调用点满足。
    // 若未来 children 引入更多动态 prop，必须把它提到这里纳入比较，否则会静默漏更新。
    (prev, next) =>
        areUserBlocksEqual(prev.blocks, next.blocks)
        && prev.threshold === next.threshold
        && prev.isSynthetic === next.isSynthetic,
)
