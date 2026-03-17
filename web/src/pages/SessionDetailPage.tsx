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

import { useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SessionDetail } from '@/components/session/SessionDetail'
import { useUiStore } from '@/stores/uiStore'

/**
 * 会话详情页
 * 显示选中的会话详情
 */
export function SessionDetailPage() {
    const params = useParams({ strict: false })
    const sessionId = params.sessionId as string
    const { setSessionViewMode } = useUiStore()

    // 切换会话时重置视图模式
    useEffect(() => {
        if (sessionId) {
            setSessionViewMode('chat')
        }
    }, [sessionId, setSessionViewMode])

    return <SessionDetail sessionId={sessionId} />
}
