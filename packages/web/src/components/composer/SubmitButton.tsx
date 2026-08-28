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

import { Button } from 'antd'
import { ArrowUpOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import type { SubmitButtonState } from './submitButtonState'

const spinKf = keyframes`
    to { transform: rotate(360deg); }
`

/**
 * 停止态外圈：旋转的 loading ring（轨道淡橙 + 顶部暖橙头）
 * 可见性 tuned：2.5→3px 边框、轨道 30%→35%——原参数太细太淡，用户感知不到"有动效"
 * 仅在方块态（非 abortPending）显示——abortPending 时 Button 自身 loading 转圈，
 * 双重转圈视觉冗余，故此时 $ring=false 隐藏光环
 */
const StopWrap = styled.span<{ $ring: boolean }>`
    position: relative;
    display: inline-flex;

    &::before {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        border: 3px solid color-mix(in srgb, var(--ant-color-warning) 35%, transparent);
        border-top-color: var(--ant-color-warning);
        animation: ${spinKf} 1s linear infinite;
        pointer-events: none;
        /* abortPending 时 Button 自身转圈，光环隐藏 */
        display: ${props => props.$ring ? 'block' : 'none'};
    }

    @media (prefers-reduced-motion: reduce) {
        &::before { animation: none; opacity: .5; }
    }
`

/** 停止图标：实心圆角方块（720/1024 ≈ 70%，原 600/1024 ≈ 58% 偏小） */
function SquareIcon() {
    return (
        <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ width: '1em', height: '1em' }}>
            <rect fill="currentColor" height="720" rx="76" ry="76" width="720" x="152" y="152" />
        </svg>
    )
}

export interface SubmitButtonProps {
    /** 按钮状态（由 resolveSubmitButtonState 推导） */
    state: SubmitButtonState
    /** 点击发送 */
    onSubmit: () => void
    /** 点击中止 */
    onAbort?: () => void
}

/**
 * 发送/停止合并按钮
 *
 * 由 state.kind 决定形态：
 * - send → 主色圆形 ↑（禁用态由 state.disabled 控制）
 * - stop → 主色圆形 + 方块 ■（变大）；方块态额外叠加外圈旋转光环传递"运行中"，
 *   abortPending 时光环隐藏（Button 自身 loading 转圈）+ 禁用以防重复中止
 *
 * 不挂在 antd X Sender 的 disabled 上下文里，故请求权限期间（Sender disabled）仍可点击。
 */
export function SubmitButton(props: SubmitButtonProps) {
    const { state, onSubmit, onAbort } = props

    if (state.kind === 'send') {
        return (
            <Button
                type="primary"
                shape="circle"
                icon={<ArrowUpOutlined />}
                disabled={state.disabled}
                onClick={onSubmit}
            />
        )
    }

    // 停止态：方块 + 外圈旋转光环（abortPending 时光环隐藏，Button 自身转圈）
    return (
        <StopWrap $ring={!state.loading}>
            <Button
                type="primary"
                shape="circle"
                icon={<SquareIcon />}
                loading={state.loading}
                disabled={state.disabled}
                onClick={onAbort}
            />
        </StopWrap>
    )
}
