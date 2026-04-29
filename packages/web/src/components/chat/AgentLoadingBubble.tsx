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
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { getVibingMessage, hashSessionId } from '@/components/pixel-avatar/vibingMessages'

interface AgentLoadingBubbleProps {
    sessionId: string
}

export function AgentLoadingBubble({ sessionId }: AgentLoadingBubbleProps) {
    const { token } = theme.useToken()

    const vibingMsg = getVibingMessage(hashSessionId(sessionId))

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PixelAvatar name={sessionId} status="outputting" size={18} />
            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                {vibingMsg}
            </span>
        </div>
    )
}
