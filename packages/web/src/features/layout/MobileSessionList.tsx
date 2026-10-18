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

import type { ReactNode } from 'react'
import { theme as antTheme } from 'antd'
import { GlideLayer } from '@/ui/base/motion/GlideLayer'
import { useGlideHighlight } from '@/ui/base/motion/useGlideHighlight'
import { SessionListInner } from './mobileWorkspaceList.styles'

const { useToken } = antTheme

interface MobileSessionListProps {
    activeSessionId: string | undefined
    children: ReactNode
}

/**
 * 移动端会话列表容器：激活行底色由滑移层统一绘制（触屏无 hover，只做选中滑移）。
 * 置顶 / 工作区 / 最近三个分区共用，行自行标记 data-session-row / data-session-active。
 */
export function MobileSessionList({ activeSessionId, children }: MobileSessionListProps) {
    const { token } = useToken()
    const { containerRef, activeEl } = useGlideHighlight<HTMLDivElement>({
        rowSelector: '[data-session-row]',
        activeSelector: '[data-session-active="true"]',
        activeKey: activeSessionId,
        hover: false,
    })

    return (
        <SessionListInner ref={containerRef}>
            <GlideLayer target={activeEl} $background={token.colorPrimaryBg} $radius="0px" />
            {children}
        </SessionListInner>
    )
}
