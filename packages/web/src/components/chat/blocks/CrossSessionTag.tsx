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

import type React from 'react'
import { theme } from 'antd'

/**
 * 跨会话入站消息来源标签：user 气泡上方的小字标注「📨 来自 {from}」。
 * from 为 null（信封缺 from-name 的降级落库）时显示通用文案。
 */
export function CrossSessionTag({ from }: { from: string | null }) {
    const { token } = theme.useToken()
    return (
        <div
            style={{
                marginBottom: 2,
                fontSize: 12,
                lineHeight: '18px',
                color: token.colorTextSecondary,
            }}
        >
            📨 来自 {from ?? '其他会话'}
        </div>
    )
}
