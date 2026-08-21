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
import { cleanup, render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useElementHeightVar } from '@/core/hooks/useElementHeightVar'
import type { RefObject } from 'react'

/**
 * ResizeObserver 替身：记录被观测元素与断开状态，暴露 trigger() 手动派发回调。
 * jsdom 无内置实现，且真实 observer 依赖布局（jsdom 恒 0 高度）。
 */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observed: Element[] = []
    disconnected = false
    constructor(private cb: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
    }
    observe(el: Element) {
        this.observed.push(el)
    }
    unobserve() {
        /* 本用例不涉及 */
    }
    disconnect() {
        this.disconnected = true
    }
    /** 模拟元素尺寸变化 */
    trigger() {
        this.cb([], this as unknown as ResizeObserver)
    }
}

/**
 * 挂载 hook 的探针组件。branch 模拟调用方的条件分支（如 isMobile）：
 * ref 对象本身恒为同一个（RefObject 引用不变），ref.current 随分支指向不同节点。
 */
function makeProbe(ref: RefObject<HTMLElement | null>) {
    return function Probe({ branch }: { branch: 'a' | 'b' }) {
        useElementHeightVar(ref, '--composer-h')
        // ref 回调先于 layout effect 执行：挂上节点同时伪造 jsdom 恒 0 的 offsetHeight
        const attach = (h: number) => (node: HTMLElement | null) => {
            if (!node) return
            Object.defineProperty(node, 'offsetHeight', { get: () => h, configurable: true })
            ref.current = node
        }
        // key 不同强制两条分支生成各自独立的 DOM 节点，
        // 对齐真实场景（ChatPane 移动端↔桌面端子树结构不同、节点全新）
        return branch === 'a' ? (
            <div key="a" data-host="a">
                <div data-node="a" ref={attach(111)} />
            </div>
        ) : (
            <div key="b" data-host="b">
                <div data-node="b" ref={attach(222)} />
            </div>
        )
    }
}

beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('useElementHeightVar', () => {
    it('mount 立即把高度写入父容器变量并观察元素', () => {
        const ref: RefObject<HTMLElement | null> = { current: null }
        const Probe = makeProbe(ref)
        const { container } = render(<Probe branch="a" />)

        const nodeA = container.querySelector('[data-node="a"]')!
        const hostA = container.querySelector('[data-host="a"]') as HTMLElement

        // 首帧（layout effect 内同步 apply）即写入，无需等 observer 回调
        expect(hostA.style.getPropertyValue('--composer-h')).toBe('111px')
        expect(FakeResizeObserver.instances).toHaveLength(1)
        expect(FakeResizeObserver.instances[0].observed).toEqual([nodeA])
        expect(FakeResizeObserver.instances[0].disconnected).toBe(false)
    })

    it('ResizeObserver 回调触发时重新写入最新高度', () => {
        const ref: RefObject<HTMLElement | null> = { current: null }
        const Probe = makeProbe(ref)
        const { container } = render(<Probe branch="a" />)
        const hostA = container.querySelector('[data-host="a"]') as HTMLElement
        const nodeA = container.querySelector('[data-node="a"]') as HTMLElement

        // 高度变化后由 observer 回调同步
        Object.defineProperty(nodeA, 'offsetHeight', { get: () => 333, configurable: true })
        FakeResizeObserver.instances[0].trigger()
        expect(hostA.style.getPropertyValue('--composer-h')).toBe('333px')
    })

    it('元素身份切换（ref 对象不变、ref.current 换新节点）时重挂 observer 并写新父容器', () => {
        const ref: RefObject<HTMLElement | null> = { current: null }
        const Probe = makeProbe(ref)
        const { container, rerender } = render(<Probe branch="a" />)

        const nodeA = container.querySelector('[data-node="a"]')!
        const hostA = container.querySelector('[data-host="a"]') as HTMLElement
        expect(hostA.style.getPropertyValue('--composer-h')).toBe('111px')
        expect(FakeResizeObserver.instances).toHaveLength(1)

        // 模拟条件分支切换：ref 对象引用不变，ref.current 从节点 a 指向节点 b
        rerender(<Probe branch="b" />)

        const nodeB = container.querySelector('[data-node="b"]')!
        const hostB = container.querySelector('[data-host="b"]') as HTMLElement

        // 旧 observer 已断开，新 observer 观察新节点
        expect(FakeResizeObserver.instances).toHaveLength(2)
        expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
        expect(FakeResizeObserver.instances[1].observed).toEqual([nodeB])
        expect(FakeResizeObserver.instances[1].disconnected).toBe(false)

        // 变量写到新节点的父容器，值来自新节点高度（222 而非 111）
        expect(hostB.style.getPropertyValue('--composer-h')).toBe('222px')
        expect(nodeB).not.toBe(nodeA)
    })

    it('unmount 断开 ResizeObserver', () => {
        const ref: RefObject<HTMLElement | null> = { current: null }
        const Probe = makeProbe(ref)
        const { unmount } = render(<Probe branch="a" />)

        expect(FakeResizeObserver.instances[0].disconnected).toBe(false)
        unmount()
        expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
    })

    it('ref.current 为 null 时不崩溃、不观察', () => {
        const ref: RefObject<HTMLElement | null> = { current: null }
        function Empty() {
            useElementHeightVar(ref, '--composer-h')
            return null
        }
        expect(() => render(<Empty />)).not.toThrow()
        expect(FakeResizeObserver.instances).toHaveLength(0)
    })
})
