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
import type { SubmitButtonState } from './submitButtonState'

/** 停止图标：实心方块（继承 currentColor，在主色按钮上为白色） */
function SquareIcon() {
    return (
        <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ width: '1em', height: '1em' }}>
            <rect fill="currentColor" height="600" rx="64" ry="64" width="600" x="212" y="212" />
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
 * - stop → 与发送按钮同款主色圆形，仅中心图标换成方块 ■（abortPending 时禁用以防重复中止）
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

    // 停止态：发送按钮样式 + 方块图标；abortPending 时转圈并禁用
    return (
        <Button
            type="primary"
            shape="circle"
            icon={<SquareIcon />}
            loading={state.loading}
            disabled={state.disabled}
            onClick={onAbort}
        />
    )
}
