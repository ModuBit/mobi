/**
 * Copyright (c) 2025 Mobi. All rights reserved.
 *
 * Mobi 开场动画组件 — 层叠胶囊生长 → 圆点出现 → MOBI 文字淡入。
 * 使用 currentColor 继承父元素颜色，自动适配深浅主题。
 */

import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'

/* ── Keyframes ── */

const grow = keyframes`
    from { transform: scaleY(0); }
    to   { transform: scaleY(1); }
`

const dotAppear = keyframes`
    from { opacity: 0; transform: scale(0.6); }
    to   { opacity: 1; transform: scale(1); }
`

const textFade = keyframes`
    from { opacity: 0; transform: translateX(-50%) translateY(12px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
`

/* ── Styled Components ── */

/** 外层容器 */
const Container = styled.div`
    position: relative;
    width: 128px;
    height: 128px;
    flex-shrink: 0;
`

/** 胶囊层 — 共用基础样式 */
const Layer = styled.div`
    position: absolute;
    width: 29px;
    height: 78px;
    border-radius: 15px;
    background: currentColor;
    transform-origin: bottom center;
    transform: scaleY(0);
    animation: ${grow} 500ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
`

/** 后层 */
const LayerBack = styled(Layer)`
    left: 57px;
    bottom: 33px;
    opacity: 0.08;
    animation-delay: 500ms;
`

/** 中层 */
const LayerMid = styled(Layer)`
    left: 50px;
    bottom: 39px;
    opacity: 0.16;
    animation-delay: 280ms;
`

/** 前层 */
const LayerFront = styled(Layer)`
    left: 43px;
    bottom: 45px;
    animation-delay: 60ms;
`

/** 空心圆点 */
const Dot = styled.div`
    position: absolute;
    width: 18px;
    height: 18px;
    left: 48.5px;
    bottom: 5px;
    border: 3.5px solid currentColor;
    border-radius: 50%;
    opacity: 0;
    transform: scale(0.6);
    animation: ${dotAppear} 400ms ease forwards;
    animation-delay: 900ms;
`

/** MOBI 文字 */
const Wordmark = styled.div`
    position: absolute;
    left: 50%;
    top: 140px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: currentColor;
    white-space: nowrap;
    opacity: 0;
    animation: ${textFade} 500ms ease forwards;
    animation-delay: 1300ms;
`

/* ── Component ── */

interface IntroLogoProps {
    className?: string
}

/**
 * Mobi 开场动画，使用 currentColor 继承父元素颜色。
 * 父元素设置 `color` 即可控制颜色。
 */
export function IntroLogo({ className }: IntroLogoProps) {
    return (
        <Container className={className}>
            <LayerBack />
            <LayerMid />
            <LayerFront />
            <Dot />
            <Wordmark>MOBI</Wordmark>
        </Container>
    )
}
