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

import { theme } from 'antd'

interface CommandHintBarProps {
    /** 参数提示文本（如 <message>） */
    hint: string
}

/**
 * Slash Command 参数提示条
 * 在 Sender header 区域展示选中命令的参数提示
 */
export function CommandHintBar({ hint }: CommandHintBarProps) {
    const { token } = theme.useToken()

    return (
        <div style={{
            padding: '4px 16px',
            fontSize: 12,
            color: token.colorTextTertiary,
        }}>
            {hint}
        </div>
    )
}
