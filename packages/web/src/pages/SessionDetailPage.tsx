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

import { useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { SessionDetail } from '@/pages/session/SessionDetail'

/**
 * 会话详情页
 * 显示选中的会话详情
 */
export function SessionDetailPage() {
    const params = useParams({ strict: false })
    const sessionId = params.sessionId as string

    // 2026-10-31 临时诊断埋点：移动端菜单导航「URL 已变但页面视觉不切」真机排查——
    // 此 log 出现 = React 树已提交本页（与 mobileMenu.tsx handleExited 的埋点配对；
    // 配对失败的一段即断点所在）。定位后删除
    useEffect(() => {
        console.info(`[nav-diag] session-page committed +${Math.round(performance.now())}ms sessionId=${sessionId}`)
    }, [sessionId])

    return <SessionDetail sessionId={sessionId} />
}
