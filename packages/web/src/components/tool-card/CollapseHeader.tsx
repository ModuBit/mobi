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

import { theme as antTheme } from 'antd'
import { ChevronDown } from 'lucide-react'

type CollapseHeaderProps = {
    /** 胶囊徽章文案（i18n 后传入，如「等待审批」/「需要你的反馈」） */
    badgeText: string
    /** 折叠头摘要（工具摘要 / 首题文本） */
    summary: string
    collapsed: boolean
    onToggle: () => void
    /** data-testid，供测试定位 */
    testId: string
    /** aria-controls 目标 id，同时是折叠内容容器的 id */
    panelId: string
    /** 触控目标高度（移动端 44 / 桌面 40） */
    actionMinHeight: number
}

/**
 * 工具卡片 pending footer 的共享折叠头。
 *
 * PermissionFooter / AskUserQuestionFooter 共用 —— 徽标 + 摘要 + 展开箭头，
 * button 承载以提供键盘可达性（aria-expanded/aria-controls），
 * 并尊重 prefers-reduced-motion。
 */
export function CollapseHeader(props: CollapseHeaderProps) {
    const { token } = antTheme.useToken()
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false

    return (
        <button
            type="button"
            data-testid={props.testId}
            aria-expanded={!props.collapsed}
            aria-controls={props.panelId}
            onClick={props.onToggle}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                minHeight: props.actionMinHeight,
                cursor: 'pointer',
                color: token.colorTextSecondary,
                fontSize: 13,
                background: 'transparent',
                border: 'none',
                padding: 0,
                textAlign: 'left',
            }}
        >
            <span
                style={{
                    fontSize: 11,
                    color: token.colorPrimary,
                    background: token.colorPrimaryBg,
                    border: `1px solid ${token.colorPrimaryBorder}`,
                    padding: '1px 8px',
                    borderRadius: 10,
                    flexShrink: 0,
                }}
            >
                {props.badgeText}
            </span>
            <span
                style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {props.summary}
            </span>
            <ChevronDown
                size={14}
                style={{
                    flexShrink: 0,
                    color: token.colorTextTertiary,
                    transform: props.collapsed ? 'none' : 'rotate(180deg)',
                    transition: reducedMotion ? 'none' : 'transform .2s',
                }}
            />
        </button>
    )
}
