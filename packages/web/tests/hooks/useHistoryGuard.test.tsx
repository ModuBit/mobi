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
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useState, useCallback } from 'react'
import { useHistoryGuard } from '@/core/hooks/useHistoryGuard'
import { __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

/** 宿主：active 状态驱动哨兵，按钮从外部翻转；回调触发后自翻 active=false（模拟收起） */
function GuardHost({ onBackPressed }: { onBackPressed: () => void }) {
    const [active, setActive] = useState(false)
    const cb = useCallback(() => {
        onBackPressed()
        setActive(false)
    }, [onBackPressed])
    useHistoryGuard(active, cb)
    return <button data-testid="open" onClick={() => setActive(true)}>open</button>
}

describe('useHistoryGuard（声明式哨兵 hook）', () => {
    beforeEach(() => __resetHistoryGuardForTest())
    afterEach(() => cleanup())

    it('active=false 不推哨兵；active=true 推哨兵，popstate 消费哨兵触发回调', async () => {
        const onBackPressed = vi.fn()
        const { getByTestId } = render(<GuardHost onBackPressed={onBackPressed} />)

        // 初始不推
        expect(window.history.state).not.toMatchObject({ mobiHistoryGuard: true })

        fireEvent.click(getByTestId('open'))
        // effect 在 click 后异步 flush，等哨兵推入
        await waitFor(() => expect(window.history.state).toMatchObject({ mobiHistoryGuard: true }))

        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(onBackPressed).toHaveBeenCalledTimes(1)
    })
})
