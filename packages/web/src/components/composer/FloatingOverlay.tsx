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

import { memo, type ReactNode } from 'react'
import { theme } from 'antd'

interface FloatingOverlayProps {
    /** 子元素 */
    children: ReactNode
    /** 最大高度 */
    maxHeight?: number
}

/**
 * 浮动弹出层容器
 * 用于自动完成建议和设置面板
 */
export const FloatingOverlay = memo(function FloatingOverlay(props: FloatingOverlayProps) {
    const { children, maxHeight = 240 } = props
    const { token } = theme.useToken()

    return (
        <div
            style={{
                overflow: 'hidden',
                borderRadius: 12,
                backgroundColor: token.colorBgContainer,
                boxShadow: `rgba(0,0,0,0.05) 0px 4px 24px, 0px 0px 0px 1px ${token.colorBorder}`,
                maxHeight
            }}
        >
            <div style={{ overflowY: 'auto', maxHeight }}>
                {children}
            </div>
        </div>
    )
})
