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
 * Mobi 开场动画组件 — 左 AnimateLogo（动画 m 标记）+ 右 MobiLockup（品牌 lockup，主题适配）。
 * 整组淡入上浮入场。
 */

import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { AnimateLogo } from './AnimateLogo'
import { MobiLockup } from './MobiLockup'

const rise = keyframes`
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
`

/** 横排容器（承载入场动画） */
const Container = styled.div`
    display: inline-flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
    opacity: 0;
    animation: ${rise} 600ms ease forwards;

    @media (prefers-reduced-motion: reduce) {
        animation: none;
        opacity: 1;
    }
`

/** 左：动画 m 标记 */
const Mark = styled(AnimateLogo)`
    width: 96px;
    height: 96px;
`

/** 右：品牌 lockup（高度与标记联动） */
const Lockup = styled(MobiLockup)`
    height: 96px;
    width: auto;
`

interface IntroLogoProps {
    className?: string
}

export function IntroLogo({ className }: IntroLogoProps) {
    return (
        <Container className={className}>
            <Mark />
            <Lockup />
        </Container>
    )
}
