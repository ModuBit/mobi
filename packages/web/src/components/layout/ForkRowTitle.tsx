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
import { useForkRowTitle } from './forkSessionLabel'
import type { Session } from '@/core/data/api/types'

interface ForkRowTitleProps {
    session: Session
    /** 渲染回调：拿到实时解析后的标题（「〈parent 标题〉 · 分叉」或降级「分叉会话」）自行包装样式/tooltip */
    children: (title: string) => React.ReactNode
}

/**
 * fork 会话行标题（仅 fork 行挂载，内部才发起 parent 标题查询——非 fork 行零查询开销）：
 * 「〈parent 标题〉 · 分叉」，parent 标题实时取（SSE session-updated/removed 驱动缓存失效），
 * 取不到降级「分叉会话」。渲染形态（样式/tooltip）由调用方经 children 回调决定。
 */
export function ForkRowTitle({ session, children }: ForkRowTitleProps) {
    const title = useForkRowTitle(session)
    return <>{children(title)}</>
}
