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
import { SplitLayout } from '@/components/ui/SplitLayout'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

export interface WorkspaceSplitterProps {
    sessionId: string
    left: ReactNode
    right: ReactNode
}

/**
 * 会话工作区分栏布局。
 * 把 workspaceStore 的按 session 键控状态（expanded / splitRatio）
 * 接到通用 {@link SplitLayout}，左侧安全宽度 20%。
 */
export function WorkspaceSplitter({ sessionId, left, right }: WorkspaceSplitterProps) {
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const splitRatio = useWorkspaceStore((s) => s.getSession(sessionId).splitRatio)
    const chatHidden = useWorkspaceStore((s) => s.getSession(sessionId).chatHidden)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)

    return (
        <SplitLayout
            left={left}
            right={right}
            expanded={expanded}
            splitRatio={splitRatio}
            secondaryMaximized={expanded && chatHidden}
            onExpandedChange={(v) => setExpanded(sessionId, v)}
            onSplitRatioChange={(v) => setSplitRatio(sessionId, v)}
        />
    )
}
