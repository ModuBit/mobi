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
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import { MobiWordmark } from '@/components/layout/MobiWordmark'
import { useThemeLocaleToggle } from '@/components/layout/useThemeLocaleToggle'
import { useBootSequence, type BootLine } from './useBootSequence'

const CURRENT_YEAR = new Date().getFullYear()

const blink = keyframes`50% { opacity: 0; }`

/** 左侧终端面板：替换原 BrandPanel，仅 PC 显示，深色背景 */
const Panel = styled.div<{ $isDark: boolean }>`
    display: none;
    flex-direction: column;
    justify-content: space-between;
    width: 50%;
    padding: 48px;
    position: relative;
    overflow: hidden;
    background: ${({ $isDark }) => ($isDark ? '#0a0a09' : '#141413')};
    font-family: var(--font-mono);
    color: #d1cfc5;

    @media (min-width: 1024px) {
        display: flex;
    }
`

const Banner = styled(MobiWordmark)`
    display: block;
`

const Lines = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    font-size: 14px;
    line-height: 1.8;
`

const Line = styled.div`
    white-space: pre-wrap;
`

const Prompt = styled.span`
    color: #4ade80;
    font-weight: 700;
`

const Ok = styled.span`
    color: #4ade80;
`

const Cursor = styled.span`
    display: inline-block;
    width: 8px;
    height: 14px;
    background: #d1cfc5;
    vertical-align: -2px;
    margin-left: 2px;
    animation: ${blink} 1s steps(2) infinite;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`

const Footer = styled.div`
    color: #6b6a65;
    font-size: 12px;
`

export function BootLogPanel() {
    const { t } = useTranslation()
    const { resolvedTheme } = useThemeLocaleToggle()
    const isDark = resolvedTheme === 'dark'

    const lines: BootLine[] = [
        { id: 'cmd', node: <><Prompt>$</Prompt> mobi</> },
        { id: 'f1', node: <><Ok>✓</Ok> {t('login.feature1Title')}</> },
        { id: 'f2', node: <><Ok>✓</Ok> {t('login.feature2Title')}</> },
        { id: 'f3', node: <><Ok>✓</Ok> {t('login.feature3Title')}</> },
        { id: 'await', node: <><Prompt>{'>'}</Prompt> awaiting connection<Cursor /></> },
    ]
    const { visibleCount } = useBootSequence(lines)

    return (
        <Panel $isDark={isDark}>
            <Banner size={32} color="#faf9f5" />
            <Lines>
                {lines.slice(0, visibleCount).map((l) => (
                    <Line key={l.id}>{l.node}</Line>
                ))}
            </Lines>
            <Footer>{`# © ${CURRENT_YEAR} mobi`}</Footer>
        </Panel>
    )
}
