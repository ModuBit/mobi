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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import { useElementHeightVar } from '@/core/hooks/useElementHeightVar'

// vitest 未开 globals，渲染型测试显式 cleanup，防止 DOM 累积污染后续断言
afterEach(cleanup)

// jsdom 无 ResizeObserver，用 mock 替代；实例登记到数组供测试手动触发回调
const roInstances: MockRO[] = []
class MockRO {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
        this.cb = cb
        roInstances.push(this)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockRO)

/** 挂载 hook 的探针组件：高度来源 div */
function Probe({ name }: { name: string }) {
    const ref = useRef<HTMLDivElement>(null)
    useElementHeightVar(ref, name)
    return <div ref={ref} data-testid="probe" />
}

describe('useElementHeightVar', () => {
    it('挂载即把元素高度写入父容器的 CSS 变量，RO 触发后更新', () => {
        // 渲染到自定义 host 而非 document.body——变量挂在 probe.parentElement 上，body 会污染全局
        const host = document.createElement('div')
        document.body.appendChild(host)
        const { unmount } = render(<Probe name="--test-h" />, { container: host })
        const probe = host.querySelector('[data-testid="probe"]') as HTMLElement
        Object.defineProperty(probe, 'offsetHeight', { value: 123, configurable: true })
        const ro = roInstances.at(-1)!
        ro.cb([{ target: probe } as ResizeObserverEntry], ro as unknown as ResizeObserver)
        expect(host.style.getPropertyValue('--test-h')).toBe('123px')
        // 高度变化再触发 → 变量更新
        Object.defineProperty(probe, 'offsetHeight', { value: 200, configurable: true })
        ro.cb([{ target: probe } as ResizeObserverEntry], ro as unknown as ResizeObserver)
        expect(host.style.getPropertyValue('--test-h')).toBe('200px')
        unmount()
        // 卸载后 RO 断开（不抛错即通过）
    })
})
