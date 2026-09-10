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

import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/lib/query-keys'
import { invalidateSessionViews } from '@/core/lib/invalidateProjectViews'
import { resumeSession } from '@/core/data/sessionResume'
import type { MobiApi } from '@/core/data/api/client'

const SOURCE_SESSION_ID = 'session-old'

function createQueryClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function seedResumeCaches(queryClient: QueryClient, sessionIds: string[]): readonly (readonly unknown[])[] {
    const keys = [
        ...sessionIds.map(sessionId => queryKeys.session(sessionId)),
        queryKeys.sessions,
        queryKeys.projects,
        queryKeys.recentSessions,
        queryKeys.pinnedSessions,
        queryKeys.projectSessions('project-1'),
    ] as const

    for (const key of keys) queryClient.setQueryData(key, { cached: true })
    return keys
}

function createApi(resume: MobiApi['sessions']['resume']): MobiApi {
    return { sessions: { resume } } as MobiApi
}

describe('invalidateSessionViews', () => {
    it('使会话详情、全局列表及项目视图缓存失效', async () => {
        const queryClient = createQueryClient()
        const keys = seedResumeCaches(queryClient, [SOURCE_SESSION_ID])

        await invalidateSessionViews(queryClient, [SOURCE_SESSION_ID])

        for (const key of keys) {
            expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        }
    })
})

describe('resumeSession', () => {
    it('恢复到同一会话时返回权威 ID，并使会话详情、列表及项目视图缓存失效', async () => {
        const queryClient = createQueryClient()
        const keys = seedResumeCaches(queryClient, [SOURCE_SESSION_ID])
        const resume = vi.fn(async () => ({ data: { sessionId: SOURCE_SESSION_ID } }))

        const resumedSessionId = await resumeSession(createApi(resume), SOURCE_SESSION_ID, queryClient)

        expect(resumedSessionId).toBe(SOURCE_SESSION_ID)
        expect(resume).toHaveBeenCalledWith(SOURCE_SESSION_ID)
        for (const key of keys) {
            expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        }
    })

    it('恢复产生新会话 ID 时，同时使来源与权威会话详情缓存失效', async () => {
        const queryClient = createQueryClient()
        const resumedSessionId = 'session-new'
        const keys = seedResumeCaches(queryClient, [SOURCE_SESSION_ID, resumedSessionId])
        const resume = vi.fn(async () => ({ data: { sessionId: resumedSessionId } }))

        const result = await resumeSession(createApi(resume), SOURCE_SESSION_ID, queryClient)

        expect(result).toBe(resumedSessionId)
        for (const key of keys) {
            expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        }
    })

    it('恢复请求失败时透传错误，且不提前使缓存失效', async () => {
        const queryClient = createQueryClient()
        const keys = seedResumeCaches(queryClient, [SOURCE_SESSION_ID])
        const error = new Error('resume failed')
        const resume = vi.fn(async () => Promise.reject(error))

        await expect(resumeSession(createApi(resume), SOURCE_SESSION_ID, queryClient)).rejects.toBe(error)
        for (const key of keys) {
            expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
        }
    })
})
