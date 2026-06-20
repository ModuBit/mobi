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
import { Splitter } from 'antd'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

export interface WorkspaceSplitterProps {
    sessionId: string
    left: ReactNode
    right: ReactNode
}

/**
 * 工作区分栏容器：两端共用，PC / 移动配置不同。
 *
 * - 收起：左 100%，右 0
 * - 展开：PC 按 splitRatio 分（左 min 20%）；移动左 0、右 100%
 * - PC 拖动到右占比 < 2%（leftRatio > 0.98）自动 setExpanded(false)
 * - collapsible.motion 提供折叠/展开动画；destroyOnHidden=false 保证收起时右面板不卸载（终端保活）
 */
export function WorkspaceSplitter({ sessionId, left, right }: WorkspaceSplitterProps) {
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const splitRatio = useWorkspaceStore((s) => s.getSession(sessionId).splitRatio)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)

    // 收起：左 100%；展开：PC 按 splitRatio 分，移动右顶满
    const leftSize: string | number = !expanded
        ? '100%'
        : isMobile
            ? 0
            : `${splitRatio * 100}%`
    const rightSize: string | number = !expanded
        ? 0
        : isMobile
            ? '100%'
            : `${(1 - splitRatio) * 100}%`

    const handleResize = (sizes: number[]) => {
        const total = sizes[0] + sizes[1]
        if (total <= 0) return
        const leftRatio = sizes[0] / total
        // PC：右侧占比 < 2% 视为收起
        if (!isMobile && leftRatio > 0.98) {
            setExpanded(sessionId, false)
        } else {
            setSplitRatio(sessionId, leftRatio)
        }
    }

    return (
        <Splitter
            style={{ height: '100%' }}
            collapsible={{ motion: true }}
            destroyOnHidden={false}
            onResize={handleResize}
        >
            <Splitter.Panel size={leftSize} min={isMobile ? 0 : '20%'} resizable={!isMobile}>
                {left}
            </Splitter.Panel>
            <Splitter.Panel size={rightSize} min={0} collapsible={{ showCollapsibleIcon: false }}>
                {right}
            </Splitter.Panel>
        </Splitter>
    )
}
