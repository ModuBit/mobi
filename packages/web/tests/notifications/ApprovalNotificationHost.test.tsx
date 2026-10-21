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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// antd notification spy：捕获弹出参数（含 title/description 节点与 onClick）
const notifyOpenSpy = vi.hoisted(() => vi.fn())
const notifyDestroySpy = vi.hoisted(() => vi.fn())
const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({ notification: { open: notifyOpenSpy, destroy: notifyDestroySpy } }),
        },
    }
})
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
}))

import { useApprovalNotificationStore } from '@/core/data/stores/approvalNotificationStore'
import { ApprovalNotificationHost } from '@/features/chat/notificationApproval/ApprovalNotificationHost'

const ITEM = {
    key: 'permission-s1-1',
    sessionId: 's1',
    requestId: 'r1',
    title: 'Permission Request',
    body: 'Demo (Bash)',
    url: '/sessions/s1',
}

/** 宿主用 useQueryClient 给通知内容补 provider（通知内容渲染在独立 React 根，不继承 context） */
function renderHost() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={qc}>
            <ApprovalNotificationHost />
        </QueryClientProvider>,
    )
}

describe('ApprovalNotificationHost', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        useApprovalNotificationStore.getState().clearAll()
    })
    afterEach(() => cleanup())

    it('信箱新增审批条目 → 弹出常驻通知（duration 0，跳转按钮在标题行）', async () => {
        renderHost()

        act(() => useApprovalNotificationStore.getState().push(ITEM))

        expect(notifyOpenSpy).toHaveBeenCalledTimes(1)
        const call = notifyOpenSpy.mock.calls[0][0]
        expect(call.key).toBe(ITEM.key)
        expect(call.duration).toBe(0)
        expect(call.title).toBeTruthy()
        expect(call.description).toBeTruthy()
    })

    it('条目被移除（处理完 / 登出）→ 收起对应通知', async () => {
        renderHost()
        act(() => useApprovalNotificationStore.getState().push(ITEM))
        expect(notifyDestroySpy).not.toHaveBeenCalled()

        act(() => useApprovalNotificationStore.getState().remove(ITEM.key))

        expect(notifyDestroySpy).toHaveBeenCalledWith(ITEM.key)
    })

    it('点通知 → 收起并跳转该会话', async () => {
        renderHost()
        act(() => useApprovalNotificationStore.getState().push(ITEM))

        act(() => notifyOpenSpy.mock.calls[0][0].onClick())

        // 落地地址由 daemon 随通知下发（item.url），不在前端重拼路由
        expect(navigateSpy).toHaveBeenCalledWith({ to: ITEM.url })
        expect(useApprovalNotificationStore.getState().items).toHaveLength(0)
        expect(notifyDestroySpy).toHaveBeenCalledWith(ITEM.key)
    })
})
