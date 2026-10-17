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

/**
 * 工具详情抽屉状态（前台任务卡片 / 后台任务卡片点击 → 打开对应 tool-call 详情）。
 *
 * 订阅收窄：抽屉关闭时 selector 恒返回 null（稳定引用），流式期 byId 索引整表重建
 * 不会触发宿主重渲染；打开时只随目标 block 引用变化（reconcile 对未变化 block 保引用）。
 * 卡片点击时不订阅消息索引，只在读点击现场这一刻命令式查询——窗口外 block 点击无反馈
 * 是已知限制（查询即守卫，不残留状态）。
 */

import { useCallback, useState } from 'react'
import { useChatBlocksByIdStore } from '@/core/data/stores/chatBlocksByIdStore'

export function useToolDetailDrawer(sessionId: string) {
    const [drawerBlockId, setDrawerBlockId] = useState<string | null>(null)

    const drawerBlock = useChatBlocksByIdStore((state) => {
        if (!drawerBlockId) return null
        const fromById = state.bySession.get(sessionId)?.get(drawerBlockId)
        return fromById?.kind === 'tool-call' ? fromById : null
    })

    /**
     * 唯一打开入口：按 toolUseId 在 byId 索引里解析 tool-call block（查询即守卫）。
     * 前台任务卡片与后台任务卡片都走这里，避免两处各写一遍解析与 kind 判定。
     */
    const openToolUseId = useCallback((toolUseId: string | null | undefined) => {
        if (toolUseId == null) return
        const found = useChatBlocksByIdStore.getState().bySession.get(sessionId)?.get(toolUseId)
        if (found?.kind === 'tool-call') setDrawerBlockId(found.id)
    }, [sessionId])

    const close = useCallback(() => setDrawerBlockId(null), [])

    return { drawerBlock, openToolUseId, close }
}
